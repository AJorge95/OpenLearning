export type VideoRecoveryProgress = {
  lessonId: string;
  ready: boolean;
  started: boolean;
  complete: boolean;
  watchedUntilSeconds: number;
  lastPositionSeconds: number;
};

export type PendingVideoResume = {
  lessonId: string;
  position: number;
  resumePlayback: boolean;
};

export function videoRecoveryMadeProgress({
  lessonId,
  recoveryLessonId,
  positionSeconds,
  resumePositionSeconds,
}: {
  lessonId: string;
  recoveryLessonId: string | null;
  positionSeconds: number;
  resumePositionSeconds: number;
}) {
  return recoveryLessonId === lessonId && positionSeconds > resumePositionSeconds + 2;
}

export function shouldResumeVideoPlayback({
  requested,
  lessonId,
  watchRequired,
  watchProgress,
  startedLessonId,
  verifiedResume = false,
}: {
  requested: boolean;
  lessonId: string;
  watchRequired: boolean;
  watchProgress: VideoRecoveryProgress;
  startedLessonId: string | null;
  verifiedResume?: boolean;
}) {
  return requested && (verifiedResume || !watchRequired
    || (watchProgress.lessonId === lessonId && watchProgress.ready && watchProgress.started && startedLessonId === lessonId));
}

export function getVideoResumeTarget({
  lessonId,
  watchRequired,
  watchProgress,
  pendingResume,
}: {
  lessonId: string;
  watchRequired: boolean;
  watchProgress: VideoRecoveryProgress;
  pendingResume: PendingVideoResume | null;
}) {
  if (pendingResume?.lessonId === lessonId) {
    return { kind: 'retry' as const, position: pendingResume.position, resumePlayback: pendingResume.resumePlayback };
  }
  if (!watchRequired || !watchProgress.ready || watchProgress.lessonId !== lessonId) return null;
  return {
    kind: 'watch-progress' as const,
    position: watchProgress.started
      ? watchProgress.lastPositionSeconds
      : watchProgress.complete ? 0 : watchProgress.watchedUntilSeconds,
  };
}

export function getVideoRecoveryStatusMessage(status: 'buffering' | 'reconnecting', watchRequired: boolean) {
  if (status === 'buffering') {
    return watchRequired ? 'Video is buffering. Your verified watch position is saved.' : 'Video is buffering.';
  }
  return watchRequired
    ? 'Playback stalled. Reconnecting from the last server-verified position…'
    : 'Playback stalled. Reconnecting from your current position…';
}
