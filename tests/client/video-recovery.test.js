import assert from 'node:assert/strict';
import test from 'node:test';
import { getVideoRecoveryStatusMessage, getVideoResumeTarget, shouldResumeVideoPlayback, videoRecoveryMadeProgress } from '../../src/video-recovery.ts';

const emptyProgress = {
  lessonId: '',
  ready: false,
  started: false,
  complete: false,
  watchedUntilSeconds: 0,
  lastPositionSeconds: 0,
};

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

test('video recovery status copy reflects whether watch tracking applies', () => {
  assert.equal(getVideoRecoveryStatusMessage('buffering', false), 'Video is buffering.');
  assert.equal(getVideoRecoveryStatusMessage('buffering', true), 'Video is buffering. Your verified watch position is saved.');
  assert.equal(getVideoRecoveryStatusMessage('reconnecting', false), 'Playback stalled. Reconnecting from your current position…');
  assert.equal(getVideoRecoveryStatusMessage('reconnecting', true), 'Playback stalled. Reconnecting from the last server-verified position…');
});

test('automatic video recovery can retry after playback advances beyond the resumed point', () => {
  const recovery = { lessonId: 'lesson-1', recoveryLessonId: 'lesson-1', resumePositionSeconds: 42 };

  assert.equal(videoRecoveryMadeProgress({ ...recovery, positionSeconds: 44 }), false);
  assert.equal(videoRecoveryMadeProgress({ ...recovery, positionSeconds: 44.01 }), true);
  assert.equal(videoRecoveryMadeProgress({ ...recovery, lessonId: 'lesson-2', positionSeconds: 50 }), false);
  assert.equal(videoRecoveryMadeProgress({ ...recovery, recoveryLessonId: null, positionSeconds: 50 }), false);
});
