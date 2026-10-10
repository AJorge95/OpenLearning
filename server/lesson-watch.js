import { db } from './db.js';
import { fail } from './http.js';

const maximumDurationSeconds = 24 * 60 * 60;
const completionToleranceSeconds = 0.5;
const progressClockToleranceSeconds = 0.5;
const maximumHeartbeatCreditSeconds = 8;
const suspiciousWatchLogIntervalMs = 60_000;

const readLessonCompletionStatement = db.prepare('SELECT 1 FROM lesson_progress WHERE user_id = ? AND lesson_id = ?');
const readWatchRecordStatement = db.prepare(`SELECT progress.watched_until_seconds,
    COALESCE(telemetry.watched_seconds, progress.watched_until_seconds) AS watched_seconds,
    progress.duration_seconds, progress.last_position_seconds, progress.last_heartbeat_at,
    COALESCE(telemetry.rejected_seek_count, 0) AS rejected_seek_count,
    telemetry.last_rejected_position_seconds, COALESCE(telemetry.last_rejected_at, 0) AS last_rejected_at,
    COALESCE(telemetry.last_alerted_at, 0) AS last_alerted_at,
    EXISTS (SELECT 1 FROM lesson_progress completed
      WHERE completed.user_id = progress.user_id AND completed.lesson_id = progress.lesson_id) AS completed
  FROM lesson_watch_progress AS progress
  LEFT JOIN lesson_watch_telemetry AS telemetry ON telemetry.user_id = progress.user_id AND telemetry.lesson_id = progress.lesson_id
  WHERE progress.user_id = ? AND progress.lesson_id = ?`);
const beginWatchStatement = db.prepare(`INSERT INTO lesson_watch_progress
  (user_id, lesson_id, watched_until_seconds, duration_seconds, last_position_seconds, last_heartbeat_at)
  VALUES (?, ?, 0, ?, 0, ?)
  ON CONFLICT(user_id, lesson_id) DO UPDATE SET
    last_position_seconds = CASE WHEN EXISTS (SELECT 1 FROM lesson_progress
      WHERE user_id = lesson_watch_progress.user_id AND lesson_id = lesson_watch_progress.lesson_id)
      THEN 0 ELSE lesson_watch_progress.watched_until_seconds END,
    duration_seconds = excluded.duration_seconds,
    last_heartbeat_at = excluded.last_heartbeat_at,
    updated_at = CURRENT_TIMESTAMP`);
const upsertWatchedSecondsStatement = db.prepare(`INSERT INTO lesson_watch_telemetry (user_id, lesson_id, watched_seconds)
  VALUES (?, ?, ?)
  ON CONFLICT(user_id, lesson_id) DO UPDATE SET
    watched_seconds = MAX(lesson_watch_telemetry.watched_seconds, excluded.watched_seconds),
    updated_at = CURRENT_TIMESTAMP`);
const setWatchedSecondsStatement = db.prepare(`INSERT INTO lesson_watch_telemetry (user_id, lesson_id, watched_seconds)
  VALUES (?, ?, ?)
  ON CONFLICT(user_id, lesson_id) DO UPDATE SET
    watched_seconds = excluded.watched_seconds,
    updated_at = CURRENT_TIMESTAMP`);
const rejectWatchPositionStatement = db.prepare(`INSERT INTO lesson_watch_telemetry
  (user_id, lesson_id, rejected_seek_count, last_rejected_position_seconds, last_rejected_at)
  VALUES (?, ?, 1, ?, ?)
  ON CONFLICT(user_id, lesson_id) DO UPDATE SET
    rejected_seek_count = lesson_watch_telemetry.rejected_seek_count + 1,
    last_rejected_position_seconds = excluded.last_rejected_position_seconds,
    last_rejected_at = excluded.last_rejected_at,
    updated_at = CURRENT_TIMESTAMP`);
const markWatchAnomalyAlertedStatement = db.prepare(`UPDATE lesson_watch_telemetry SET last_alerted_at = ?, updated_at = CURRENT_TIMESTAMP
  WHERE user_id = ? AND lesson_id = ?`);
const updateWatchProgressStatement = db.prepare(`UPDATE lesson_watch_progress SET watched_until_seconds = ?, duration_seconds = ?,
  last_position_seconds = ?, last_heartbeat_at = ?, updated_at = CURRENT_TIMESTAMP
  WHERE user_id = ? AND lesson_id = ?`);
const rewindWatchProgressStatement = db.prepare(`UPDATE lesson_watch_progress SET last_position_seconds = ?,
  last_heartbeat_at = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND lesson_id = ?`);

function readLessonCompletion(userId, lessonId) {
  return Boolean(readLessonCompletionStatement.get(userId, lessonId));
}

function watchRecord(userId, lessonId) {
  return readWatchRecordStatement.get(userId, lessonId);
}

function responseFor(user, lessonId, row = watchRecord(user.id, lessonId), knownDuration = 0) {
  const completed = row ? Boolean(row.completed) : readLessonCompletion(user.id, lessonId);
  return {
    required: true,
    watchedUntilSeconds: row?.watched_until_seconds ?? 0,
    lastPositionSeconds: row?.last_position_seconds ?? 0,
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
  beginWatchStatement.run(user.id, lessonId, durationSeconds, now);
  upsertWatchedSecondsStatement.run(user.id, lessonId, existing?.watched_until_seconds ?? 0);
  return responseFor(user, lessonId, undefined, durationSeconds);
}

export function recordLessonWatchProgress(user, lessonId, position) {
  const row = watchRecord(user.id, lessonId);
  if (!row || !row.last_heartbeat_at) fail(409, 'Start the video before saving playback progress.', 'watch_not_started');
  if (typeof position !== 'number' || !Number.isFinite(position)
    || row.duration_seconds <= 0 || row.duration_seconds > maximumDurationSeconds
    || position < 0 || position > row.duration_seconds + progressClockToleranceSeconds) {
    fail(400, 'Video playback progress is invalid.', 'invalid_watch_progress');
  }

  const now = Date.now();
  // A stale heartbeat must not let time spent paused or away from the lesson
  // count as watched. Position credit is capped at real server elapsed time;
  // the allowance only absorbs delayed heartbeats from a busy/background tab.
  const elapsed = Math.max(0, Math.min(maximumHeartbeatCreditSeconds, (now - row.last_heartbeat_at) / 1000));
  const maximumPosition = row.last_position_seconds + elapsed;
  const movedBackward = position < row.last_position_seconds - progressClockToleranceSeconds;
  const movedTooFarForward = position > maximumPosition + progressClockToleranceSeconds;
  if (movedBackward || movedTooFarForward) {
    rejectWatchPositionStatement.run(user.id, lessonId, position, now);
    const rejectedSeekCount = row.rejected_seek_count + 1;
    const shouldLogAnomaly = now - row.last_alerted_at >= suspiciousWatchLogIntervalMs;
    if (shouldLogAnomaly) {
      markWatchAnomalyAlertedStatement.run(now, user.id, lessonId);
    }
    const attempts = {
      ...row,
      rejected_seek_count: rejectedSeekCount,
      last_rejected_position_seconds: position,
      last_rejected_at: now,
      last_alerted_at: shouldLogAnomaly ? now : row.last_alerted_at,
    };
    return {
      ...responseFor(user, lessonId, attempts),
      accepted: false,
      shouldLogAnomaly,
      anomaly: movedBackward ? 'backward_seek' : 'forward_seek',
      reportedPositionSeconds: position,
      lastAcceptedPositionSeconds: row.last_position_seconds,
      maximumCrediblePositionSeconds: maximumPosition,
      rejectedAttemptCount: attempts.rejected_seek_count,
      watchedSeconds: attempts.watched_seconds,
    };
  }

  // Small media clock and request timing differences should not pause otherwise
  // valid playback. Credit only the elapsed server time so this tolerance cannot
  // accumulate into extra watched progress across heartbeats.
  const acceptedPosition = Math.max(row.last_position_seconds, Math.min(position, maximumPosition, row.duration_seconds));
  const watchedUntil = Math.max(row.watched_until_seconds, acceptedPosition);
  // Replaying already watched content after an authorized rewind does not add
  // watch credit. Credit resumes only after reaching the previous high-water mark.
  const watchedSeconds = Math.min(row.duration_seconds, row.watched_seconds
    + Math.max(0, acceptedPosition - Math.max(row.last_position_seconds, row.watched_until_seconds)));
  updateWatchProgressStatement.run(watchedUntil, row.duration_seconds, acceptedPosition, now, user.id, lessonId);
  setWatchedSecondsStatement.run(user.id, lessonId, watchedSeconds);
  const updated = {
    ...row,
    watched_until_seconds: watchedUntil,
    watched_seconds: watchedSeconds,
    last_position_seconds: acceptedPosition,
    last_heartbeat_at: now,
  };
  return { ...responseFor(user, lessonId, updated), accepted: true };
}

export function rewindLessonWatch(user, lessonId, position) {
  const row = watchRecord(user.id, lessonId);
  if (!row || !row.last_heartbeat_at) fail(409, 'Start the video before rewinding.', 'watch_not_started');
  if (typeof position !== 'number' || !Number.isFinite(position)
    || row.duration_seconds <= 0 || position < 0 || position > row.duration_seconds) {
    fail(400, 'Video playback position is invalid.', 'invalid_watch_progress');
  }

  const distance = row.last_position_seconds - position;
  if (distance <= 0 || distance > 30 + progressClockToleranceSeconds) {
    fail(422, 'Rewind must move back by up to 30 seconds.', 'invalid_video_rewind');
  }

  const now = Date.now();
  rewindWatchProgressStatement.run(position, now, user.id, lessonId);
  const updated = { ...row, last_position_seconds: position, last_heartbeat_at: now };
  return { ...responseFor(user, lessonId, updated), accepted: true };
}

export function lessonVideoWasWatched(userId, lessonId) {
  const row = watchRecord(userId, lessonId);
  const completed = row ? Boolean(row.completed) : readLessonCompletion(userId, lessonId);
  return completed || Boolean(row && row.duration_seconds > 0
    && row.watched_until_seconds >= row.duration_seconds - completionToleranceSeconds);
}
