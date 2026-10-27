import assert from 'node:assert/strict';
import test from 'node:test';
import { captureVideoPlaybackDiagnostics } from '../../src/video-playback-diagnostics.ts';

test('media state is captured before a queued reload can reset it', () => {
  const priorDocument = globalThis.document;
  globalThis.document = { visibilityState: 'visible' };
  try {
    const range = { length: 1, start: () => 0, end: () => 2010 };
    const video = { currentTime: 4724.544, duration: 4724.544, paused: true, ended: true, seeking: false,
      readyState: 2, networkState: 1, error: { code: 3, message: 'private error' }, playbackRate: 1,
      buffered: range, seekable: range, src: 'https://private.invalid' };
    const snapshot = captureVideoPlaybackDiagnostics(video, 'ended', 2);
    video.currentTime = 0;
    video.ended = false;
    assert.equal(snapshot.positionSeconds, 4724.544);
    assert.equal(snapshot.ended, true);
    assert.equal(snapshot.mediaErrorCode, 3);
    assert.deepEqual(snapshot.buffered, [{ startSeconds: 0, endSeconds: 2010 }]);
    assert.doesNotMatch(JSON.stringify(snapshot), /private/);
    video.buffered = { length: 1, start: () => { throw new Error('ranges changed'); } };
    assert.doesNotThrow(() => captureVideoPlaybackDiagnostics(video, 'media-error', 2));
  } finally {
    if (priorDocument === undefined) delete globalThis.document;
    else globalThis.document = priorDocument;
  }
});
