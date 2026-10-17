import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createVideoDurationReader } from '../../server/video-duration-reader.js';

test('shares in-flight duration reads for the same media file', async () => {
  let reads = 0;
  let resolveRead;
  const readVideoDuration = createVideoDurationReader(() => {
    reads += 1;
    return new Promise((resolve) => { resolveRead = resolve; });
  });

  const firstRequest = readVideoDuration('media-a', 'video-a.mp4');
  const secondRequest = readVideoDuration('media-a', 'video-a.mp4');
  await Promise.resolve();
  assert.equal(reads, 1);

  resolveRead(42);
  assert.deepEqual(await Promise.all([firstRequest, secondRequest]), [42, 42]);
});

test('caches verified durations in a bounded least-recently-used set', async () => {
  let reads = 0;
  const readVideoDuration = createVideoDurationReader(async () => {
    reads += 1;
    return reads * 10;
  }, { durationEntryLimit: 2 });

  assert.equal(await readVideoDuration('media-a', 'video-a.mp4'), 10);
  assert.equal(await readVideoDuration('media-b', 'video-b.mp4'), 20);
  assert.equal(await readVideoDuration('media-a', 'video-a.mp4'), 10);
  assert.equal(await readVideoDuration('media-c', 'video-c.mp4'), 30);
  assert.equal(await readVideoDuration('media-a', 'video-a.mp4'), 10);
  assert.equal(reads, 3);

  assert.equal(await readVideoDuration('media-b', 'video-b.mp4'), 40);
  assert.equal(reads, 4);
});

test('caches unavailable durations until expiry', async () => {
  let currentTime = 1_000;
  let reads = 0;
  const readVideoDuration = createVideoDurationReader(async () => {
    reads += 1;
    return null;
  }, { now: () => currentTime, unavailableTtlMs: 1_000 });

  assert.equal(await readVideoDuration('media-invalid', 'invalid.mp4'), null);
  assert.equal(await readVideoDuration('media-invalid', 'invalid.mp4'), null);
  assert.equal(reads, 1);

  currentTime += 1_000;
  assert.equal(await readVideoDuration('media-invalid', 'invalid.mp4'), null);
  assert.equal(reads, 2);
});

test('bounds unavailable-duration entries and refreshes least-recently-used results', async () => {
  let reads = 0;
  const readVideoDuration = createVideoDurationReader(async () => {
    reads += 1;
    return null;
  }, { unavailableEntryLimit: 2 });

  await readVideoDuration('media-a', 'a.mp4');
  await readVideoDuration('media-b', 'b.mp4');
  await readVideoDuration('media-a', 'a.mp4');
  await readVideoDuration('media-c', 'c.mp4');
  await readVideoDuration('media-a', 'a.mp4');
  assert.equal(reads, 3);

  await readVideoDuration('media-b', 'b.mp4');
  assert.equal(reads, 4);
});

test('does not cache file read failures', async () => {
  let reads = 0;
  const readVideoDuration = createVideoDurationReader(async () => {
    reads += 1;
    throw new Error('temporary file read failure');
  });

  await assert.rejects(readVideoDuration('media-missing', 'missing.mp4'), /temporary file read failure/);
  await assert.rejects(readVideoDuration('media-missing', 'missing.mp4'), /temporary file read failure/);
  assert.equal(reads, 2);
});
