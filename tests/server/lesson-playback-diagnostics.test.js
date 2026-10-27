import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import express from 'express';
import { after, before, beforeEach, test } from 'node:test';
import { getVideoRewindTarget } from '../../src/video-recovery.ts';

let directory;
let db;
let server;
const priorEnvironment = new Map();
const checkpointSeconds = 2010.255372;
const durationSeconds = 4724.544;
const headers = { 'x-test-user': 'playback-learner', 'content-type': 'application/json', connection: 'close' };
const route = (suffix) => `http://127.0.0.1:${server.address().port}/api/lessons/playback-lesson/${suffix}`;

before(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openlearning-playback-diagnostics-'));
  const environment = { NODE_ENV: 'test', DATA_DIR: directory, DB_PATH: path.join(directory, 'test.sqlite'),
    MEDIA_ROOT: path.join(directory, 'media'), SESSION_SECRET: 'isolated-playback-diagnostic-tests',
    TRUST_PROXY: 'false', PORT: '3000', MAX_UPLOAD_BYTES: '2147483648', REQUEST_TIMEOUT_MS: '300000' };
  for (const [key, value] of Object.entries(environment)) {
    priorEnvironment.set(key, process.env[key]);
    process.env[key] = value;
  }
  ({ db } = await import('../../server/db.js'));
  const [{ courseRouter }, { errorHandler }] = await Promise.all([
    import('../../server/routes-courses.js'), import('../../server/http.js'),
  ]);
  db.exec(`
    INSERT INTO users (id, username, password_hash, role) VALUES
      ('playback-admin', 'playback_admin', 'unused', 'admin'), ('playback-learner', 'playback_learner', 'unused', 'learner');
    INSERT INTO courses (id, title, status, visibility, created_by, updated_by)
      VALUES ('playback-course', 'Playback assessment', 'published', 'public', 'playback-admin', 'playback-admin');
    INSERT INTO course_modules (id, course_id, title, position) VALUES ('playback-module', 'playback-course', 'Video', 0);
    INSERT INTO media_files (id, course_id, original_name, file_name, mime_type, byte_size, media_kind, duration_seconds)
      VALUES ('playback-media', 'playback-course', 'fixture.mp4', 'fixture.mp4', 'video/mp4', 100, 'video', 4724.544);
    INSERT INTO lessons (id, module_id, title, position, media_id)
      VALUES ('playback-lesson', 'playback-module', 'Playback fixture', 0, 'playback-media');
    INSERT INTO enrollments (id, course_id, user_id) VALUES ('playback-enrollment', 'playback-course', 'playback-learner');
  `);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.currentUser = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(req.get('x-test-user'));
    next();
  });
  app.use('/api', courseRouter);
  app.use(errorHandler);
  server = createServer(app).listen(0, '127.0.0.1');
  await once(server, 'listening');
});

beforeEach(async () => {
  db.exec('DELETE FROM lesson_watch_progress; DELETE FROM lesson_watch_telemetry; DELETE FROM system_logs;');
  const response = await fetch(route('watch-progress/start'), { method: 'POST', headers });
  assert.equal(response.status, 200);
  await response.json();
  db.prepare(`UPDATE lesson_watch_progress SET last_position_seconds = ?, watched_until_seconds = ?, last_heartbeat_at = ?
    WHERE user_id = 'playback-learner' AND lesson_id = 'playback-lesson'`).run(checkpointSeconds, checkpointSeconds, Date.now() - 1000);
  db.prepare(`UPDATE lesson_watch_telemetry SET watched_seconds = ? WHERE user_id = 'playback-learner'`).run(checkpointSeconds);
});

after(async () => {
  if (server?.listening) {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
  }
  if (db?.open) db.close();
  if (directory && path.dirname(path.resolve(directory)) === path.resolve(os.tmpdir())
    && path.basename(directory).startsWith('openlearning-playback-diagnostics-')) fs.rmSync(directory, { recursive: true, force: true });
  for (const [key, value] of priorEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('false video end preserves credit and records browser state with a neutral assessment', async () => {
  const response = await fetch(route('watch-progress'), { method: 'PUT', headers, body: JSON.stringify({
    positionSeconds: durationSeconds,
    playback: { event: 'ended', ended: true, paused: true, seeking: false, readyState: 2, networkState: 1,
      mediaErrorCode: 3, positionSeconds: durationSeconds, durationSeconds, recoveryAttempt: 2,
      buffered: [{ startSeconds: 0, endSeconds: 2011 }], seekable: [{ startSeconds: 0, endSeconds: durationSeconds }],
      src: 'private-source', errorMessage: 'private-message' },
  }) });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.accepted, false);
  assert.equal(result.lastPositionSeconds, checkpointSeconds);
  assert.equal(result.watchedUntilSeconds, checkpointSeconds);
  assert.equal(result.complete, false);
  assert.equal(result.heartbeatAgeSeconds, undefined);
  const entry = db.prepare(`SELECT message, details_json FROM system_logs WHERE source = 'lesson-watch' ORDER BY id DESC LIMIT 1`).get();
  const details = JSON.parse(entry.details_json);
  assert.equal(entry.message, 'Video end position rejected before verified completion');
  assert.equal(details.classification, 'unverified_end_position');
  assert.equal(details.causeConfirmed, false);
  assert.equal(details.mediaId, 'playback-media');
  assert.equal(typeof details.appVersion, 'string');
  assert.equal(details.clientPlayback.event, 'ended');
  assert.equal(details.clientPlayback.mediaErrorCode, 'decode');
  assert.ok(details.heartbeatAgeSeconds >= 1);
  assert.ok(details.creditedElapsedSeconds <= 8);
  assert.doesNotMatch(entry.details_json, /private-source|private-message/);
});

test('manual rewind recovers from the saved checkpoint when the browser is at a false end', async () => {
  const rejected = await fetch(route('watch-progress/rewind'), { method: 'POST', headers,
    body: JSON.stringify({ positionSeconds: durationSeconds - 30 }) });
  assert.equal(rejected.status, 422);
  assert.equal((await rejected.json()).code, 'invalid_video_rewind');
  const response = await fetch(route('watch-progress/rewind'), { method: 'POST', headers,
    body: JSON.stringify({ positionSeconds: getVideoRewindTarget(checkpointSeconds) }) });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.lastPositionSeconds, checkpointSeconds - 30);
  assert.equal(result.watchedUntilSeconds, checkpointSeconds);
  assert.equal(db.prepare('SELECT watched_seconds FROM lesson_watch_telemetry').get().watched_seconds, checkpointSeconds);
});

test('bounded playback diagnostics do not mutate watch progress and require authentication', async () => {
  const before = db.prepare('SELECT * FROM lesson_watch_progress').get();
  const telemetryBefore = db.prepare('SELECT * FROM lesson_watch_telemetry').get();
  const body = JSON.stringify({ playback: { event: 'media-error', mediaErrorCode: 2, readyState: 1, networkState: 2 } });
  const anonymous = await fetch(route('playback-diagnostics'), { method: 'POST', headers: { 'content-type': 'application/json', connection: 'close' }, body });
  assert.equal(anonymous.status, 401);
  await anonymous.json();
  for (let index = 0; index < 15; index += 1) {
    const response = await fetch(route('playback-diagnostics'), { method: 'POST', headers, body });
    assert.equal(response.status, 204);
  }
  assert.deepEqual(db.prepare('SELECT * FROM lesson_watch_progress').get(), before);
  assert.deepEqual(db.prepare('SELECT * FROM lesson_watch_telemetry').get(), telemetryBefore);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM system_logs WHERE message = 'Browser reported a video playback error'").get().count, 12);
});
