const playbackEvents = new Set(['timeupdate', 'pause', 'ended', 'seeking', 'visibility-hidden',
  'media-error', 'recovery-attempt', 'recovery-exhausted', 'recovery-failed', 'reload-timeout', 'play-request-rejected']);
export const playbackDiagnosticMessages = new Map([
  ['media-error', 'Browser reported a video playback error'],
  ['recovery-attempt', 'Automatic video recovery started'],
  ['recovery-exhausted', 'Automatic video recovery stopped after three attempts'],
  ['recovery-failed', 'Automatic video recovery could not restore playback'],
  ['reload-timeout', 'Video reload timed out before playback restarted'],
  ['play-request-rejected', 'Browser rejected the video play request'],
]);
const readyStates = ['nothing', 'metadata', 'current_data', 'future_data', 'enough_data'];
const networkStates = ['empty', 'idle', 'loading', 'no_source'];
const mediaErrors = ['none', 'aborted', 'network', 'decode', 'unsupported_source'];

function finiteNumber(value, maximum = 86_400) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum
    ? Math.round(value * 1000) / 1000 : undefined;
}

function ranges(value) {
  if (!Array.isArray(value)) return undefined;
  return value.slice(-4).flatMap((range) => {
    const startSeconds = finiteNumber(range?.startSeconds);
    const endSeconds = finiteNumber(range?.endSeconds);
    return startSeconds !== undefined && endSeconds !== undefined && startSeconds <= endSeconds
      ? [{ startSeconds, endSeconds }] : [];
  });
}

export function normalizeVideoPlaybackDiagnostics(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result = { clientReported: true };
  if (playbackEvents.has(value.event)) result.event = value.event;
  for (const key of ['paused', 'ended', 'seeking']) if (typeof value[key] === 'boolean') result[key] = value[key];
  for (const key of ['positionSeconds', 'durationSeconds', 'playbackRate']) {
    const number = finiteNumber(value[key], key === 'playbackRate' ? 16 : 86_400);
    if (number !== undefined) result[key] = number;
  }
  for (const [key, names] of [['readyState', readyStates], ['networkState', networkStates], ['mediaErrorCode', mediaErrors]]) {
    if (Number.isInteger(value[key]) && names[value[key]]) result[key] = names[value[key]];
  }
  for (const key of ['buffered', 'seekable']) {
    const snapshot = ranges(value[key]);
    if (snapshot !== undefined) result[key] = snapshot;
  }
  if (['visible', 'hidden'].includes(value.visibility)) result.visibility = value.visibility;
  if (Number.isInteger(value.recoveryAttempt) && value.recoveryAttempt >= 0 && value.recoveryAttempt <= 3) {
    result.recoveryAttempt = value.recoveryAttempt;
  }
  return result;
}

export function rejectedVideoProgressLog(progress, playback) {
  const clientPlayback = normalizeVideoPlaybackDiagnostics(playback);
  const atEnd = progress.reportedPositionSeconds >= progress.durationSeconds - 0.5
    && progress.lastAcceptedPositionSeconds < progress.durationSeconds - 0.5;
  const classification = atEnd ? 'unverified_end_position'
    : progress.anomaly === 'backward_seek' ? 'position_behind_checkpoint' : 'position_ahead_of_server_time';
  return {
    message: atEnd ? 'Video end position rejected before verified completion' : 'Video position rejected against the saved watch checkpoint',
    details: {
      classification,
      // A clock jump proves a validation failure, not intentional learner seeking.
      causeConfirmed: false,
      durationValidation: 'container_metadata_only',
      reportedPositionSeconds: progress.reportedPositionSeconds,
      lastAcceptedPositionSeconds: progress.lastAcceptedPositionSeconds,
      maximumCrediblePositionSeconds: progress.maximumCrediblePositionSeconds,
      positionGapSeconds: progress.reportedPositionSeconds - progress.lastAcceptedPositionSeconds,
      heartbeatAgeSeconds: progress.heartbeatAgeSeconds,
      creditedElapsedSeconds: progress.creditedElapsedSeconds,
      rejectedAttemptCount: progress.rejectedAttemptCount,
      watchedSeconds: progress.watchedSeconds,
      durationSeconds: progress.durationSeconds,
      clientPlayback,
    },
  };
}
