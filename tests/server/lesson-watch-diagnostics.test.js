import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeVideoPlaybackDiagnostics, rejectedVideoProgressLog } from '../../server/lesson-watch-diagnostics.js';

test('a premature end report is distinguished from proven manual seeking, including for old clients', () => {
  const log = rejectedVideoProgressLog({ reportedPositionSeconds: 4724.544, durationSeconds: 4724.544,
    lastAcceptedPositionSeconds: 2010.255372, maximumCrediblePositionSeconds: 2011.048372,
    anomaly: 'forward_seek', heartbeatAgeSeconds: 0.793, creditedElapsedSeconds: 0.793 }, undefined);
  assert.equal(log.message, 'Video end position rejected before verified completion');
  assert.equal(log.details.classification, 'unverified_end_position');
  assert.equal(log.details.causeConfirmed, false);
  assert.equal(log.details.positionGapSeconds, 4724.544 - 2010.255372);
  assert.equal(log.details.heartbeatAgeSeconds, 0.793);
  assert.equal(log.details.clientPlayback, undefined);
});

test('browser diagnostics are bounded and exclude URLs, secrets, and free-text error messages', () => {
  const playback = normalizeVideoPlaybackDiagnostics({ event: 'ended', ended: true, paused: true,
    positionSeconds: 4724.544, durationSeconds: 4724.544, readyState: 2, networkState: 3, mediaErrorCode: 3,
    recoveryAttempt: 2, visibility: 'visible', src: 'https://private.invalid/?token=secret',
    errorMessage: 'password=secret', token: 'secret', unknown: { secret: 'secret' },
    buffered: Array.from({ length: 100 }, (_, i) => ({ startSeconds: i, endSeconds: i + 1 })),
    seekable: [{ startSeconds: 12, endSeconds: 2 }, { startSeconds: 0, endSeconds: Infinity }],
  });
  assert.equal(playback.mediaErrorCode, 'decode');
  assert.equal(playback.readyState, 'current_data');
  assert.equal(playback.networkState, 'no_source');
  assert.equal(playback.recoveryAttempt, 2);
  assert.equal(playback.buffered.length, 4);
  assert.deepEqual(playback.buffered[0], { startSeconds: 96, endSeconds: 97 });
  assert.deepEqual(playback.seekable, []);
  assert.doesNotMatch(JSON.stringify(playback), /secret|private|password|token|errorMessage|unknown/);
  assert.equal(normalizeVideoPlaybackDiagnostics(null), undefined);
  assert.deepEqual(normalizeVideoPlaybackDiagnostics({ event: 'arbitrary text', readyState: -1, recoveryAttempt: 99 }), { clientReported: true });
});
