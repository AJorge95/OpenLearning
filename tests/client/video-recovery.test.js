import assert from 'node:assert/strict';
import test from 'node:test';
import { canRetryVideoWatchProgressLoad, getRejectedWatchProgressRecovery, getVideoRecoveryStatusMessage, getVideoResumeTarget, getVideoStallRecoveryPlan, getVideoWatchProgressDisplay, shouldResumeVideoPlayback, videoRecoveryMadeProgress } from '../../src/video-recovery.ts';

const emptyProgress = {
  lessonId: '',
  ready: false,
  started: false,
  complete: false,
  watchedUntilSeconds: 0,
  lastPositionSeconds: 0,
};

test('watch progress offers retry only for temporary video file read failures', () => {
  assert.equal(canRetryVideoWatchProgressLoad(503, 'video_duration_read_unavailable'), true);
  assert.equal(canRetryVideoWatchProgressLoad(422, 'video_duration_unavailable'), false);
  assert.equal(canRetryVideoWatchProgressLoad(500, 'internal_error'), false);
});

test('ordinary video retries resume from their captured position', () => {
  const pendingResume = { lessonId: 'lesson-1', position: 34, resumePlayback: true };

  assert.deepEqual(getVideoResumeTarget({
    lessonId: 'lesson-1',
    watchRequired: false,
    watchProgress: emptyProgress,
    pendingResume,
  }), { kind: 'retry', position: 34, resumePlayback: true });
  assert.equal(shouldResumeVideoPlayback({
    requested: true,
    lessonId: 'lesson-1',
    watchRequired: false,
    watchProgress: emptyProgress,
    startedLessonId: null,
  }), true);
});

test('watch-tracked retries resume only after the same lesson has started', () => {
  const watchProgress = { ...emptyProgress, lessonId: 'lesson-1', ready: true, started: true };
  const pendingResume = { lessonId: 'lesson-1', position: 18, resumePlayback: true };

  assert.deepEqual(getVideoResumeTarget({
    lessonId: 'lesson-1', watchRequired: true, watchProgress, pendingResume,
  }), { kind: 'retry', position: 18, resumePlayback: true });
  assert.equal(shouldResumeVideoPlayback({
    requested: true, lessonId: 'lesson-1', watchRequired: true, watchProgress, startedLessonId: 'lesson-1',
  }), true);
  assert.equal(shouldResumeVideoPlayback({
    requested: true, lessonId: 'lesson-1', watchRequired: true, watchProgress, startedLessonId: 'lesson-2',
  }), false);
  assert.equal(shouldResumeVideoPlayback({
    requested: true,
    lessonId: 'lesson-1',
    watchRequired: true,
    watchProgress: { ...watchProgress, ready: false },
    startedLessonId: 'lesson-1',
  }), false);
});

test('a server-verified visibility resume survives stale watch state but still needs a Play request', () => {
  const staleWatchState = {
    requested: true,
    lessonId: 'lesson-1',
    watchRequired: true,
    watchProgress: emptyProgress,
    startedLessonId: null,
  };

  assert.equal(shouldResumeVideoPlayback(staleWatchState), false);
  assert.equal(shouldResumeVideoPlayback({ ...staleWatchState, verifiedResume: true }), true);
  assert.equal(shouldResumeVideoPlayback({ ...staleWatchState, requested: false, verifiedResume: true }), false);
});

test('rejected ended-video progress reloads before resuming from the verified checkpoint', () => {
  assert.equal(getRejectedWatchProgressRecovery({ paused: true, ended: true }), 'reload-and-resume');
  assert.equal(getRejectedWatchProgressRecovery({ paused: false, ended: false }), 'seek-and-resume');
  assert.equal(getRejectedWatchProgressRecovery({ paused: true, ended: false }), 'stay-paused');
});

test('watch-progress resume ignores stale lessons and restores the correct position', () => {
  assert.equal(getVideoResumeTarget({
    lessonId: 'lesson-2', watchRequired: true, watchProgress: emptyProgress,
    pendingResume: { lessonId: 'lesson-1', position: 12, resumePlayback: true },
  }), null);
  assert.equal(getVideoResumeTarget({
    lessonId: 'lesson-1', watchRequired: false,
    watchProgress: { ...emptyProgress, lessonId: 'lesson-1', ready: true, watchedUntilSeconds: 45 },
    pendingResume: null,
  }), null);
  assert.deepEqual(getVideoResumeTarget({
    lessonId: 'lesson-1', watchRequired: true,
    watchProgress: { ...emptyProgress, lessonId: 'lesson-1', ready: true, started: true, lastPositionSeconds: 22 },
    pendingResume: null,
  }), { kind: 'watch-progress', position: 22 });
  assert.deepEqual(getVideoResumeTarget({
    lessonId: 'lesson-1', watchRequired: true,
    watchProgress: { ...emptyProgress, lessonId: 'lesson-1', ready: true, complete: true, watchedUntilSeconds: 90 },
    pendingResume: null,
  }), { kind: 'watch-progress', position: 0 });
});

test('video watch progress displays verified coverage instead of the rewind position', () => {
  const coverage = getVideoWatchProgressDisplay({ watchedUntilSeconds: 32.5, durationSeconds: 120.4 });

  assert.deepEqual(coverage, {
    ariaValue: 33, ariaMax: 120, ariaValueText: '27% of video watched', percentage: (32.5 / 120.4) * 100,
  });
  assert.deepEqual(getVideoWatchProgressDisplay({ watchedUntilSeconds: 150, durationSeconds: 120 }), {
    ariaValue: 120, ariaMax: 120, ariaValueText: '100% of video watched', percentage: 100,
  });
  assert.deepEqual(getVideoWatchProgressDisplay({ watchedUntilSeconds: 12, durationSeconds: 0 }), {
    ariaValue: 0, ariaMax: 1, ariaValueText: '0% of video watched', percentage: 0,
  });
});

test('video recovery status copy reflects whether watch tracking applies', () => {
  assert.equal(getVideoRecoveryStatusMessage('buffering', false), 'Video is buffering.');
  assert.equal(getVideoRecoveryStatusMessage('buffering', true), 'Video is buffering. Your verified watch position is saved.');
  assert.equal(getVideoRecoveryStatusMessage('reconnecting', false), 'Playback stalled. Reconnecting from your current position…');
  assert.equal(getVideoRecoveryStatusMessage('reconnecting', true), 'Playback stalled. Reconnecting from the last server-verified position…');
});

test('stall recovery steps backward and stops after three automatic retries', () => {
  assert.deepEqual(getVideoStallRecoveryPlan({ attempts: 0, lastPositionSeconds: 100 }), {
    kind: 'retry', attempt: 1, rewindSeconds: 5, targetPositionSeconds: 95,
  });
  assert.deepEqual(getVideoStallRecoveryPlan({ attempts: 1, lastPositionSeconds: 95 }), {
    kind: 'retry', attempt: 2, rewindSeconds: 10, targetPositionSeconds: 85,
  });
  assert.deepEqual(getVideoStallRecoveryPlan({ attempts: 2, lastPositionSeconds: 85 }), {
    kind: 'retry', attempt: 3, rewindSeconds: 15, targetPositionSeconds: 70,
  });
  assert.deepEqual(getVideoStallRecoveryPlan({ attempts: 3, lastPositionSeconds: 70 }), { kind: 'manual' });
  assert.deepEqual(getVideoStallRecoveryPlan({ attempts: 0, lastPositionSeconds: 4 }), {
    kind: 'retry', attempt: 1, rewindSeconds: 4, targetPositionSeconds: 0,
  });
});

test('recovery attempts reset only after playback clears the original stuck point', () => {
  const recovery = { lessonId: 'lesson-1', recoveryLessonId: 'lesson-1', recoveryCheckpointSeconds: 42 };

  assert.equal(videoRecoveryMadeProgress({ ...recovery, positionSeconds: 52 }), false);
  assert.equal(videoRecoveryMadeProgress({ ...recovery, positionSeconds: 52.01 }), true);
  assert.equal(videoRecoveryMadeProgress({ ...recovery, lessonId: 'lesson-2', positionSeconds: 60 }), false);
  assert.equal(videoRecoveryMadeProgress({ ...recovery, recoveryLessonId: null, positionSeconds: 60 }), false);
});
