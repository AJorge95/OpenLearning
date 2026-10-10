import { db } from './db.js';
import { fail } from './http.js';

const maximumDurationSeconds = 24 * 60 * 60;
const completionToleranceSeconds = 0.5;
const maximumHeartbeatCreditSeconds = 8;

function readLessonCompletion(userId, lessonId) {
  return Boolean(db.prepare('SELECT 1 FROM lesson_progress WHERE user_id = ? AND lesson_id = ?')
    .get(userId, lessonId));
}

function watchRecord(userId, lessonId) {
  return db.prepare(`SELECT watched_until_seconds, duration_seconds, last_position_seconds, last_heartbeat_at
    FROM lesson_watch_progress WHERE user_id = ? AND lesson_id = ?`).get(userId, lessonId);
}

function responseFor(user, lessonId, row = watchRecord(user.id, lessonId), knownDuration = 0) {
  const completed = readLessonCompletion(user.id, lessonId);
  return {
    required: user.role === 'learner',
    watchedUntilSeconds: row?.watched_until_seconds ?? 0,
    durationSeconds: row?.duration_seconds || knownDuration,
    complete: completed || Boolean(row && row.duration_seconds > 0
      && row.watched_until_seconds >= row.duration_seconds - completionToleranceSeconds),
  };
}

export function getLessonWatchProgress(user, lessonId, durationSeconds) {
  return responseFor(user, lessonId, undefined, durationSeconds);
}

export function beginLessonWatch(user, lessonId, durationSeconds) {
  if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds)
    || durationSeconds <= 0 || durationSeconds > maximumDurationSeconds) {
    fail(422, 'This video duration could not be verified. Contact your course administrator.', 'video_duration_unavailable');
  }
  const existing = watchRecord(user.id, lessonId);
  if (existing?.duration_seconds > 0 && Math.abs(durationSeconds - existing.duration_seconds) > Math.max(2, existing.duration_seconds * 0.03)) {
    fail(409, 'The video duration changed. Reload the lesson before continuing.', 'watch_duration_changed');
  }
  const now = Date.now();
  db.prepare(`INSERT INTO lesson_watch_progress
    (user_id, lesson_id, watched_until_seconds, duration_seconds, last_position_seconds, last_heartbeat_at)
    VALUES (?, ?, 0, ?, 0, ?)
    ON CONFLICT(user_id, lesson_id) DO UPDATE SET
      last_position_seconds = lesson_watch_progress.watched_until_seconds,
      duration_seconds = excluded.duration_seconds,
      last_heartbeat_at = excluded.last_heartbeat_at,
      updated_at = CURRENT_TIMESTAMP`).run(user.id, lessonId, durationSeconds, now);
  return responseFor(user, lessonId, undefined, durationSeconds);
}

export function recordLessonWatchProgress(user, lessonId, position) {
  const row = watchRecord(user.id, lessonId);
  if (!row || !row.last_heartbeat_at) fail(409, 'Start the video before saving playback progress.', 'watch_not_started');
  if (typeof position !== 'number' || !Number.isFinite(position)
    || row.duration_seconds <= 0 || row.duration_seconds > maximumDurationSeconds
    || position < 0 || position > row.duration_seconds) {
    fail(400, 'Video playback progress is invalid.', 'invalid_watch_progress');
  }

  const now = Date.now();
  // A stale heartbeat must not let time spent paused or away from the lesson
  // count as watched. Normal player reports arrive every four seconds.
  const elapsed = Math.max(0, Math.min(maximumHeartbeatCreditSeconds, (now - row.last_heartbeat_at) / 1000));
  const maximumPosition = row.last_position_seconds + elapsed;
  if (position > maximumPosition) {
    return { ...responseFor(user, lessonId, row), accepted: false };
  }

  const watchedUntil = Math.max(row.watched_until_seconds, Math.min(position, maximumPosition, row.duration_seconds));
  const update = db.prepare(`UPDATE lesson_watch_progress SET watched_until_seconds = ?, duration_seconds = ?,
    last_position_seconds = ?, last_heartbeat_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ? AND lesson_id = ?`);
  update.run(watchedUntil, row.duration_seconds, position, now, user.id, lessonId);
  const updated = watchRecord(user.id, lessonId);
  return { ...responseFor(user, lessonId, updated), accepted: true };
}

export function lessonVideoWasWatched(userId, lessonId) {
  if (readLessonCompletion(userId, lessonId)) return true;
  const row = watchRecord(userId, lessonId);
  return Boolean(row && row.duration_seconds > 0
    && row.watched_until_seconds >= row.duration_seconds - completionToleranceSeconds);
}
