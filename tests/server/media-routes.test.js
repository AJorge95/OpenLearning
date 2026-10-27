import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { once } from 'node:events';
import { createServer, request as createRequest } from 'node:http';
import express from 'express';
import { after, before, test } from 'node:test';

const isolatedConfig = {
  NODE_ENV: 'test',
  DATA_DIR: '',
  DB_PATH: '',
  MEDIA_ROOT: '',
  SESSION_SECRET: 'isolated-media-route-tests',
  TRUST_PROXY: 'false',
  PORT: '3000',
  MAX_UPLOAD_BYTES: '2147483648',
  REQUEST_TIMEOUT_MS: '300000',
};
const previousConfig = new Map(Object.keys(isolatedConfig).map((key) => [key, process.env[key]]));
let fixtureDirectory;
let database;
let server;
let captionPath;
let errorHandler;
const captionDownloadContents = Buffer.from('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nWelcome to the lesson.\n');
const rangeMediaContents = Buffer.from('0123456789');
const documentDownloadContents = Buffer.from('Course handout content');

before(async () => {
  const tempBase = path.resolve(os.tmpdir());
  fixtureDirectory = path.resolve(await fs.mkdtemp(path.join(tempBase, 'openlearning-media-route-')));
  if (path.dirname(fixtureDirectory) !== tempBase
    || !path.basename(fixtureDirectory).startsWith('openlearning-media-route-')) {
    throw new Error('Refusing to use an unexpected temporary directory.');
  }
  Object.assign(process.env, {
    ...isolatedConfig,
    DATA_DIR: fixtureDirectory,
    DB_PATH: path.join(fixtureDirectory, 'openlearning.sqlite'),
    MEDIA_ROOT: path.join(fixtureDirectory, 'course-media'),
  });

  ({ db: database } = await import('../../server/db.js'));
  const [{ mediaUploadRouter, protectedMediaRouter }, httpHandlers] = await Promise.all([
    import('../../server/routes-media.js'),
    import('../../server/http.js'),
  ]);
  errorHandler = httpHandlers.errorHandler;
  database.exec(`
    INSERT INTO users (id, username, email, password_hash, role, disabled)
      VALUES ('admin-media', 'media_admin', 'media-admin@example.invalid', 'not-used', 'admin', 0);
    INSERT INTO users (id, username, email, password_hash, role, disabled)
      VALUES ('learner-media', 'media_learner', 'media-learner@example.invalid', 'not-used', 'learner', 0);
    INSERT INTO courses (id, title, status, created_by, updated_by)
      VALUES ('course-caption-audit', 'Caption audit course', 'draft', 'admin-media', 'admin-media');
    INSERT INTO course_modules (id, course_id, title, position)
      VALUES ('module-caption-audit', 'course-caption-audit', 'Caption module', 0);
    INSERT INTO lessons (id, module_id, title, position)
      VALUES ('lesson-caption-audit', 'module-caption-audit', 'Caption lesson', 0);
    INSERT INTO lesson_captions (id, lesson_id, language, label, file_name, original_name, byte_size)
      VALUES ('caption-audit', 'lesson-caption-audit', 'en', 'English', 'caption-audit.vtt', 'captions.vtt', 20);
    INSERT INTO courses (id, title, status, created_by, updated_by)
      VALUES ('course-range-tests', 'Media range test course', 'draft', 'admin-media', 'admin-media');
    INSERT INTO course_modules (id, course_id, title, position)
      VALUES ('module-range-tests', 'course-range-tests', 'Media range module', 0);
    INSERT INTO media_files (id, course_id, original_name, file_name, mime_type, byte_size, media_kind)
      VALUES ('media-range-tests', 'course-range-tests', 'range-test.mp4', 'range-test.mp4', 'video/mp4', 10, 'video');
    INSERT INTO lessons (id, module_id, title, position, media_id)
      VALUES ('lesson-range-tests', 'module-range-tests', 'Media range lesson', 0, 'media-range-tests');
    INSERT INTO courses (id, title, status, visibility, created_by, updated_by)
      VALUES ('course-document-download', 'Document download test course', 'published', 'public', 'admin-media', 'admin-media');
    INSERT INTO course_modules (id, course_id, title, position)
      VALUES ('module-document-download', 'course-document-download', 'Document module', 0);
    INSERT INTO lessons (id, module_id, title, position) VALUES
      ('lesson-document-download-open', 'module-document-download', 'Open document lesson', 0),
      ('lesson-document-download-locked', 'module-document-download', 'Locked document lesson', 1);
  `);
  const courseMediaDirectory = path.join(fixtureDirectory, 'course-media', 'course-caption-audit');
  captionPath = path.join(courseMediaDirectory, 'caption-audit.vtt');
  await fs.mkdir(courseMediaDirectory, { recursive: true });
  await fs.writeFile(captionPath, 'WEBVTT\n\nfixture text');
  const rangeMediaDirectory = path.join(fixtureDirectory, 'course-media', 'course-range-tests');
  const rangeMediaPath = path.join(rangeMediaDirectory, 'range-test.mp4');
  await fs.mkdir(rangeMediaDirectory, { recursive: true });
  await fs.writeFile(rangeMediaPath, rangeMediaContents);
  const documentMediaDirectory = path.join(fixtureDirectory, 'course-media', 'course-document-download');
  await fs.mkdir(documentMediaDirectory, { recursive: true });
  await fs.writeFile(path.join(documentMediaDirectory, 'handout.txt'), documentDownloadContents);
  await fs.writeFile(path.join(documentMediaDirectory, 'locked-handout.txt'), documentDownloadContents);
  await fs.writeFile(path.join(documentMediaDirectory, 'open-captions.vtt'), captionDownloadContents);
  await fs.writeFile(path.join(documentMediaDirectory, 'locked-captions.vtt'), captionDownloadContents);
  const insertResource = database.prepare(`INSERT INTO lesson_resources
    (id, lesson_id, resource_type, title, file_name, original_name, mime_type, byte_size, position)
    VALUES (?, ?, 'document', ?, ?, ?, 'text/plain', ?, 0)`);
  insertResource.run('resource-download-open', 'lesson-document-download-open', 'Course handout', 'handout.txt', 'course-handout.txt', documentDownloadContents.length);
  insertResource.run('resource-download-locked', 'lesson-document-download-locked', 'Locked handout', 'locked-handout.txt', 'locked-handout.txt', documentDownloadContents.length);
  const insertCaption = database.prepare(`INSERT INTO lesson_captions
    (id, lesson_id, language, label, file_name, original_name, byte_size)
    VALUES (?, ?, 'en', 'English', ?, 'captions.vtt', ?)`);
  insertCaption.run('caption-download-open', 'lesson-document-download-open', 'open-captions.vtt', captionDownloadContents.length);
  insertCaption.run('caption-download-locked', 'lesson-document-download-locked', 'locked-captions.vtt', captionDownloadContents.length);

  const app = express();
  app.use(express.json());
  app.post('/api/upload-limit-test', (_req, _res, next) => {
    const error = new Error('File too large');
    error.name = 'MulterError';
    error.code = 'LIMIT_FILE_SIZE';
    next(error);
  });
  app.use((req, _res, next) => {
    req.currentUser = database.prepare('SELECT id, username, role, disabled FROM users WHERE id = ?')
      .get(req.get('x-test-user'));
    next();
  });
  app.use('/api', mediaUploadRouter);
  app.use('/media', protectedMediaRouter);
  app.use(errorHandler);
  server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
});

after(async () => {
  if (server?.listening) {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
  }
  if (database?.open) database.close();
  if (fixtureDirectory) {
    const tempBase = path.resolve(os.tmpdir());
    const resolvedDirectory = path.resolve(fixtureDirectory);
    if (path.dirname(resolvedDirectory) !== tempBase
      || !path.basename(resolvedDirectory).startsWith('openlearning-media-route-')) {
      throw new Error('Refusing to remove an unexpected temporary directory.');
    }
    await fs.rm(resolvedDirectory, { recursive: true, force: true });
  }
  for (const [key, value] of previousConfig) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function apiUrl(pathname) {
  const address = server.address();
  assert(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}/api${pathname}`;
}

function mediaUrl(pathname) {
  const address = server.address();
  assert(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}/media${pathname}`;
}

function pngCoverHeader(width, height) {
  const contents = Buffer.alloc(45);
  contents.set([137, 80, 78, 71, 13, 10, 26, 10]);
  contents.writeUInt32BE(13, 8);
  contents.write('IHDR', 12, 'ascii');
  contents.writeUInt32BE(width, 16);
  contents.writeUInt32BE(height, 20);
  contents.write('IEND', 37, 'ascii');
  return contents;
}

function jpegCoverHeader(width, height) {
  const contents = Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01, 0x00, 0x01, 0x03,
    0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00, 0xff, 0xd9,
  ]);
  contents.writeUInt16BE(height, 7);
  contents.writeUInt16BE(width, 9);
  return contents;
}

function webpCoverHeader(chunkType, width, height) {
  const chunkSize = chunkType === 'VP8L' ? 5 : 10;
  const paddedChunkSize = chunkSize + (chunkSize % 2);
  const riffSize = 4 + 8 + paddedChunkSize;
  const contents = Buffer.alloc(8 + riffSize);
  contents.write('RIFF', 0, 'ascii');
  contents.writeUInt32LE(riffSize, 4);
  contents.write('WEBP', 8, 'ascii');
  contents.write(chunkType, 12, 'ascii');
  contents.writeUInt32LE(chunkSize, 16);
  if (chunkType === 'VP8X') {
    contents.writeUIntLE(width - 1, 24, 3);
    contents.writeUIntLE(height - 1, 27, 3);
  } else if (chunkType === 'VP8L') {
    const encodedWidth = width - 1;
    const encodedHeight = height - 1;
    contents[20] = 0x2f;
    contents[21] = encodedWidth & 0xff;
    contents[22] = ((encodedWidth >> 8) & 0x3f) | ((encodedHeight & 0x03) << 6);
    contents[23] = (encodedHeight >> 2) & 0xff;
    contents[24] = (encodedHeight >> 10) & 0x0f;
  } else {
    contents[23] = 0x9d;
    contents[24] = 0x01;
    contents[25] = 0x2a;
    contents.writeUInt16LE(width, 26);
    contents.writeUInt16LE(height, 28);
  }
  return contents;
}

async function uploadCourseCover(filename, contents, mimeType) {
  const form = new FormData();
  form.set('kind', 'cover');
  form.set('file', new File([contents], filename, { type: mimeType }));
  return fetch(apiUrl('/manage/courses/course-caption-audit/media'), {
    method: 'POST',
    headers: { 'x-test-user': 'admin-media', connection: 'close' },
    body: form,
  });
}

async function waitForPartialUpload(directory, originalFiles) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    for (const filename of await fs.readdir(directory)) {
      if (originalFiles.has(filename)) continue;
      const filePath = path.join(directory, filename);
      try {
        if ((await fs.stat(filePath)).size > 0) return filePath;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return null;
}

async function waitForUploadCleanup(directory, originalFiles) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const currentFiles = (await fs.readdir(directory)).sort();
    if (currentFiles.length === originalFiles.length
      && currentFiles.every((filename, index) => filename === originalFiles[index])) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

test('aborted multipart uploads remove partial files without logging a server error', async () => {
  const courseMediaDirectory = path.dirname(captionPath);
  const originalFiles = (await fs.readdir(courseMediaDirectory)).sort();
  const originalFileSet = new Set(originalFiles);
  const originalAbortLogCount = database.prepare(`SELECT COUNT(*) AS count FROM system_logs
    WHERE source = 'http' AND message IN ('Request aborted', 'Request closed')`).get().count;
  const boundary = `openlearning-abort-${Date.now()}`;
  const prefix = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\ncover\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="interrupted-cover.png"\r\nContent-Type: image/png\r\n\r\n`);
  const partialContents = Buffer.alloc(4 * 1024 * 1024, 0x41);
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  const request = createRequest(new URL(apiUrl('/manage/courses/course-caption-audit/media')), {
    method: 'POST',
    headers: {
      'x-test-user': 'admin-media',
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': String(prefix.length + partialContents.length * 2 + suffix.length),
    },
  });
  request.on('error', () => {});

  let partialFilePath;
  try {
    // Wait until Multer has written real file bytes, then disconnect before the file part or body ends.
    request.write(prefix);
    request.write(partialContents);
    partialFilePath = await waitForPartialUpload(courseMediaDirectory, originalFileSet);
    assert.ok(partialFilePath, 'expected the upload middleware to create a partial file before aborting');
  } finally {
    request.destroy();
  }

  assert.equal(await waitForUploadCleanup(courseMediaDirectory, originalFiles), true);
  assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM system_logs
    WHERE source = 'http' AND message IN ('Request aborted', 'Request closed')`).get().count, originalAbortLogCount);
});

test('destroyed requests that close during upload do not reach the generic error logger', () => {
  const originalAbortLogCount = database.prepare(`SELECT COUNT(*) AS count FROM system_logs
    WHERE source = 'http' AND message = 'Request closed'`).get().count;
  const response = {
    headersSent: false,
    status() { assert.fail('A destroyed response should not be written.'); },
    json() { assert.fail('A destroyed response should not be written.'); },
  };
  let nextCalled = false;

  errorHandler(new Error('Request closed'), {
    aborted: false,
    destroyed: true,
    method: 'POST',
    originalUrl: '/api/manage/courses/course-caption-audit/media',
  }, response, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM system_logs
    WHERE source = 'http' AND message = 'Request closed'`).get().count, originalAbortLogCount);
});

test('unsupported document uploads list the supported document formats', async () => {
  const form = new FormData();
  form.set('lessonId', 'lesson-caption-audit');
  form.set('file', new File(['unsupported'], 'unsupported.gif', { type: 'image/gif' }));

  const response = await fetch(apiUrl('/manage/courses/course-caption-audit/lesson-documents'), {
    method: 'POST',
    headers: { 'x-test-user': 'admin-media', connection: 'close' },
    body: form,
  });
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.code, 'invalid_media_type');
  assert.equal(payload.error, 'Upload a PDF, TXT, Markdown, RTF, Word, PowerPoint, Excel, CSV, TSV, or OpenDocument file.');
});

test('rejects a truncated PNG cover and removes the temporary upload', async () => {
  const courseMediaDirectory = path.dirname(captionPath);
  const originalFiles = (await fs.readdir(courseMediaDirectory)).sort();
  const originalMediaCount = database.prepare('SELECT COUNT(*) AS count FROM media_files').get().count;
  const originalAuditCount = database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.cover_uploaded'").get().count;
  const truncatedPng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const form = new FormData();
  form.set('kind', 'cover');
  form.set('file', new File([truncatedPng], 'truncated-cover.png', { type: 'image/png' }));

  const response = await fetch(apiUrl('/manage/courses/course-caption-audit/media'), {
    method: 'POST',
    headers: { 'x-test-user': 'admin-media', connection: 'close' },
    body: form,
  });

  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'invalid_media_type');
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM media_files').get().count, originalMediaCount);
  assert.equal(database.prepare("SELECT cover_media_id FROM courses WHERE id = 'course-caption-audit'").get().cover_media_id, null);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.cover_uploaded'").get().count, originalAuditCount);
  assert.deepEqual((await fs.readdir(courseMediaDirectory)).sort(), originalFiles);
});

test('reports a signature-read failure as retryable and removes the temporary upload', async () => {
  const courseMediaDirectory = path.dirname(captionPath);
  const originalFiles = (await fs.readdir(courseMediaDirectory)).sort();
  const originalMediaCount = database.prepare('SELECT COUNT(*) AS count FROM media_files').get().count;
  const originalOpen = fsSync.promises.open;
  fsSync.promises.open = async () => {
    throw Object.assign(new Error('Injected upload read failure.'), { code: 'EIO' });
  };

  try {
    const response = await uploadCourseCover('valid-cover.png', pngCoverHeader(1, 1), 'image/png');
    const payload = await response.json();
    assert.equal(response.status, 500);
    assert.equal(payload.code, 'media_validation_unavailable');
    assert.equal(payload.error, 'The uploaded file could not be checked. Please try again.');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM media_files').get().count, originalMediaCount);
    assert.deepEqual((await fs.readdir(courseMediaDirectory)).sort(), originalFiles);

    const log = database.prepare(`SELECT level, details_json FROM system_logs
      WHERE source = 'media' AND message = 'Upload signature validation failed' ORDER BY id DESC LIMIT 1`).get();
    assert.equal(log?.level, 'error');
    assert.deepEqual(JSON.parse(log.details_json), { kind: 'cover', errorName: 'Error', errorCode: 'EIO' });
  } finally {
    fsSync.promises.open = originalOpen;
  }
});

test('reports a caption-read failure as retryable and removes the temporary upload', async () => {
  const courseMediaDirectory = path.dirname(captionPath);
  const originalFiles = (await fs.readdir(courseMediaDirectory)).sort();
  const originalCaptionCount = database.prepare('SELECT COUNT(*) AS count FROM lesson_captions').get().count;
  const originalReadFile = fsSync.promises.readFile;
  fsSync.promises.readFile = async () => {
    throw Object.assign(new Error('Injected caption read failure.'), { code: 'EIO' });
  };

  try {
    const form = new FormData();
    form.set('lessonId', 'lesson-caption-audit');
    form.set('language', 'es');
    form.set('label', 'Spanish');
    form.set('file', new File(['WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHola.\n'], 'captions.vtt', { type: 'text/vtt' }));

    const response = await fetch(apiUrl('/manage/courses/course-caption-audit/lesson-captions'), {
      method: 'POST',
      headers: { 'x-test-user': 'admin-media', connection: 'close' },
      body: form,
    });
    const payload = await response.json();
    assert.equal(response.status, 500);
    assert.equal(payload.code, 'media_validation_unavailable');
    assert.equal(payload.error, 'The uploaded file could not be checked. Please try again.');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM lesson_captions').get().count, originalCaptionCount);
    assert.deepEqual((await fs.readdir(courseMediaDirectory)).sort(), originalFiles);

    const log = database.prepare(`SELECT level, details_json FROM system_logs
      WHERE source = 'media' AND message = 'Upload signature validation failed' ORDER BY id DESC LIMIT 1`).get();
    assert.equal(log?.level, 'error');
    assert.deepEqual(JSON.parse(log.details_json), { kind: 'caption', errorName: 'Error', errorCode: 'EIO' });
  } finally {
    fsSync.promises.readFile = originalReadFile;
  }
});

test('streams protected video byte ranges and rejects unsatisfiable ranges', async () => {
  const response = await fetch(mediaUrl('/media-range-tests'), {
    headers: { 'x-test-user': 'admin-media', range: 'bytes=2-5', connection: 'close' },
  });

  assert.equal(response.status, 206);
  assert.equal(response.headers.get('accept-ranges'), 'bytes');
  assert.equal(response.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(response.headers.get('content-length'), '4');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from('2345'));

  const suffixResponse = await fetch(mediaUrl('/media-range-tests'), {
    headers: { 'x-test-user': 'admin-media', range: 'bytes=-3', connection: 'close' },
  });
  assert.equal(suffixResponse.status, 206);
  assert.equal(suffixResponse.headers.get('content-range'), 'bytes 7-9/10');
  assert.deepEqual(Buffer.from(await suffixResponse.arrayBuffer()), Buffer.from('789'));

  const invalidResponse = await fetch(mediaUrl('/media-range-tests'), {
    headers: { 'x-test-user': 'admin-media', range: 'bytes=10-', connection: 'close' },
  });
  assert.equal(invalidResponse.status, 416);
  assert.equal(invalidResponse.headers.get('content-range'), 'bytes */10');
  assert.equal(await invalidResponse.text(), '');

  const fullResponse = await fetch(mediaUrl('/media-range-tests'), {
    headers: { 'x-test-user': 'admin-media', range: 'bytes=2-5', 'if-range': '"stale-version"', connection: 'close' },
  });
  assert.equal(fullResponse.status, 200);
  assert.equal(fullResponse.headers.get('content-length'), '10');
  assert.deepEqual(Buffer.from(await fullResponse.arrayBuffer()), rangeMediaContents);
});

test('returns a not-found response if protected media disappears before the stream opens', async () => {
  const originalCreateReadStream = fsSync.createReadStream;
  fsSync.createReadStream = () => {
    const stream = new Readable({ read() {} });
    process.nextTick(() => stream.destroy(Object.assign(new Error('Media file disappeared.'), { code: 'ENOENT' })));
    return stream;
  };

  try {
    const response = await fetch(mediaUrl('/media-range-tests'), {
      headers: { 'x-test-user': 'admin-media', range: 'bytes=2-5', connection: 'close' },
    });

    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type') || '', /^application\/json/);
    assert.equal(response.headers.get('content-range'), null);
    assert.equal(response.headers.get('accept-ranges'), null);
    assert.deepEqual(await response.json(), { error: 'Media not found.', code: 'not_found' });
  } finally {
    fsSync.createReadStream = originalCreateReadStream;
  }
});

test('video read failures log the media and requested byte range without filesystem paths', async () => {
  const originalCreateReadStream = fsSync.createReadStream;
  fsSync.createReadStream = () => {
    const stream = new Readable({ read() {} });
    stream.bytesRead = 0;
    process.nextTick(() => stream.destroy(Object.assign(new Error('Injected video read failure.'), { code: 'EIO' })));
    return stream;
  };
  try {
    const response = await fetch(mediaUrl('/media-range-tests'), {
      headers: { 'x-test-user': 'admin-media', range: 'bytes=2-5', connection: 'close' },
    });
    assert.equal(response.status, 500);
    await response.json();
    const log = database.prepare("SELECT details_json FROM system_logs WHERE source = 'media-playback' AND message = 'Video file read failed' ORDER BY id DESC LIMIT 1").get();
    assert.deepEqual(JSON.parse(log.details_json), { mediaId: 'media-range-tests', courseId: 'course-range-tests',
      declaredFileBytes: 10, actualFileBytes: 10, rangeStart: 2, rangeEnd: 5, expectedBytes: 4, bytesRead: 0, errorCode: 'EIO' });
    assert.equal(log.details_json.includes(fixtureDirectory), false);
  } finally {
    fsSync.createReadStream = originalCreateReadStream;
  }
});

test('video short reads produce delivery diagnostics even without a filesystem error', async () => {
  const originalCreateReadStream = fsSync.createReadStream;
  fsSync.createReadStream = () => {
    const stream = Readable.from([Buffer.from('23')]);
    stream.bytesRead = 2;
    return stream;
  };
  try {
    const response = await fetch(mediaUrl('/media-range-tests'), {
      headers: { 'x-test-user': 'admin-media', range: 'bytes=2-5', connection: 'close' },
    });
    await assert.rejects(response.arrayBuffer());
    const log = database.prepare("SELECT details_json FROM system_logs WHERE source = 'media-playback' AND message = 'Video file ended before all requested bytes were read' ORDER BY id DESC LIMIT 1").get();
    const details = JSON.parse(log.details_json);
    assert.equal(details.expectedBytes, 4);
    assert.equal(details.bytesRead, 2);
    assert.equal(details.rangeStart, 2);
  } finally {
    fsSync.createReadStream = originalCreateReadStream;
  }
});

test('falls back to full protected video responses for unsupported ranges and ranged HEAD requests', async () => {
  for (const range of ['bytes=0-1,3-4', 'items=0-1', 'bytes=not-a-range', 'bytes=-']) {
    const response = await fetch(mediaUrl('/media-range-tests'), {
      headers: { 'x-test-user': 'admin-media', range, connection: 'close' },
    });

    assert.equal(response.status, 200, range);
    assert.equal(response.headers.get('content-length'), String(rangeMediaContents.length), range);
    assert.equal(response.headers.get('content-range'), null, range);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), rangeMediaContents, range);
  }

  const headResponse = await fetch(mediaUrl('/media-range-tests'), {
    method: 'HEAD',
    headers: { 'x-test-user': 'admin-media', range: 'bytes=2-5', connection: 'close' },
  });
  assert.equal(headResponse.status, 200);
  assert.equal(headResponse.headers.get('content-length'), String(rangeMediaContents.length));
  assert.equal(headResponse.headers.get('content-range'), null);
  assert.equal(await headResponse.text(), '');
});

test('checks video access before serving a byte range', async () => {
  const anonymousResponse = await fetch(mediaUrl('/media-range-tests'), {
    headers: { range: 'bytes=0-0', connection: 'close' },
  });
  assert.equal(anonymousResponse.status, 401);
  assert.equal((await anonymousResponse.json()).code, 'unauthorized');

  const learnerResponse = await fetch(mediaUrl('/media-range-tests'), {
    headers: { 'x-test-user': 'learner-media', range: 'bytes=0-0', connection: 'close' },
  });
  assert.equal(learnerResponse.status, 403);
  assert.equal((await learnerResponse.json()).code, 'course_access_denied');
});

test('serves lesson documents to authorized learners with private download headers', async () => {
  const resourceUrl = mediaUrl('/resources/resource-download-open');
  const anonymousResponse = await fetch(resourceUrl, { headers: { connection: 'close' } });
  assert.equal(anonymousResponse.status, 401);
  assert.equal((await anonymousResponse.json()).code, 'unauthorized');

  const response = await fetch(resourceUrl, {
    headers: { 'x-test-user': 'learner-media', connection: 'close' },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('content-type'), 'application/octet-stream');
  assert.match(response.headers.get('content-disposition') || '', /attachment;.*filename="course-handout\.txt"/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(Number(response.headers.get('content-length')), documentDownloadContents.length);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), documentDownloadContents);

  const headResponse = await fetch(resourceUrl, {
    method: 'HEAD',
    headers: { 'x-test-user': 'learner-media', connection: 'close' },
  });
  assert.equal(headResponse.status, 200);
  assert.equal(Number(headResponse.headers.get('content-length')), documentDownloadContents.length);
  assert.equal(await headResponse.text(), '');
});

test('blocks protected document downloads when the lesson is still locked', async () => {
  const response = await fetch(mediaUrl('/resources/resource-download-locked'), {
    headers: { 'x-test-user': 'learner-media', connection: 'close' },
  });

  assert.equal(response.status, 423);
  assert.equal((await response.json()).code, 'lesson_locked');
});

test('serves caption tracks only to viewers with access to the unlocked lesson', async () => {
  const captionUrl = mediaUrl('/captions/caption-download-open');
  const anonymousResponse = await fetch(captionUrl, { headers: { connection: 'close' } });
  assert.equal(anonymousResponse.status, 401);
  assert.equal((await anonymousResponse.json()).code, 'unauthorized');

  const response = await fetch(captionUrl, {
    headers: { 'x-test-user': 'learner-media', connection: 'close' },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('content-type'), 'text/vtt; charset=utf-8');
  assert.equal(response.headers.get('content-disposition'), 'inline');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(Number(response.headers.get('content-length')), captionDownloadContents.length);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), captionDownloadContents);

  const headResponse = await fetch(captionUrl, {
    method: 'HEAD',
    headers: { 'x-test-user': 'learner-media', connection: 'close' },
  });
  assert.equal(headResponse.status, 200);
  assert.equal(Number(headResponse.headers.get('content-length')), captionDownloadContents.length);
  assert.equal(await headResponse.text(), '');

  const lockedResponse = await fetch(mediaUrl('/captions/caption-download-locked'), {
    headers: { 'x-test-user': 'learner-media', connection: 'close' },
  });
  assert.equal(lockedResponse.status, 423);
  assert.equal((await lockedResponse.json()).code, 'lesson_locked');
});

test('rejects truncated WebP RIFF headers and image chunks without saving media', async () => {
  const courseMediaDirectory = path.dirname(captionPath);
  const originalFiles = (await fs.readdir(courseMediaDirectory)).sort();
  const originalMediaCount = database.prepare('SELECT COUNT(*) AS count FROM media_files').get().count;
  const originalAuditCount = database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.cover_uploaded'").get().count;
  const headerOnlyWebp = Buffer.alloc(12);
  headerOnlyWebp.write('RIFF', 0, 'ascii');
  headerOnlyWebp.writeUInt32LE(4, 4);
  headerOnlyWebp.write('WEBP', 8, 'ascii');
  const truncatedImageChunkWebp = Buffer.alloc(20);
  truncatedImageChunkWebp.write('RIFF', 0, 'ascii');
  truncatedImageChunkWebp.writeUInt32LE(12, 4);
  truncatedImageChunkWebp.write('WEBP', 8, 'ascii');
  truncatedImageChunkWebp.write('VP8 ', 12, 'ascii');
  truncatedImageChunkWebp.writeUInt32LE(4, 16);

  for (const [filename, contents] of [
    ['header-only-cover.webp', headerOnlyWebp],
    ['truncated-chunk-cover.webp', truncatedImageChunkWebp],
  ]) {
    const form = new FormData();
    form.set('kind', 'cover');
    form.set('file', new File([contents], filename, { type: 'image/webp' }));

    const response = await fetch(apiUrl('/manage/courses/course-caption-audit/media'), {
      method: 'POST',
      headers: { 'x-test-user': 'admin-media', connection: 'close' },
      body: form,
    });

    assert.equal(response.status, 400, filename);
    assert.equal((await response.json()).code, 'invalid_media_type', filename);
  }

  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM media_files').get().count, originalMediaCount);
  assert.equal(database.prepare("SELECT cover_media_id FROM courses WHERE id = 'course-caption-audit'").get().cover_media_id, null);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.cover_uploaded'").get().count, originalAuditCount);
  assert.deepEqual((await fs.readdir(courseMediaDirectory)).sort(), originalFiles);
});

test('bounds course cover dimensions for PNG, JPEG, and each supported WebP encoding', async () => {
  const courseId = 'course-caption-audit';
  const courseMediaDirectory = path.dirname(captionPath);
  const originalFiles = (await fs.readdir(courseMediaDirectory)).sort();
  const originalCourse = database.prepare('SELECT cover_media_id, updated_at, updated_by FROM courses WHERE id = ?').get(courseId);
  const originalMediaIds = new Set(database.prepare('SELECT id FROM media_files').all().map(({ id }) => id));
  const originalCoverAuditIds = new Set(database.prepare("SELECT id FROM audit_logs WHERE action = 'course.cover_uploaded' AND entity_id = ?").all(courseId).map(({ id }) => id));
  const invalidCovers = [
    ['wide-cover.png', pngCoverHeader(4097, 1), 'image/png'],
    ['tall-cover.jpg', jpegCoverHeader(1, 4097), 'image/jpeg'],
    ['wide-lossy-cover.webp', webpCoverHeader('VP8 ', 4097, 1), 'image/webp'],
    ['tall-lossless-cover.webp', webpCoverHeader('VP8L', 1, 4097), 'image/webp'],
    ['oversized-extended-cover.webp', webpCoverHeader('VP8X', 4097, 4097), 'image/webp'],
  ];

  try {
    for (const [filename, contents, mimeType] of invalidCovers) {
      const response = await uploadCourseCover(filename, contents, mimeType);
      const payload = await response.json();
      assert.equal(response.status, 400, filename);
      assert.equal(payload.code, 'invalid_media_type', filename);
      assert.match(payload.error, /4096 × 4096 pixels/, filename);
    }

    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM media_files').get().count, originalMediaIds.size);
    assert.equal(database.prepare('SELECT cover_media_id FROM courses WHERE id = ?').get(courseId).cover_media_id, originalCourse.cover_media_id);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.cover_uploaded' AND entity_id = ?").get(courseId).count, originalCoverAuditIds.size);
    assert.deepEqual((await fs.readdir(courseMediaDirectory)).sort(), originalFiles);

    for (const [filename, contents, mimeType] of [
      ['boundary-cover.png', pngCoverHeader(4096, 4096), 'image/png'],
      ['small-cover.jpg', jpegCoverHeader(1, 1), 'image/jpeg'],
      ['small-lossy-cover.webp', webpCoverHeader('VP8 ', 1, 1), 'image/webp'],
      ['small-lossless-cover.webp', webpCoverHeader('VP8L', 1, 1), 'image/webp'],
      ['small-extended-cover.webp', webpCoverHeader('VP8X', 1, 1), 'image/webp'],
    ]) {
      const response = await uploadCourseCover(filename, contents, mimeType);
      assert.equal(response.status, 201, filename);
    }
  } finally {
    database.prepare('UPDATE courses SET cover_media_id = ?, updated_at = ?, updated_by = ? WHERE id = ?')
      .run(originalCourse.cover_media_id, originalCourse.updated_at, originalCourse.updated_by, courseId);
    const createdMedia = database.prepare('SELECT id, file_name FROM media_files WHERE course_id = ?').all(courseId)
      .filter(({ id }) => !originalMediaIds.has(id));
    for (const { file_name: fileName } of createdMedia) {
      await fs.rm(path.join(courseMediaDirectory, fileName), { force: true });
    }
    for (const { id } of createdMedia) database.prepare('DELETE FROM media_files WHERE id = ?').run(id);
    const createdAuditIds = database.prepare("SELECT id FROM audit_logs WHERE action = 'course.cover_uploaded' AND entity_id = ?").all(courseId)
      .filter(({ id }) => !originalCoverAuditIds.has(id));
    for (const { id } of createdAuditIds) database.prepare('DELETE FROM audit_logs WHERE id = ?').run(id);
  }

  assert.deepEqual(database.prepare('SELECT cover_media_id, updated_at, updated_by FROM courses WHERE id = ?').get(courseId), originalCourse);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM media_files').get().count, originalMediaIds.size);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.cover_uploaded' AND entity_id = ?").get(courseId).count, originalCoverAuditIds.size);
  assert.deepEqual((await fs.readdir(courseMediaDirectory)).sort(), originalFiles);
});

test('Multer upload-limit errors report the active configured size', async () => {
  const response = await fetch(apiUrl('/upload-limit-test'), { method: 'POST' });

  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), {
    error: 'This file exceeds the configured upload limit of 2 GiB (2,147,483,648 bytes).',
    code: 'LIMIT_FILE_SIZE',
  });
});

test('multipart field-size errors use a clear client message', async () => {
  const form = new FormData();
  form.set('kind', 'x'.repeat(8 * 1024 + 1));

  const response = await fetch(apiUrl('/manage/courses/course-caption-audit/media'), {
    method: 'POST',
    headers: { 'x-test-user': 'admin-media', connection: 'close' },
    body: form,
  });

  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), {
    error: 'A form field exceeds the maximum allowed size.',
    code: 'LIMIT_FIELD_VALUE',
  });
});

test('caption upload-size errors report the caption-specific limit and clean up partial files', async () => {
  const originalFiles = await fs.readdir(path.dirname(captionPath));
  const originalCaptionCount = database.prepare('SELECT COUNT(*) AS count FROM lesson_captions').get().count;
  const form = new FormData();
  form.set('lessonId', 'lesson-caption-audit');
  form.set('language', 'en');
  form.set('label', 'English');
  form.set('file', new File([Buffer.alloc(5 * 1024 * 1024 + 1)], 'oversized.vtt', { type: 'text/vtt' }));

  const response = await fetch(apiUrl('/manage/courses/course-caption-audit/lesson-captions'), {
    method: 'POST',
    headers: { 'x-test-user': 'admin-media', connection: 'close' },
    body: form,
  });

  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), {
    error: 'This file exceeds the configured upload limit of 5 MiB (5,242,880 bytes).',
    code: 'LIMIT_FILE_SIZE',
  });
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM lesson_captions').get().count, originalCaptionCount);
  assert.deepEqual(await fs.readdir(path.dirname(captionPath)), originalFiles);
});

test('cover replacement preserves the old image when its audit event cannot be saved', async () => {
  const courseId = 'course-caption-audit';
  const previousFileName = 'original-cover.png';
  const previousFilePath = path.join(path.dirname(captionPath), previousFileName);
  const pngContents = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+b5XcAAAAASUVORK5CYII=', 'base64');
  await fs.writeFile(previousFilePath, pngContents);
  database.prepare(`INSERT INTO media_files (id, course_id, original_name, file_name, mime_type, byte_size, media_kind)
    VALUES ('media-old-cover', ?, 'original-cover.png', ?, 'image/png', ?, 'cover')`)
    .run(courseId, previousFileName, pngContents.length);
  database.prepare('UPDATE courses SET cover_media_id = ? WHERE id = ?').run('media-old-cover', courseId);
  const originalCourse = database.prepare('SELECT cover_media_id, updated_at, updated_by FROM courses WHERE id = ?').get(courseId);
  const originalFiles = (await fs.readdir(path.dirname(captionPath))).sort();
  const initialAuditCount = database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.cover_uploaded' AND entity_id = ?").get(courseId).count;
  database.exec(`CREATE TRIGGER reject_cover_uploaded_audit BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'course.cover_uploaded' BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END`);
  const makeForm = () => {
    const form = new FormData();
    form.set('kind', 'cover');
    form.set('file', new File([pngContents], 'updated-cover.png', { type: 'image/png' }));
    return form;
  };

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const failedResponse = await fetch(apiUrl(`/manage/courses/${courseId}/media`), {
      method: 'POST',
      headers: { 'x-test-user': 'admin-media', connection: 'close' },
      body: makeForm(),
    });
    assert.equal(failedResponse.status, 500);
    assert.equal((await failedResponse.json()).code, 'audit_unavailable');
    assert.deepEqual(database.prepare('SELECT cover_media_id, updated_at, updated_by FROM courses WHERE id = ?').get(courseId), originalCourse);
    assert.ok(database.prepare("SELECT id FROM media_files WHERE id = 'media-old-cover'").get());
    assert.deepEqual(await fs.readFile(previousFilePath), pngContents);
    assert.deepEqual((await fs.readdir(path.dirname(captionPath))).sort(), originalFiles);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.cover_uploaded' AND entity_id = ?").get(courseId).count, initialAuditCount);
  } finally {
    database.exec('DROP TRIGGER IF EXISTS reject_cover_uploaded_audit');
    console.error = originalConsoleError;
  }

  const retryResponse = await fetch(apiUrl(`/manage/courses/${courseId}/media`), {
    method: 'POST',
    headers: { 'x-test-user': 'admin-media', connection: 'close' },
    body: makeForm(),
  });
  assert.equal(retryResponse.status, 201);
  const { media } = await retryResponse.json();
  assert.equal(media.kind, 'cover');
  assert.equal(media.name, 'updated-cover.png');
  assert.notEqual(media.id, 'media-old-cover');
  assert.equal(database.prepare('SELECT cover_media_id FROM courses WHERE id = ?').get(courseId).cover_media_id, media.id);
  assert.equal(database.prepare("SELECT id FROM media_files WHERE id = 'media-old-cover'").get(), undefined);
  assert.deepEqual(await fs.readFile(path.join(path.dirname(captionPath), database.prepare('SELECT file_name FROM media_files WHERE id = ?').get(media.id).file_name)), pngContents);
  await assert.rejects(fs.stat(previousFilePath), { code: 'ENOENT' });
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.cover_uploaded' AND entity_id = ?").get(courseId).count, initialAuditCount + 1);
});

test('video replacement preserves the old lesson media when its audit event cannot be saved', async () => {
  const courseId = 'course-caption-audit';
  const lessonId = 'lesson-caption-audit';
  const previousFileName = 'original-video.mp4';
  const previousFilePath = path.join(path.dirname(captionPath), previousFileName);
  const mp4Contents = Buffer.alloc(24);
  mp4Contents.writeUInt32BE(mp4Contents.length, 0);
  mp4Contents.write('ftyp', 4, 'ascii');
  mp4Contents.write('isom', 8, 'ascii');
  mp4Contents.writeUInt32BE(0, 12);
  mp4Contents.write('isom', 16, 'ascii');
  await fs.writeFile(previousFilePath, mp4Contents);
  database.prepare(`INSERT INTO media_files (id, course_id, original_name, file_name, mime_type, byte_size, media_kind)
    VALUES ('media-old-video', ?, 'original-video.mp4', ?, 'video/mp4', ?, 'video')`)
    .run(courseId, previousFileName, mp4Contents.length);
  database.prepare('UPDATE lessons SET media_id = ? WHERE id = ?').run('media-old-video', lessonId);
  database.prepare(`INSERT INTO lesson_watch_progress
    (user_id, lesson_id, watched_until_seconds, duration_seconds, last_position_seconds, last_heartbeat_at)
    VALUES ('learner-media', ?, 36, 60, 36, 1_800_000_000_000)`).run(lessonId);
  database.prepare(`INSERT INTO lesson_watch_telemetry (user_id, lesson_id, watched_seconds)
    VALUES ('learner-media', ?, 36)`).run(lessonId);
  const originalWatchProgress = database.prepare(`SELECT watched_until_seconds, duration_seconds, last_position_seconds
    FROM lesson_watch_progress WHERE user_id = 'learner-media' AND lesson_id = ?`).get(lessonId);
  const originalCourse = database.prepare('SELECT updated_at, updated_by FROM courses WHERE id = ?').get(courseId);
  const originalFiles = (await fs.readdir(path.dirname(captionPath))).sort();
  const initialAuditCount = database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.video_uploaded' AND entity_id = ?").get(courseId).count;
  database.exec(`CREATE TRIGGER reject_video_uploaded_audit BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'course.video_uploaded' BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END`);
  const makeForm = () => {
    const form = new FormData();
    form.set('kind', 'video');
    form.set('lessonId', lessonId);
    form.set('file', new File([mp4Contents], 'updated-video.mp4', { type: 'video/mp4' }));
    return form;
  };

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const failedResponse = await fetch(apiUrl(`/manage/courses/${courseId}/media`), {
      method: 'POST',
      headers: { 'x-test-user': 'admin-media', connection: 'close' },
      body: makeForm(),
    });
    assert.equal(failedResponse.status, 500);
    assert.equal((await failedResponse.json()).code, 'audit_unavailable');
    assert.equal(database.prepare('SELECT media_id FROM lessons WHERE id = ?').get(lessonId).media_id, 'media-old-video');
    assert.ok(database.prepare("SELECT id FROM media_files WHERE id = 'media-old-video'").get());
    assert.deepEqual(database.prepare(`SELECT watched_until_seconds, duration_seconds, last_position_seconds
      FROM lesson_watch_progress WHERE user_id = 'learner-media' AND lesson_id = ?`).get(lessonId), originalWatchProgress);
    assert.deepEqual(await fs.readFile(previousFilePath), mp4Contents);
    assert.deepEqual((await fs.readdir(path.dirname(captionPath))).sort(), originalFiles);
    assert.deepEqual(database.prepare('SELECT updated_at, updated_by FROM courses WHERE id = ?').get(courseId), originalCourse);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.video_uploaded' AND entity_id = ?").get(courseId).count, initialAuditCount);
  } finally {
    database.exec('DROP TRIGGER IF EXISTS reject_video_uploaded_audit');
    console.error = originalConsoleError;
  }

  const retryResponse = await fetch(apiUrl(`/manage/courses/${courseId}/media`), {
    method: 'POST',
    headers: { 'x-test-user': 'admin-media', connection: 'close' },
    body: makeForm(),
  });
  assert.equal(retryResponse.status, 201);
  const { media } = await retryResponse.json();
  assert.equal(media.kind, 'video');
  assert.equal(media.name, 'updated-video.mp4');
  assert.equal(database.prepare('SELECT media_id FROM lessons WHERE id = ?').get(lessonId).media_id, media.id);
  assert.equal(database.prepare("SELECT id FROM media_files WHERE id = 'media-old-video'").get(), undefined);
  assert.equal(database.prepare('SELECT 1 FROM lesson_watch_progress WHERE lesson_id = ?').get(lessonId), undefined);
  assert.equal(database.prepare('SELECT 1 FROM lesson_watch_telemetry WHERE lesson_id = ?').get(lessonId), undefined);
  const replacementAudit = database.prepare(`SELECT details_json FROM audit_logs
    WHERE action = 'course.video_uploaded' AND entity_id = ? ORDER BY occurred_at DESC, id DESC LIMIT 1`).get(courseId);
  assert.equal(JSON.parse(replacementAudit.details_json).resetWatchProgressCount, 1);
  const savedMedia = database.prepare('SELECT file_name FROM media_files WHERE id = ?').get(media.id);
  assert.deepEqual(await fs.readFile(path.join(path.dirname(captionPath), savedMedia.file_name)), mp4Contents);
  await assert.rejects(fs.stat(previousFilePath), { code: 'ENOENT' });
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.video_uploaded' AND entity_id = ?").get(courseId).count, initialAuditCount + 1);
});

test('caption replacement preserves the old track and file when its audit event cannot be saved', async () => {
  const fileContents = 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nUpdated caption\n';
  const courseMediaDirectory = path.dirname(captionPath);
  const previousFileName = 'spanish-original.vtt';
  const previousFilePath = path.join(courseMediaDirectory, previousFileName);
  await fs.writeFile(previousFilePath, 'WEBVTT\n\nPrevious caption');
  database.prepare(`INSERT INTO lesson_captions (id, lesson_id, language, label, file_name, original_name, byte_size)
    VALUES ('caption-replacement', 'lesson-caption-audit', 'es', 'Spanish', ?, 'spanish.vtt', ?)`)
    .run(previousFileName, Buffer.byteLength('WEBVTT\n\nPrevious caption'));
  const originalCaption = database.prepare("SELECT * FROM lesson_captions WHERE id = 'caption-replacement'").get();
  const originalCourse = database.prepare("SELECT updated_at, updated_by FROM courses WHERE id = 'course-caption-audit'").get();
  const initialAuditCount = database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.caption_uploaded' AND entity_id = 'lesson-caption-audit'").get().count;
  const originalFiles = (await fs.readdir(courseMediaDirectory)).sort();
  database.exec(`CREATE TRIGGER reject_caption_uploaded_audit BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'course.caption_uploaded' BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END`);

  const makeForm = () => {
    const form = new FormData();
    form.set('lessonId', 'lesson-caption-audit');
    form.set('language', 'es');
    form.set('label', 'Updated Spanish');
    form.set('file', new File([fileContents], 'updated.vtt', { type: 'text/vtt' }));
    return form;
  };
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const failedResponse = await fetch(apiUrl('/manage/courses/course-caption-audit/lesson-captions'), {
      method: 'POST',
      headers: { 'x-test-user': 'admin-media', connection: 'close' },
      body: makeForm(),
    });
    assert.equal(failedResponse.status, 500);
    assert.equal((await failedResponse.json()).code, 'audit_unavailable');
    assert.deepEqual(database.prepare("SELECT * FROM lesson_captions WHERE id = 'caption-replacement'").get(), originalCaption);
    assert.equal(await fs.readFile(previousFilePath, 'utf8'), 'WEBVTT\n\nPrevious caption');
    assert.deepEqual((await fs.readdir(courseMediaDirectory)).sort(), originalFiles);
    assert.deepEqual(database.prepare("SELECT updated_at, updated_by FROM courses WHERE id = 'course-caption-audit'").get(), originalCourse);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.caption_uploaded' AND entity_id = 'lesson-caption-audit'").get().count, initialAuditCount);
  } finally {
    database.exec('DROP TRIGGER IF EXISTS reject_caption_uploaded_audit');
    console.error = originalConsoleError;
  }

  const retryResponse = await fetch(apiUrl('/manage/courses/course-caption-audit/lesson-captions'), {
    method: 'POST',
    headers: { 'x-test-user': 'admin-media', connection: 'close' },
    body: makeForm(),
  });
  assert.equal(retryResponse.status, 201);
  const { caption } = await retryResponse.json();
  assert.equal(caption.id, 'caption-replacement');
  assert.equal(caption.label, 'Updated Spanish');
  assert.equal(caption.fileName, 'updated.vtt');
  const savedCaption = database.prepare("SELECT * FROM lesson_captions WHERE id = 'caption-replacement'").get();
  assert.equal(savedCaption.label, 'Updated Spanish');
  assert.notEqual(savedCaption.file_name, previousFileName);
  assert.equal(await fs.readFile(path.join(courseMediaDirectory, savedCaption.file_name), 'utf8'), fileContents);
  await assert.rejects(fs.stat(previousFilePath), { code: 'ENOENT' });
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.caption_uploaded' AND entity_id = 'lesson-caption-audit'").get().count, initialAuditCount + 1);
});

test('document upload removes its new file and record when its audit event cannot be saved', async () => {
  const fileContents = 'Course handout';
  const courseMediaDirectory = path.dirname(captionPath);
  const originalFiles = (await fs.readdir(courseMediaDirectory)).sort();
  const originalCourse = database.prepare("SELECT updated_at, updated_by FROM courses WHERE id = 'course-caption-audit'").get();
  const initialAuditCount = database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.document_uploaded' AND entity_id = 'lesson-caption-audit'").get().count;
  database.exec(`CREATE TRIGGER reject_document_uploaded_audit BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'course.document_uploaded' BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END`);
  const makeForm = () => {
    const form = new FormData();
    form.set('lessonId', 'lesson-caption-audit');
    form.set('title', 'Course handout');
    form.set('file', new File([fileContents], 'handout.txt', { type: 'text/plain' }));
    return form;
  };

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const failedResponse = await fetch(apiUrl('/manage/courses/course-caption-audit/lesson-documents'), {
      method: 'POST',
      headers: { 'x-test-user': 'admin-media', connection: 'close' },
      body: makeForm(),
    });
    assert.equal(failedResponse.status, 500);
    assert.equal((await failedResponse.json()).code, 'audit_unavailable');
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM lesson_resources WHERE lesson_id = 'lesson-caption-audit' AND resource_type = 'document'").get().count, 0);
    assert.deepEqual((await fs.readdir(courseMediaDirectory)).sort(), originalFiles);
    assert.deepEqual(database.prepare("SELECT updated_at, updated_by FROM courses WHERE id = 'course-caption-audit'").get(), originalCourse);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.document_uploaded' AND entity_id = 'lesson-caption-audit'").get().count, initialAuditCount);
  } finally {
    database.exec('DROP TRIGGER IF EXISTS reject_document_uploaded_audit');
    console.error = originalConsoleError;
  }

  const retryResponse = await fetch(apiUrl('/manage/courses/course-caption-audit/lesson-documents'), {
    method: 'POST',
    headers: { 'x-test-user': 'admin-media', connection: 'close' },
    body: makeForm(),
  });
  assert.equal(retryResponse.status, 201);
  const { resource } = await retryResponse.json();
  assert.equal(resource.kind, 'document');
  assert.equal(resource.title, 'Course handout');
  assert.equal(resource.fileName, 'handout.txt');
  const savedResource = database.prepare("SELECT * FROM lesson_resources WHERE lesson_id = 'lesson-caption-audit' AND resource_type = 'document'").get();
  assert.ok(savedResource);
  assert.equal(await fs.readFile(path.join(courseMediaDirectory, savedResource.file_name), 'utf8'), fileContents);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.document_uploaded' AND entity_id = 'lesson-caption-audit'").get().count, initialAuditCount + 1);
});

test('caption removal preserves its record and file when its audit event cannot be saved', async () => {
  const originalCourse = database.prepare("SELECT updated_at, updated_by FROM courses WHERE id = 'course-caption-audit'").get();
  const initialAuditCount = database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.caption_removed' AND entity_id = 'lesson-caption-audit'").get().count;
  database.exec(`CREATE TRIGGER reject_caption_removed_audit BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'course.caption_removed' BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END`);

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const failedResponse = await fetch(apiUrl('/manage/lessons/lesson-caption-audit/captions/caption-audit'), {
      method: 'DELETE',
      headers: { 'x-test-user': 'admin-media', connection: 'close' },
    });
    assert.equal(failedResponse.status, 500);
    assert.equal((await failedResponse.json()).code, 'audit_unavailable');
    assert.ok(database.prepare("SELECT id FROM lesson_captions WHERE id = 'caption-audit'").get());
    assert.equal(await fs.readFile(captionPath, 'utf8'), 'WEBVTT\n\nfixture text');
    assert.deepEqual(database.prepare("SELECT updated_at, updated_by FROM courses WHERE id = 'course-caption-audit'").get(), originalCourse);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.caption_removed' AND entity_id = 'lesson-caption-audit'").get().count, initialAuditCount);
  } finally {
    database.exec('DROP TRIGGER IF EXISTS reject_caption_removed_audit');
    console.error = originalConsoleError;
  }

  const retryResponse = await fetch(apiUrl('/manage/lessons/lesson-caption-audit/captions/caption-audit'), {
    method: 'DELETE',
    headers: { 'x-test-user': 'admin-media', connection: 'close' },
  });
  assert.equal(retryResponse.status, 204);
  assert.equal(database.prepare("SELECT id FROM lesson_captions WHERE id = 'caption-audit'").get(), undefined);
  await assert.rejects(fs.stat(captionPath), { code: 'ENOENT' });
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.caption_removed' AND entity_id = 'lesson-caption-audit'").get().count, initialAuditCount + 1);
});

test('accepts a WebP cover when the kind field follows the file part', async () => {
  const webpContents = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==', 'base64');
  const form = new FormData();
  form.set('file', new File([webpContents], 'valid-cover.webp', { type: 'image/webp' }));
  form.set('kind', 'cover');

  const response = await fetch(apiUrl('/manage/courses/course-caption-audit/media'), {
    method: 'POST',
    headers: { 'x-test-user': 'admin-media', connection: 'close' },
    body: form,
  });

  assert.equal(response.status, 201);
  const { media } = await response.json();
  assert.equal(media.kind, 'cover');
  assert.equal(media.name, 'valid-cover.webp');
  assert.equal(media.bytes, webpContents.length);
  assert.equal(database.prepare("SELECT cover_media_id FROM courses WHERE id = 'course-caption-audit'").get().cover_media_id, media.id);
  const storedMedia = database.prepare('SELECT file_name FROM media_files WHERE id = ?').get(media.id);
  assert.ok(storedMedia);
  assert.deepEqual(await fs.readFile(path.join(path.dirname(captionPath), storedMedia.file_name)), webpContents);
});
