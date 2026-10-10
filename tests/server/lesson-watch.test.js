import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, test } from 'node:test';

const isolatedConfig = {
  NODE_ENV: 'test', DATA_DIR: '', DB_PATH: '', MEDIA_ROOT: '',
  SESSION_SECRET: 'isolated-lesson-watch-tests', TRUST_PROXY: 'false', PORT: '3000',
  MAX_UPLOAD_BYTES: '2147483648', REQUEST_TIMEOUT_MS: '300000',
};
const previousConfig = new Map(Object.keys(isolatedConfig).map((key) => [key, process.env[key]]));
let fixtureDirectory;
let database;
let ApiError;
let lessonWatch;

function createFixtureDirectory() {
  const tempBase = path.resolve(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(tempBase, 'openlearning-lesson-watch-'));
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== tempBase || !path.basename(resolved).startsWith('openlearning-lesson-watch-')) {
    throw new Error('Refusing to use an unexpected temporary directory.');
  }
  return resolved;
}

function removeFixtureDirectory(directory) {
  if (!directory) return;
  const tempBase = path.resolve(os.tmpdir());
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== tempBase || !path.basename(resolved).startsWith('openlearning-lesson-watch-')) {
    throw new Error('Refusing to remove an unexpected temporary directory.');
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

function assertApiError(action, status, code) {
  assert.throws(action, (error) => error instanceof ApiError && error.status === status && error.code === code);
}

function withFakeClock(startTime, callback) {
  const originalNow = Date.now;
  let currentTime = startTime;
  Date.now = () => currentTime;
  try {
    return callback((milliseconds) => { currentTime += milliseconds; });
  } finally {
    Date.now = originalNow;
  }
}

before(async () => {
  fixtureDirectory = createFixtureDirectory();
  Object.assign(process.env, {
    ...isolatedConfig,
    DATA_DIR: fixtureDirectory,
    DB_PATH: path.join(fixtureDirectory, 'openlearning.sqlite'),
    MEDIA_ROOT: path.join(fixtureDirectory, 'course-media'),
  });

  ({ db: database } = await import('../../server/db.js'));
  ({ ApiError } = await import('../../server/http.js'));
  lessonWatch = await import('../../server/lesson-watch.js');
  database.exec(`
    INSERT INTO users (id, username, password_hash, role)
      VALUES ('watch-learner', 'watch_learner', 'not-used', 'learner');
    INSERT INTO courses (id, title, status, created_by, updated_by)
      VALUES ('watch-course', 'Watch Progress Course', 'published', 'watch-learner', 'watch-learner');
    INSERT INTO course_modules (id, course_id, title, position)
      VALUES ('watch-module', 'watch-course', 'Video module', 0);
    INSERT INTO lessons (id, module_id, title, position)
      VALUES ('watch-lesson', 'watch-module', 'Video lesson', 0);
  `);
});

beforeEach(() => {
  database.exec('DELETE FROM lesson_watch_progress; DELETE FROM lesson_progress;');
});

after(() => {
  if (database?.open) database.close();
  removeFixtureDirectory(fixtureDirectory);
  for (const [key, value] of previousConfig) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('watch progress starts empty and validates the verified video duration', () => {
  const learner = { id: 'watch-learner', role: 'learner' };
  assert.deepEqual(lessonWatch.getLessonWatchProgress(learner, 'watch-lesson', 120), {
    required: true, watchedUntilSeconds: 0, durationSeconds: 120, complete: false,
  });
  assert.equal(lessonWatch.getLessonWatchProgress({ id: 'preview-admin', role: 'admin' }, 'watch-lesson', 120).required, true);

  for (const duration of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 24 * 60 * 60 + 1]) {
    assertApiError(() => lessonWatch.beginLessonWatch(learner, 'watch-lesson', duration), 422, 'video_duration_unavailable');
  }

  assert.deepEqual(lessonWatch.beginLessonWatch(learner, 'watch-lesson', 120), {
    required: true, watchedUntilSeconds: 0, durationSeconds: 120, complete: false,
  });
});

test('watch progress requires a started video and rejects invalid positions', () => {
  const learner = { id: 'watch-learner', role: 'learner' };
  assertApiError(() => lessonWatch.recordLessonWatchProgress(learner, 'watch-lesson', 1), 409, 'watch_not_started');

  lessonWatch.beginLessonWatch(learner, 'watch-lesson', 60);
  for (const position of [-1, Number.NaN, Number.POSITIVE_INFINITY, 61]) {
    assertApiError(() => lessonWatch.recordLessonWatchProgress(learner, 'watch-lesson', position), 400, 'invalid_watch_progress');
  }
});

test('watch progress rejects fast forward jumps and retains the watched high-water mark', () => {
  const learner = { id: 'watch-learner', role: 'learner' };
  withFakeClock(1_000_000, (advance) => {
    lessonWatch.beginLessonWatch(learner, 'watch-lesson', 100);
    advance(4_000);
    const first = lessonWatch.recordLessonWatchProgress(learner, 'watch-lesson', 4);
    assert.equal(first.accepted, true);
    assert.equal(first.watchedUntilSeconds, 4);

    advance(1_000);
    const second = lessonWatch.recordLessonWatchProgress(learner, 'watch-lesson', 5);
    assert.equal(second.accepted, true);
    const acceptedHeartbeat = database.prepare(`SELECT last_heartbeat_at FROM lesson_watch_progress
      WHERE user_id = ? AND lesson_id = ?`).get(learner.id, 'watch-lesson').last_heartbeat_at;
    advance(30_000);
    const skipped = lessonWatch.recordLessonWatchProgress(learner, 'watch-lesson', 35);
    assert.equal(skipped.accepted, false);
    assert.equal(skipped.watchedUntilSeconds, 5);
    assert.equal(database.prepare(`SELECT last_heartbeat_at FROM lesson_watch_progress
      WHERE user_id = ? AND lesson_id = ?`).get(learner.id, 'watch-lesson').last_heartbeat_at, acceptedHeartbeat);

    advance(1_000);
    const resumed = lessonWatch.recordLessonWatchProgress(learner, 'watch-lesson', 6);
    assert.equal(resumed.accepted, true);
    assert.equal(resumed.watchedUntilSeconds, 6);

    advance(1_000);
    const movedBack = lessonWatch.recordLessonWatchProgress(learner, 'watch-lesson', 4);
    assert.equal(movedBack.accepted, false);
    assert.equal(movedBack.watchedUntilSeconds, 6);
    assert.equal(lessonWatch.lessonVideoWasWatched(learner.id, 'watch-lesson'), false);
  });
});

test('watch telemetry counts credible playback and rate-limits rejected seek alerts', () => {
  const learner = { id: 'watch-learner', role: 'learner' };
  withFakeClock(3_000_000, (advance) => {
    lessonWatch.beginLessonWatch(learner, 'watch-lesson', 100);
    advance(4_000);
    assert.equal(lessonWatch.recordLessonWatchProgress(learner, 'watch-lesson', 4).accepted, true);

    advance(1_000);
    const firstRejectedSeek = lessonWatch.recordLessonWatchProgress(learner, 'watch-lesson', 2);
    assert.equal(firstRejectedSeek.accepted, false);
    assert.equal(firstRejectedSeek.anomaly, 'backward_seek');
    assert.equal(firstRejectedSeek.shouldLogAnomaly, true);
    assert.equal(firstRejectedSeek.rejectedAttemptCount, 1);

    advance(1_000);
    const throttledRejectedSeek = lessonWatch.recordLessonWatchProgress(learner, 'watch-lesson', 2);
    assert.equal(throttledRejectedSeek.shouldLogAnomaly, false);
    assert.equal(throttledRejectedSeek.rejectedAttemptCount, 2);

    const telemetry = database.prepare(`SELECT watched_seconds, rejected_seek_count, last_rejected_position_seconds
      FROM lesson_watch_telemetry WHERE user_id = ? AND lesson_id = ?`).get(learner.id, 'watch-lesson');
    assert.deepEqual(telemetry, { watched_seconds: 4, rejected_seek_count: 2, last_rejected_position_seconds: 2 });

    advance(60_000);
    const alertAfterCooldown = lessonWatch.recordLessonWatchProgress(learner, 'watch-lesson', 2);
    assert.equal(alertAfterCooldown.shouldLogAnomaly, true);
    assert.equal(alertAfterCooldown.rejectedAttemptCount, 3);
  });
});

test('small media-clock leads are accepted without accumulating extra watched time', () => {
  const learner = { id: 'watch-learner', role: 'learner' };
  withFakeClock(1_500_000, (advance) => {
    lessonWatch.beginLessonWatch(learner, 'watch-lesson', 100);

    advance(4_000);
    const first = lessonWatch.recordLessonWatchProgress(learner, 'watch-lesson', 4.25);
    assert.equal(first.accepted, true);
    assert.equal(first.watchedUntilSeconds, 4);
    assert.equal(database.prepare(`SELECT last_position_seconds FROM lesson_watch_progress
      WHERE user_id = ? AND lesson_id = ?`).get(learner.id, 'watch-lesson').last_position_seconds, 4);

    advance(4_000);
    const second = lessonWatch.recordLessonWatchProgress(learner, 'watch-lesson', 8.5);
    assert.equal(second.accepted, true);
    assert.equal(second.watchedUntilSeconds, 8);
    const acceptedHeartbeat = database.prepare(`SELECT last_heartbeat_at FROM lesson_watch_progress
      WHERE user_id = ? AND lesson_id = ?`).get(learner.id, 'watch-lesson').last_heartbeat_at;

    advance(4_000);
    const tooFarAhead = lessonWatch.recordLessonWatchProgress(learner, 'watch-lesson', 12.51);
    assert.equal(tooFarAhead.accepted, false);
    assert.equal(tooFarAhead.watchedUntilSeconds, 8);
    assert.equal(database.prepare(`SELECT last_heartbeat_at FROM lesson_watch_progress
      WHERE user_id = ? AND lesson_id = ?`).get(learner.id, 'watch-lesson').last_heartbeat_at, acceptedHeartbeat);

    const toleratedRetry = lessonWatch.recordLessonWatchProgress(learner, 'watch-lesson', 12.5);
    assert.equal(toleratedRetry.accepted, true);
    assert.equal(toleratedRetry.watchedUntilSeconds, 12);
  });
});

test('near-complete playback unlocks lesson completion and saved completion remains recognized', () => {
  const learner = { id: 'watch-learner', role: 'learner' };
  withFakeClock(2_000_000, (advance) => {
    lessonWatch.beginLessonWatch(learner, 'watch-lesson', 10);
    advance(4_000);
    assert.equal(lessonWatch.recordLessonWatchProgress(learner, 'watch-lesson', 4).accepted, true);
    advance(4_000);
    assert.equal(lessonWatch.recordLessonWatchProgress(learner, 'watch-lesson', 8).accepted, true);
    advance(1_500);
    const completedWatch = lessonWatch.recordLessonWatchProgress(learner, 'watch-lesson', 9.5);

    assert.equal(completedWatch.accepted, true);
    assert.equal(completedWatch.watchedUntilSeconds, 9.5);
    assert.equal(completedWatch.complete, true);
    assert.equal(lessonWatch.lessonVideoWasWatched(learner.id, 'watch-lesson'), true);
    assert.equal(lessonWatch.getLessonWatchProgress(learner, 'watch-lesson', 10).complete, true);
  });

  database.prepare('INSERT INTO lesson_progress (user_id, lesson_id) VALUES (?, ?)').run(learner.id, 'watch-lesson');
  assert.equal(lessonWatch.lessonVideoWasWatched(learner.id, 'watch-lesson'), true);
});

test('a changed video duration asks the learner to reload before continuing', () => {
  const learner = { id: 'watch-learner', role: 'learner' };
  lessonWatch.beginLessonWatch(learner, 'watch-lesson', 100);

  assertApiError(() => lessonWatch.beginLessonWatch(learner, 'watch-lesson', 104), 409, 'watch_duration_changed');
  assert.equal(lessonWatch.beginLessonWatch(learner, 'watch-lesson', 102).durationSeconds, 102);
});
