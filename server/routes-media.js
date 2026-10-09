import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { db } from './db.js';
import { config } from './config.js';
import { ApiError, fail, requireAuth, requireCourseManager, requireCourseViewer } from './http.js';
import { courseById } from './http.js';
import { courseFromLesson } from './course-service.js';
import { writeAuditLog, writeSystemLog } from './log-store.js';
import { streamFileToResponse } from './file-stream.js';
import { hasValidWebVttCueTimings } from './webvtt-validation.js';

export const mediaUploadRouter = Router();
export const protectedMediaRouter = Router();

const maxResourceTitleLength = 160;
const imageTypes = new Map([
  ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.png', 'image/png'], ['.webp', 'image/webp'],
]);
const documentTypes = new Map([
  ['.pdf', ['application/pdf']],
  ['.txt', ['text/plain']],
  ['.md', ['text/markdown', 'text/plain']],
  ['.rtf', ['application/rtf', 'text/rtf']],
  ['.doc', ['application/msword']],
  ['.docx', ['application/vnd.openxmlformats-officedocument.wordprocessingml.document']],
  ['.ppt', ['application/vnd.ms-powerpoint']],
  ['.pptx', ['application/vnd.openxmlformats-officedocument.presentationml.presentation']],
  ['.xls', ['application/vnd.ms-excel']],
  ['.xlsx', ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']],
  ['.csv', ['text/csv', 'application/vnd.ms-excel', 'text/plain']],
  ['.tsv', ['text/tab-separated-values', 'text/plain']],
  ['.odt', ['application/vnd.oasis.opendocument.text']],
  ['.odp', ['application/vnd.oasis.opendocument.presentation']],
  ['.ods', ['application/vnd.oasis.opendocument.spreadsheet']],
]);
const supportedUploadExtensions = new Set([...imageTypes.keys(), ...documentTypes.keys(), '.mp4', '.vtt']);
const pdfHeader = Buffer.from('%PDF-');
const pdfEndMarker = Buffer.from('%%EOF');
const compoundFileHeader = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const zipLocalFileHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const rtfHeader = Buffer.from('{\\rtf', 'ascii');
const compoundOfficeExtensions = new Set(['.doc', '.ppt', '.xls']);
const zipOfficeExtensions = new Set(['.docx', '.pptx', '.xlsx', '.odt', '.odp', '.ods']);
const encryptedOpenXmlExtensions = new Set(['.docx', '.pptx', '.xlsx']);

function fileMatchesKind(file, kind) {
  const ext = originalExtension(file.originalname);
  if (kind === 'video') return ext === '.mp4' && file.mimetype === 'video/mp4';
  if (kind === 'cover') return imageTypes.get(ext) === file.mimetype;
  if (kind === 'caption') return ext === '.vtt' && ['text/vtt', 'text/plain', 'application/octet-stream'].includes(file.mimetype);
  return documentTypes.get(ext)?.includes(file.mimetype) ?? false;
}

function normalizedOriginalName(value) {
  return path.basename(String(value ?? '').replaceAll('\\', '/'))
    .replace(/[\u0000-\u001f\u007f]/g, '');
}

function originalExtension(value) {
  return path.extname(normalizedOriginalName(value)).toLowerCase();
}

function safeOriginalName(value, fallback = 'Upload') {
  const name = normalizedOriginalName(value);
  if (!name) return fallback;
  if (name.length <= 255) return name;

  const extension = path.extname(name);
  if (supportedUploadExtensions.has(extension.toLowerCase())) {
    const stem = truncateUtf16CodeUnits(name.slice(0, -extension.length), 255 - extension.length);
    return `${stem}${extension}`;
  }
  return truncateUtf16CodeUnits(name, 255) || fallback;
}

function truncateUtf16CodeUnits(value, limit) {
  let truncated = value.slice(0, limit);
  if (/[\uD800-\uDBFF]$/.test(truncated)) truncated = truncated.slice(0, -1);
  return truncated;
}

async function fileSignatureMatchesKind(file, kind) {
  const ext = originalExtension(file.originalname);
  if (kind === 'caption') {
    try {
      const size = (await fs.promises.stat(file.path)).size;
      if (size < 6 || size > 5 * 1024 * 1024) return false;
      const contents = await fs.promises.readFile(file.path);
      const text = contents.toString('utf8');
      if (!Buffer.from(text, 'utf8').equals(contents) || text.includes('\0')) return false;
      return hasValidWebVttCueTimings(text);
    } catch {
      return false;
    }
  }
  if (kind === 'document' && ext !== '.pdf' && ext !== '.rtf'
    && !compoundOfficeExtensions.has(ext) && !zipOfficeExtensions.has(ext)) return true;
  if (kind !== 'cover' && kind !== 'video' && kind !== 'document') return true;
  let fileHandle;
  try {
    fileHandle = await fs.promises.open(file.path, 'r');
    const size = (await fileHandle.stat()).size;
    if (kind === 'video') {
      const header = Buffer.alloc(24);
      const { bytesRead: headerBytes } = await fileHandle.read(header, 0, header.length, 0);
      if (headerBytes < 16 || header.toString('ascii', 4, 8) !== 'ftyp') return false;
      const boxSize = header.readUInt32BE(0);
      if (boxSize === 1) {
        if (headerBytes < header.length) return false;
        const extendedBoxSize = header.readBigUInt64BE(8);
        return extendedBoxSize >= 24n && extendedBoxSize <= BigInt(size);
      }
      return boxSize >= 16 && boxSize <= size;
    }
    if (kind === 'document') {
      if (ext !== '.pdf') {
        const header = Buffer.alloc(compoundFileHeader.length);
        const { bytesRead } = await fileHandle.read(header, 0, header.length, 0);
        if (ext === '.rtf') {
          return bytesRead >= 6 && header.subarray(0, rtfHeader.length).equals(rtfHeader)
            && (header[5] === 0x30 || header[5] === 0x31);
        }
        if (compoundOfficeExtensions.has(ext)) {
          return bytesRead === compoundFileHeader.length && header.equals(compoundFileHeader);
        }
        if (zipOfficeExtensions.has(ext)) {
          return bytesRead >= zipLocalFileHeader.length
            && (header.subarray(0, zipLocalFileHeader.length).equals(zipLocalFileHeader)
              || (encryptedOpenXmlExtensions.has(ext)
                && bytesRead === compoundFileHeader.length && header.equals(compoundFileHeader)));
        }
        return true;
      }
      const headerLength = Math.min(size, 1024);
      const header = Buffer.alloc(headerLength);
      if (headerLength < pdfHeader.length
        || (await fileHandle.read(header, 0, header.length, 0)).bytesRead !== header.length
        || header.indexOf(pdfHeader) === -1) return false;
      const tail = Buffer.alloc(Math.min(size, 1024));
      if ((await fileHandle.read(tail, 0, tail.length, size - tail.length)).bytesRead !== tail.length) return false;
      const endOffset = tail.lastIndexOf(pdfEndMarker);
      if (endOffset === -1) return false;
      return /^[\x00\t\f\n\r ]*$/.test(tail.subarray(endOffset + pdfEndMarker.length).toString('ascii'));
    }
    if (ext === '.png') {
      const header = Buffer.alloc(16);
      return (await fileHandle.read(header, 0, header.length, 0)).bytesRead === header.length
        && header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        && header.toString('ascii', 12, 16) === 'IHDR';
    }
    if (ext === '.jpg' || ext === '.jpeg') {
      if (size < 5) return false;
      const header = Buffer.alloc(3);
      if ((await fileHandle.read(header, 0, header.length, 0)).bytesRead !== header.length
        || !header.equals(Buffer.from([0xff, 0xd8, 0xff]))) return false;
      const tail = Buffer.alloc(Math.min(size, 4096));
      const { bytesRead: tailBytes } = await fileHandle.read(tail, 0, tail.length, size - tail.length);
      return tail.subarray(0, tailBytes).lastIndexOf(Buffer.from([0xff, 0xd9])) !== -1;
    }
    if (ext === '.webp') {
      const header = Buffer.alloc(12);
      return size >= header.length
        && (await fileHandle.read(header, 0, header.length, 0)).bytesRead === header.length
        && header.toString('ascii', 0, 4) === 'RIFF'
        && header.toString('ascii', 8, 12) === 'WEBP';
    }
    return false;
  } catch {
    return false;
  } finally {
    if (fileHandle) {
      try { await fileHandle.close(); } catch {}
    }
  }
}

function uploadTypeMessage(kind) {
  if (kind === 'video') return 'Upload an MP4 video file.';
  if (kind === 'cover') return 'Upload a JPG, PNG, or WebP course cover.';
  if (kind === 'caption') return 'Upload a valid WebVTT (.vtt) captions file.';
  return 'Upload a PDF, text, Word, PowerPoint, Excel, CSV, TSV, or OpenDocument file.';
}

function storedFilename(originalName) {
  const ext = path.extname(safeOriginalName(originalName)).toLowerCase();
  return `${randomUUID()}${ext}`;
}

async function cleanupTemporaryUpload(file, message, details = {}) {
  try {
    await fs.promises.rm(file.path, { force: true });
  } catch (error) {
    writeSystemLog('warn', 'media', message, {
      ...details,
      uploadedFile: path.basename(file.filename || file.path),
      errorName: String(error?.name || 'Error').slice(0, 100),
      errorCode: typeof error?.code === 'string' ? error.code.slice(0, 100) : undefined,
    });
  }
}

const uploadStorage = multer.diskStorage({
  destination(req, _file, callback) {
    try {
      const courseId = String(req.params.courseId || '');
      const root = path.resolve(config.mediaRoot);
      const directory = path.resolve(root, courseId);
      if (!directory.startsWith(`${root}${path.sep}`)) return callback(new Error('Invalid media destination.'));
      fs.mkdir(directory, { recursive: true }, (error) => callback(error, directory));
    } catch (error) { callback(error); }
  },
  filename(req, file, callback) {
    callback(null, storedFilename(file.originalname));
  },
});
const commonUploadLimits = {
    fieldNameSize: 100,
    fieldSize: 8 * 1024,
    fields: 3,
    files: 1,
    parts: 4,
    headerPairs: 100,
};
const upload = multer({
  storage: uploadStorage,
  limits: { ...commonUploadLimits, fileSize: config.maxUploadBytes },
  fileFilter(req, file, callback) {
    const allowedKinds = req.uploadRouteMode === 'document' ? ['document'] : ['video', 'cover'];
    if (allowedKinds.some((kind) => fileMatchesKind(file, kind))) return callback(null, true);
    const kind = req.uploadRouteMode === 'document' ? 'document' : req.body?.kind === 'cover' ? 'cover' : 'video';
    return callback(new ApiError(400, uploadTypeMessage(kind), 'invalid_media_type'));
  },
});
const captionUpload = multer({
  storage: uploadStorage,
  limits: { ...commonUploadLimits, fileSize: 5 * 1024 * 1024 },
  fileFilter(_req, file, callback) {
    if (fileMatchesKind(file, 'caption')) return callback(null, true);
    return callback(new ApiError(400, uploadTypeMessage('caption'), 'invalid_media_type'));
  },
});

function setUploadRouteMode(mode) {
  return (req, _res, next) => {
    req.uploadRouteMode = mode;
    next();
  };
}

function authorizeManagerParam(req, _res, next) {
  try {
    requireCourseManager(req.params.courseId, req.currentUser);
    next();
  } catch (error) { next(error); }
}

function requireCurrentCourseManager(courseId, userId) {
  const user = db.prepare('SELECT id, username, role, disabled FROM users WHERE id = ?').get(userId);
  if (!user || user.disabled) fail(403, 'You do not have permission to manage courses.', 'forbidden');
  return requireCourseManager(courseId, user);
}

function canonicalCaptionLanguage(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 35) {
    fail(400, 'Enter a valid language tag such as en or en-GB.', 'validation_error');
  }
  try {
    const [language] = Intl.getCanonicalLocales(value.trim());
    if (!language) throw new RangeError('Missing language tag.');
    return language;
  } catch {
    fail(400, 'Enter a valid language tag such as en or en-GB.', 'validation_error');
  }
}

mediaUploadRouter.post('/manage/courses/:courseId/media', requireAuth, authorizeManagerParam, setUploadRouteMode('media'), upload.single('file'), async (req, res) => {
  if (!req.file) fail(400, 'Choose a file to upload.', 'file_required');
  const course = courseById(req.params.courseId);
  if (!course) {
    await cleanupTemporaryUpload(req.file, 'Rejected media upload cleanup failed after course deletion', { courseId: req.params.courseId });
    fail(404, 'Course not found.', 'not_found');
  }
  const requestedKind = req.body?.kind;
  const kind = requestedKind === undefined || requestedKind === '' ? 'video' : requestedKind;
  if (!['cover', 'video'].includes(kind)) {
    await cleanupTemporaryUpload(req.file, 'Rejected media upload cleanup failed after invalid kind', { courseId: course.id });
    fail(400, 'Choose a video or course cover image.', 'invalid_media_type');
  }
  if (!fileMatchesKind(req.file, kind) || !await fileSignatureMatchesKind(req.file, kind)) {
    await cleanupTemporaryUpload(req.file, 'Rejected media upload cleanup failed after file type mismatch', { courseId: course.id });
    fail(400, uploadTypeMessage(kind), 'invalid_media_type');
  }
  const lessonId = req.body?.lessonId ? String(req.body.lessonId) : '';
  if (kind === 'video') {
    const lesson = lessonId && courseFromLesson(lessonId);
    if (!lesson || lesson.id !== course.id) {
      await cleanupTemporaryUpload(req.file, 'Rejected video upload cleanup failed', { courseId: course.id });
      fail(400, 'Choose a lesson in this course before uploading a video.', 'invalid_lesson');
    }
  }
  const originalName = safeOriginalName(req.file.originalname);
  const id = randomUUID();
  let previousId;
  try {
    const save = db.transaction(() => {
      const currentCourse = requireCurrentCourseManager(course.id, req.currentUser.id);
      let currentLesson;
      if (kind === 'video') {
        currentLesson = courseFromLesson(lessonId);
        if (!currentLesson || currentLesson.id !== currentCourse.id) {
          fail(400, 'Choose a lesson in this course before uploading a video.', 'invalid_lesson');
        }
      }
      db.prepare(`INSERT INTO media_files (id, course_id, original_name, file_name, mime_type, byte_size, media_kind)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, course.id, originalName, req.file.filename, req.file.mimetype, req.file.size, kind);
      if (kind === 'cover') {
        const previous = currentCourse.cover_media_id;
        db.prepare('UPDATE courses SET cover_media_id = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(id, req.currentUser.id, currentCourse.id);
        return previous;
      }
      const previous = currentLesson.media_id;
      const updatedLesson = db.prepare(`UPDATE lessons SET media_id = ? WHERE id = ?
        AND module_id IN (SELECT id FROM course_modules WHERE course_id = ?)`).run(id, lessonId, currentCourse.id);
      if (updatedLesson.changes !== 1) fail(400, 'Choose a lesson in this course before uploading a video.', 'invalid_lesson');
      db.prepare('UPDATE courses SET updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.currentUser.id, currentCourse.id);
      return previous;
    });
    previousId = save.immediate();
  } catch (error) {
    await cleanupTemporaryUpload(req.file, 'Uploaded file cleanup failed after media save failed', { courseId: course.id, mediaId: id });
    throw error;
  }

  if (previousId) {
    try {
      const previous = db.prepare('SELECT file_name FROM media_files WHERE id = ?').get(previousId);
      if (previous) {
        db.prepare('DELETE FROM media_files WHERE id = ?').run(previousId);
        await fs.promises.rm(path.join(config.mediaRoot, course.id, previous.file_name), { force: true });
      }
    } catch (error) {
      writeSystemLog('warn', 'media', 'Previous media cleanup failed after replacement', {
        courseId: course.id,
        previousMediaId: previousId,
        replacementMediaId: id,
        errorName: String(error?.name || 'Error').slice(0, 100),
        errorCode: typeof error?.code === 'string' ? error.code.slice(0, 100) : undefined,
      });
    }
  }
  const lessonTitle = kind === 'video' ? courseFromLesson(lessonId)?.lesson_title : null;
  writeAuditLog({ actor: req.currentUser, action: kind === 'cover' ? 'course.cover_uploaded' : 'course.video_uploaded', entityType: 'course', entityId: course.id,
    summary: `Uploaded ${kind === 'cover' ? 'cover image' : `video for ${lessonTitle || 'a lesson'}`} to ${course.title}`,
    details: { kind, lessonId: lessonId || null, originalName, byteSize: req.file.size } });
  res.status(201).json({ media: { id, url: `/media/${id}`, name: originalName, bytes: req.file.size, kind } });
});

mediaUploadRouter.post('/manage/courses/:courseId/lesson-documents', requireAuth, authorizeManagerParam, setUploadRouteMode('document'), upload.single('file'), async (req, res) => {
  if (!req.file) fail(400, 'Choose a document to upload.', 'file_required');
  const course = courseById(req.params.courseId);
  if (!course) {
    await cleanupTemporaryUpload(req.file, 'Rejected document upload cleanup failed after course deletion', { courseId: req.params.courseId });
    fail(404, 'Course not found.', 'not_found');
  }
  if (!fileMatchesKind(req.file, 'document') || !await fileSignatureMatchesKind(req.file, 'document')) {
    await cleanupTemporaryUpload(req.file, 'Rejected document upload cleanup failed after file type mismatch', { courseId: course.id });
    fail(400, uploadTypeMessage('document'), 'invalid_media_type');
  }
  const lessonId = String(req.body?.lessonId || '');
  const lesson = lessonId && courseFromLesson(lessonId);
  if (!lesson || lesson.id !== course.id) {
    await cleanupTemporaryUpload(req.file, 'Rejected document upload cleanup failed', { courseId: course.id, lessonId: lessonId || null });
    fail(400, 'Choose a lesson in this course before uploading a document.', 'invalid_lesson');
  }

  const originalName = safeOriginalName(req.file.originalname, 'Document');
  const rawTitle = req.body?.title;
  if (rawTitle !== undefined && typeof rawTitle !== 'string') {
    await cleanupTemporaryUpload(req.file, 'Invalid document title upload cleanup failed', { courseId: course.id, lessonId: lesson.lesson_id });
    fail(400, 'Resource title must be text.', 'validation_error');
  }
  const suppliedTitle = typeof rawTitle === 'string' ? rawTitle.trim() : '';
  const inferredTitle = truncateUtf16CodeUnits(path.parse(originalName).name, maxResourceTitleLength);
  const title = suppliedTitle || inferredTitle || 'Attached document';
  if (suppliedTitle.length > maxResourceTitleLength) {
    await cleanupTemporaryUpload(req.file, 'Invalid document title upload cleanup failed', { courseId: course.id, lessonId: lesson.lesson_id });
    fail(400, `Resource title must be ${maxResourceTitleLength} characters or fewer.`, 'validation_error');
  }

  const id = randomUUID();
  let savedLesson;
  try {
    const save = db.transaction(() => {
      const currentCourse = requireCurrentCourseManager(course.id, req.currentUser.id);
      const currentLesson = courseFromLesson(lessonId);
      if (!currentLesson || currentLesson.id !== currentCourse.id) {
        fail(400, 'Choose a lesson in this course before uploading a document.', 'invalid_lesson');
      }
      const position = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM lesson_resources WHERE lesson_id = ?')
        .get(currentLesson.lesson_id).next;
      db.prepare(`INSERT INTO lesson_resources
        (id, lesson_id, resource_type, title, file_name, original_name, mime_type, byte_size, position)
        VALUES (?, ?, 'document', ?, ?, ?, ?, ?, ?)`)
        .run(id, currentLesson.lesson_id, title, req.file.filename, originalName, req.file.mimetype, req.file.size, position);
      db.prepare('UPDATE courses SET updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(req.currentUser.id, currentCourse.id);
      return currentLesson;
    });
    savedLesson = save.immediate();
  } catch (error) {
    await cleanupTemporaryUpload(req.file, 'Uploaded document cleanup failed after resource save failed', { courseId: course.id, lessonId: lesson.lesson_id, resourceId: id });
    throw error;
  }
  writeAuditLog({ actor: req.currentUser, action: 'course.document_uploaded', entityType: 'lesson', entityId: savedLesson.lesson_id,
    summary: `Uploaded a document for ${savedLesson.lesson_title}`, details: { courseId: course.id, title, originalName, byteSize: req.file.size } });
  res.status(201).json({ resource: { id, kind: 'document', title, url: `/media/resources/${id}`, fileName: originalName } });
});

mediaUploadRouter.post('/manage/courses/:courseId/lesson-captions', requireAuth, authorizeManagerParam, captionUpload.single('file'), async (req, res) => {
  if (!req.file) fail(400, 'Choose a WebVTT captions file to upload.', 'file_required');
  const course = courseById(req.params.courseId);
  if (!course) {
    await cleanupTemporaryUpload(req.file, 'Rejected captions upload cleanup failed after course deletion', { courseId: req.params.courseId });
    fail(404, 'Course not found.', 'not_found');
  }
  if (!fileMatchesKind(req.file, 'caption') || !await fileSignatureMatchesKind(req.file, 'caption')) {
    await cleanupTemporaryUpload(req.file, 'Rejected captions upload cleanup failed after file type mismatch', { courseId: course.id });
    fail(400, uploadTypeMessage('caption'), 'invalid_media_type');
  }
  const lessonId = req.body?.lessonId;
  if (typeof lessonId !== 'string' || !lessonId.trim()) {
    await cleanupTemporaryUpload(req.file, 'Invalid captions upload cleanup failed', { courseId: course.id });
    fail(400, 'Choose a lesson in this course before uploading captions.', 'invalid_lesson');
  }
  const languageInput = req.body?.language;
  if (typeof languageInput !== 'string') {
    await cleanupTemporaryUpload(req.file, 'Invalid captions upload cleanup failed', { courseId: course.id, lessonId });
    fail(400, 'Enter a valid language tag such as en or en-GB.', 'validation_error');
  }
  let language;
  try { language = canonicalCaptionLanguage(languageInput); }
  catch (error) {
    await cleanupTemporaryUpload(req.file, 'Invalid captions upload cleanup failed', { courseId: course.id, lessonId });
    throw error;
  }
  const rawLabel = req.body?.label;
  if (typeof rawLabel !== 'string' || !rawLabel.trim() || rawLabel.trim().length > 80) {
    await cleanupTemporaryUpload(req.file, 'Invalid captions upload cleanup failed', { courseId: course.id, lessonId });
    fail(400, 'Caption label must be between 1 and 80 characters.', 'validation_error');
  }
  const label = rawLabel.trim();
  const lesson = courseFromLesson(lessonId.trim());
  if (!lesson || lesson.id !== course.id) {
    await cleanupTemporaryUpload(req.file, 'Rejected captions upload cleanup failed for invalid lesson', { courseId: course.id, lessonId });
    fail(400, 'Choose a lesson in this course before uploading captions.', 'invalid_lesson');
  }

  const originalName = safeOriginalName(req.file.originalname, 'captions.vtt');
  const id = randomUUID();
  let saved;
  try {
    const save = db.transaction(() => {
      const currentCourse = requireCurrentCourseManager(course.id, req.currentUser.id);
      const currentLesson = courseFromLesson(lesson.lesson_id);
      if (!currentLesson || currentLesson.id !== currentCourse.id) {
        fail(400, 'Choose a lesson in this course before uploading captions.', 'invalid_lesson');
      }
      const existing = db.prepare('SELECT id, file_name FROM lesson_captions WHERE lesson_id = ? AND language = ?')
        .get(currentLesson.lesson_id, language);
      if (existing) {
        db.prepare(`UPDATE lesson_captions SET label = ?, file_name = ?, original_name = ?, byte_size = ? WHERE id = ?`)
          .run(label, req.file.filename, originalName, req.file.size, existing.id);
      } else {
        db.prepare(`INSERT INTO lesson_captions
          (id, lesson_id, language, label, file_name, original_name, byte_size)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(id, currentLesson.lesson_id, language, label, req.file.filename, originalName, req.file.size);
      }
      db.prepare('UPDATE courses SET updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(req.currentUser.id, currentCourse.id);
      return { id: existing?.id || id, previousFileName: existing?.file_name || null, replaced: Boolean(existing) };
    });
    saved = save.immediate();
  } catch (error) {
    await cleanupTemporaryUpload(req.file, 'Uploaded captions cleanup failed after save failed', { courseId: course.id, lessonId: lesson.lesson_id, captionId: id });
    throw error;
  }

  if (saved.previousFileName && saved.previousFileName !== req.file.filename) {
    await cleanupTemporaryUpload({ path: path.join(config.mediaRoot, course.id, saved.previousFileName), filename: saved.previousFileName },
      'Previous captions cleanup failed after replacement', { courseId: course.id, lessonId: lesson.lesson_id, captionId: saved.id });
  }
  writeAuditLog({ actor: req.currentUser, action: 'course.caption_uploaded', entityType: 'lesson', entityId: lesson.lesson_id,
    summary: `${saved.replaced ? 'Replaced' : 'Uploaded'} ${language} captions for ${lesson.lesson_title}`,
    details: { courseId: course.id, captionId: saved.id, language, label, originalName, byteSize: req.file.size, replaced: saved.replaced } });
  res.status(201).json({ caption: { id: saved.id, language, label, url: `/media/captions/${saved.id}`, fileName: originalName } });
});

mediaUploadRouter.delete('/manage/lessons/:lessonId/captions/:captionId', requireAuth, async (req, res) => {
  const removeCaption = db.transaction(() => {
    const lesson = courseFromLesson(req.params.lessonId);
    if (!lesson) fail(404, 'Lesson not found.', 'not_found');
    const course = requireCurrentCourseManager(lesson.id, req.currentUser.id);
    const caption = db.prepare('SELECT * FROM lesson_captions WHERE id = ? AND lesson_id = ?')
      .get(req.params.captionId, lesson.lesson_id);
    if (!caption) fail(404, 'Caption track not found.', 'not_found');
    db.prepare('DELETE FROM lesson_captions WHERE id = ?').run(caption.id);
    db.prepare('UPDATE courses SET updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.currentUser.id, course.id);
    return { lesson, course, caption };
  });
  const { lesson, course, caption } = removeCaption.immediate();
  await cleanupTemporaryUpload({ path: path.join(config.mediaRoot, course.id, caption.file_name), filename: caption.file_name },
    'Caption file cleanup failed after track removal', { courseId: course.id, lessonId: lesson.lesson_id, captionId: caption.id });
  writeAuditLog({ actor: req.currentUser, action: 'course.caption_removed', entityType: 'lesson', entityId: lesson.lesson_id,
    summary: `Removed ${caption.language} captions from ${lesson.lesson_title}`,
    details: { courseId: course.id, captionId: caption.id, language: caption.language } });
  res.status(204).end();
});

protectedMediaRouter.get('/captions/:captionId', requireAuth, (req, res, next) => {
  const caption = db.prepare(`
    SELECT lc.*, c.id AS course_id FROM lesson_captions lc
    JOIN lessons l ON l.id = lc.lesson_id
    JOIN course_modules m ON m.id = l.module_id
    JOIN courses c ON c.id = m.course_id
    WHERE lc.id = ?
  `).get(req.params.captionId);
  if (!caption) return res.status(404).json({ error: 'Caption track not found.', code: 'not_found' });
  try { requireCourseViewer(caption.course_id, req.currentUser); }
  catch (error) { return next(error); }
  const base = path.resolve(config.mediaRoot, caption.course_id);
  const filePath = path.resolve(base, caption.file_name);
  if (!filePath.startsWith(`${base}${path.sep}`)) return res.status(404).json({ error: 'Caption track not found.', code: 'not_found' });
  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) return res.status(404).json({ error: 'Caption track not found.', code: 'not_found' });
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'HEAD') return res.end();
    streamFileToResponse(filePath, res, next);
  });
});

protectedMediaRouter.get('/resources/:resourceId', requireAuth, (req, res, next) => {
  const resource = db.prepare(`
    SELECT lr.*, c.id AS course_id FROM lesson_resources lr
    JOIN lessons l ON l.id = lr.lesson_id
    JOIN course_modules m ON m.id = l.module_id
    JOIN courses c ON c.id = m.course_id
    WHERE lr.id = ? AND lr.resource_type = 'document'
  `).get(req.params.resourceId);
  if (!resource) return res.status(404).json({ error: 'Document not found.', code: 'not_found' });
  try { requireCourseViewer(resource.course_id, req.currentUser); }
  catch (error) { return next(error); }
  const base = path.resolve(config.mediaRoot, resource.course_id);
  const filePath = path.resolve(base, resource.file_name);
  if (!filePath.startsWith(`${base}${path.sep}`)) return res.status(404).json({ error: 'Document not found.', code: 'not_found' });
  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) return res.status(404).json({ error: 'Document not found.', code: 'not_found' });
    res.setHeader('Cache-Control', 'private, no-store');
    res.attachment(resource.original_name);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', stats.size);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'HEAD') return res.end();
    streamFileToResponse(filePath, res, next);
  });
});

protectedMediaRouter.get('/:mediaId', requireAuth, (req, res, next) => {
  const media = db.prepare('SELECT * FROM media_files WHERE id = ?').get(req.params.mediaId);
  if (!media) return res.status(404).json({ error: 'Media not found.', code: 'not_found' });
  const course = courseById(media.course_id);
  try { requireCourseViewer(media.course_id, req.currentUser); }
  catch (error) { return next(error); }
  if (media.media_kind === 'video') {
    const linkedLesson = db.prepare('SELECT id FROM lessons WHERE media_id = ?').get(media.id);
    if (!linkedLesson) return res.status(404).json({ error: 'Media not found.', code: 'not_found' });
  }
  const base = path.resolve(config.mediaRoot, course.id);
  const filePath = path.resolve(base, media.file_name);
  if (!filePath.startsWith(`${base}${path.sep}`)) return res.status(404).json({ error: 'Media not found.', code: 'not_found' });
  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) return res.status(404).json({ error: 'Media not found.', code: 'not_found' });
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', media.mime_type);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const range = req.get('range');
    const hasIfRange = req.get('if-range') !== undefined;
    const match = req.method === 'GET' && !hasIfRange && range
      ? /^bytes=(\d*)-(\d*)$/.exec(range)
      : null;
    if (!match || (!match[1] && !match[2])) {
      res.status(200);
      res.setHeader('Content-Length', stats.size);
      if (req.method === 'HEAD') return res.end();
      return streamFileToResponse(filePath, res, next);
    }
    let start = match[1] ? Number(match[1]) : null;
    let end = match[2] ? Number(match[2]) : null;
    if (start === null) {
      const suffixLength = end;
      start = Math.max(stats.size - suffixLength, 0);
      end = stats.size - 1;
    } else if (end === null || end >= stats.size) {
      end = stats.size - 1;
    }
    if (start >= stats.size || end < start) {
      res.setHeader('Content-Range', `bytes */${stats.size}`);
      return res.status(416).end();
    }
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stats.size}`);
    res.setHeader('Content-Length', end - start + 1);
    if (req.method === 'HEAD') return res.end();
    return streamFileToResponse(filePath, res, next, { start, end });
  });
});
