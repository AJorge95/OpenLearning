import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../../src/api.ts';
import { withVideoWatchTimeout } from '../../src/video-watch-request.ts';

test('a hung watch request aborts and releases the serialized playback queue', async () => {
  let requestSignal;
  const hung = withVideoWatchTimeout((signal) => {
    requestSignal = signal;
    return new Promise(() => {});
  }, undefined, 10);
  const queue = hung.catch((error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, 'request_timeout');
    assert.equal(requestSignal.aborted, true);
  }).then(() => withVideoWatchTimeout(async () => ({ lastPositionSeconds: 4 })));
  assert.deepEqual(await queue, { lastPositionSeconds: 4 });
});

test('leaving a lesson cancels its watch read without turning it into a timeout', async () => {
  const parent = new AbortController();
  let requestSignal;
  const pending = withVideoWatchTimeout((signal) => {
    requestSignal = signal;
    return new Promise(() => {});
  }, parent.signal);
  parent.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(requestSignal.aborted, true);
});

test('a successful watch request detaches cancellation and keeps its result', async () => {
  const parent = new AbortController();
  let requestSignal;
  const result = await withVideoWatchTimeout(async (signal) => {
    requestSignal = signal;
    return { accepted: true };
  }, parent.signal);
  parent.abort();
  assert.deepEqual(result, { accepted: true });
  assert.equal(requestSignal.aborted, false);
});
