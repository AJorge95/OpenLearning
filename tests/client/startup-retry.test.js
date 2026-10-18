import assert from 'node:assert/strict';
import test from 'node:test';
import { waitForStartupRetry } from '../../src/startup-retry.ts';

test('startup retry backoff resolves after its delay', async () => {
  const controller = new AbortController();
  await waitForStartupRetry(0, controller.signal);
});

test('startup retry backoff rejects promptly when its request is aborted', async () => {
  const controller = new AbortController();
  const retry = waitForStartupRetry(1_000, controller.signal);
  controller.abort();

  await assert.rejects(retry, (error) => error?.name === 'AbortError');
});

test('startup retry backoff rejects immediately for an already-aborted request', async () => {
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(waitForStartupRetry(1_000, controller.signal), (error) => error?.name === 'AbortError');
});
