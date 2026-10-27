export type VideoPlaybackEvent = 'timeupdate' | 'pause' | 'ended' | 'seeking' | 'visibility-hidden'
  | 'media-error' | 'recovery-attempt' | 'recovery-exhausted' | 'recovery-failed' | 'reload-timeout' | 'play-request-rejected';

function snapshotRanges(ranges: TimeRanges) {
  const result = [];
  try {
    for (let index = Math.max(0, ranges.length - 4); index < ranges.length; index += 1) {
      result.push({ startSeconds: ranges.start(index), endSeconds: ranges.end(index) });
    }
  } catch {
    // Media ranges can change while being read. Diagnostics must not stop playback.
  }
  return result;
}

// Capture at event time: a queued request may run after load() resets the media.
// URLs, browser error messages, and other free text are deliberately excluded.
export function captureVideoPlaybackDiagnostics(video: HTMLVideoElement, event: VideoPlaybackEvent, recoveryAttempt: number) {
  return {
    event,
    positionSeconds: Number.isFinite(video.currentTime) ? video.currentTime : null,
    durationSeconds: Number.isFinite(video.duration) ? video.duration : null,
    paused: video.paused,
    ended: video.ended,
    seeking: video.seeking,
    readyState: video.readyState,
    networkState: video.networkState,
    mediaErrorCode: video.error?.code ?? 0,
    playbackRate: video.playbackRate,
    buffered: snapshotRanges(video.buffered),
    seekable: snapshotRanges(video.seekable),
    visibility: document.visibilityState,
    recoveryAttempt,
  };
}
