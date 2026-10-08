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

export const mediaUploadRouter = Router();
export const protectedMediaRouter = Router();

const imageTypes = new Map([
  ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.png', 'image/png'], ['.webp', 'image/webp'],
]);

function storedFilename(originalName, kind) {
  const ext = path.extname(originalName).toLowerCase();
  const safeExt = kind === 'video' ? '.mp4' : ext;
  return `${randomUUID()}${safeExt}`;
}

const upload = multer({
  storage: multer.diskStorage({
    destination(req, _file, callback) {
      try {
        const courseId = String(req.params.courseId || '');
        const root = path.resolve(config.mediaRoot);
        const directory = path.resolve(root, courseId);
        if (!directory.startsWith(`${root}${path.sep}`)) return callback(new Error('Invalid media destination.'));
        fs.mkdirSync(directory, { recursive: true });
        callback(null, directory);
      } catch (error) { callback(error); }
    },
    filename(req, file, callback) {
      callback(null, storedFilename(file.originalname, req.body?.kind === 'cover' ? 'cover' : 'video'));
    },
  }),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter(req, file, callback) {
    const kind = req.body?.kind === 'cover' ? 'cover' : 'video';
    const ext = path.extname(file.originalname).toLowerCase();
    if (kind === 'video' && ext === '.mp4' && file.mimetype === 'video/mp4') return callback(null, true);
    if (kind === 'cover' && imageTypes.get(ext) === file.mimetype) return callback(null, true);
    return callback(new ApiError(400, kind === 'video' ? 'Upload an MP4 video file.' : 'Upload a JPG, PNG, or WebP course cover.', 'invalid_media_type'));
  },
});

function authorizeManagerParam(req, _res, next) {
  try {
    requireCourseManager(req.params.courseId, req.currentUser);
    next();
  } catch (error) { next(error); }
}

mediaUploadRouter.post('/manage/courses/:courseId/media', requireAuth, authorizeManagerParam, upload.single('file'), (req, res) => {
  if (!req.file) fail(400, 'Choose a file to upload.', 'file_required');
  const course = courseById(req.params.courseId);
  const kind = req.body?.kind === 'cover' ? 'cover' : 'video';
  const lessonId = req.body?.lessonId ? String(req.body.lessonId) : '';
  if (kind === 'video') {
    const lesson = lessonId && courseFromLesson(lessonId);
    if (!lesson || lesson.id !== course.id) {
      fs.rmSync(req.file.path, { force: true });
      fail(400, 'Choose a lesson in this course before uploading a video.', 'invalid_lesson');
    }
  }
  const id = randomUUID();
  try {
    const save = db.transaction(() => {
      db.prepare(`INSERT INTO media_files (id, course_id, original_name, file_name, mime_type, byte_size, media_kind)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, course.id, req.file.originalname.slice(0, 255), req.file.filename, req.file.mimetype, req.file.size, kind);
      if (kind === 'cover') {
        const previous = course.cover_media_id;
        db.prepare('UPDATE courses SET cover_media_id = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(id, req.currentUser.id, course.id);
        return previous;
      }
      const previous = db.prepare('SELECT media_id FROM lessons WHERE id = ?').get(lessonId)?.media_id;
      db.prepare('UPDATE lessons SET media_id = ? WHERE id = ?').run(id, lessonId);
      db.prepare('UPDATE courses SET updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.currentUser.id, course.id);
      return previous;
    });
    const previousId = save();
    if (previousId) {
      const previous = db.prepare('SELECT file_name FROM media_files WHERE id = ?').get(previousId);
      if (previous) {
        db.prepare('DELETE FROM media_files WHERE id = ?').run(previousId);
        fs.rmSync(path.join(config.mediaRoot, course.id, previous.file_name), { force: true });
      }
    }
  } catch (error) {
    fs.rmSync(req.file.path, { force: true });
    throw error;
  }
  res.status(201).json({ media: { id, url: `/media/${id}`, name: req.file.originalname, bytes: req.file.size, kind } });
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
    res.setHeader('Content-Type', media.mime_type);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const range = req.get('range');
    if (!range) {
      res.setHeader('Content-Length', stats.size);
      if (req.method === 'HEAD') return res.status(200).end();
      return fs.createReadStream(filePath).on('error', next).pipe(res);
    }
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) {
      res.setHeader('Content-Range', `bytes */${stats.size}`);
      return res.status(416).end();
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
    return fs.createReadStream(filePath, { start, end }).on('error', next).pipe(res);
  });
});

