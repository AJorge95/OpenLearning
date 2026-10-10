import assert from 'node:assert/strict';
import test from 'node:test';
import { tryEnterFullscreen } from '../../src/video-fullscreen.ts';

test('enters full screen when the browser request succeeds', async () => {
  let calls = 0;
  const target = { requestFullscreen: async () => { calls += 1; } };

  assert.equal(await tryEnterFullscreen(target), 'entered');
  assert.equal(calls, 1);
});

test('reports when the browser does not support full screen', async () => {
  assert.equal(await tryEnterFullscreen(null), 'unsupported');
  assert.equal(await tryEnterFullscreen({}), 'unsupported');
});

test('converts a rejected browser request into a failure result', async () => {
  const target = { requestFullscreen: async () => { throw new Error('Permission denied'); } };

  assert.equal(await tryEnterFullscreen(target), 'failed');
});
