import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { readMp4Duration } from '../../server/mp4-duration.js';

let fixtureDirectory;

function makeBox(type, payload, extended = false) {
  if (extended) {
    const header = Buffer.alloc(16);
    header.writeUInt32BE(1, 0);
    header.write(type, 4, 4, 'ascii');
    header.writeBigUInt64BE(BigInt(header.length + payload.length), 8);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(8);
  header.writeUInt32BE(header.length + payload.length, 0);
  header.write(type, 4, 4, 'ascii');
  return Buffer.concat([header, payload]);
}

function movieHeaderV0(timeScale, duration) {
  const payload = Buffer.alloc(20);
  payload.writeUInt32BE(timeScale, 12);
  payload.writeUInt32BE(duration, 16);
  return makeBox('mvhd', payload);
}

function movieHeaderV1(timeScale, duration) {
  const payload = Buffer.alloc(32);
  payload[0] = 1;
  payload.writeUInt32BE(timeScale, 20);
  payload.writeBigUInt64BE(BigInt(duration), 24);
  return makeBox('mvhd', payload);
}

function fragmentedMovieMetadata(timeScale, defaultSampleDuration = 0) {
  const trackHeader = Buffer.alloc(24);
  trackHeader.writeUInt32BE(1, 12);
  const mediaHeader = Buffer.alloc(20);
  mediaHeader.writeUInt32BE(timeScale, 12);
  const handler = Buffer.alloc(24);
  handler.write('vide', 8, 4, 'ascii');
  const trackExtends = Buffer.alloc(24);
  trackExtends.writeUInt32BE(1, 4);
  trackExtends.writeUInt32BE(defaultSampleDuration, 12);

  return makeBox('moov', Buffer.concat([
    movieHeaderV0(timeScale, 0),
    makeBox('trak', Buffer.concat([
      makeBox('tkhd', trackHeader),
      makeBox('mdia', Buffer.concat([
        makeBox('mdhd', mediaHeader),
        makeBox('hdlr', handler),
      ])),
    ])),
    makeBox('mvex', makeBox('trex', trackExtends)),
  ]));
}

function movieFragment(decodeStart, sampleDurations, { useDefaults = false } = {}) {
  const trackHeader = Buffer.alloc(useDefaults ? 12 : 8);
  if (useDefaults) trackHeader.writeUInt32BE(0x000008, 0);
  trackHeader.writeUInt32BE(1, 4);
  if (useDefaults) trackHeader.writeUInt32BE(sampleDurations[0], 8);

  const timing = Buffer.alloc(8);
  timing.writeUInt32BE(0, 0);
  timing.writeUInt32BE(decodeStart, 4);

  const run = Buffer.alloc(useDefaults ? 8 : 8 + sampleDurations.length * 4);
  run.writeUInt32BE(useDefaults ? 0 : 0x000100, 0);
  run.writeUInt32BE(sampleDurations.length, 4);
  if (!useDefaults) sampleDurations.forEach((duration, index) => run.writeUInt32BE(duration, 8 + index * 4));

  return makeBox('moof', makeBox('traf', Buffer.concat([
    makeBox('tfhd', trackHeader), makeBox('tfdt', timing), makeBox('trun', run),
  ])));
}

async function readFixture(name, boxes) {
  const filePath = path.join(fixtureDirectory, name);
  await fs.writeFile(filePath, Buffer.concat(boxes));
  return readMp4Duration(filePath);
}

before(async () => {
  const tempBase = path.resolve(os.tmpdir());
  fixtureDirectory = path.resolve(await fs.mkdtemp(path.join(tempBase, 'openlearning-mp4-duration-')));
  if (path.dirname(fixtureDirectory) !== tempBase
    || !path.basename(fixtureDirectory).startsWith('openlearning-mp4-duration-')) {
    throw new Error('Refusing to use an unexpected temporary directory.');
  }
});

after(async () => {
  if (!fixtureDirectory) return;
  const tempBase = path.resolve(os.tmpdir());
  const resolved = path.resolve(fixtureDirectory);
  if (path.dirname(resolved) !== tempBase || !path.basename(resolved).startsWith('openlearning-mp4-duration-')) {
    throw new Error('Refusing to remove an unexpected temporary directory.');
  }
  await fs.rm(resolved, { recursive: true, force: true });
});

test('reads version-zero movie duration after earlier top-level media boxes', async () => {
  const duration = await readFixture('version-zero.mp4', [
    makeBox('ftyp', Buffer.from('isom')),
    makeBox('mdat', Buffer.alloc(16)),
    makeBox('moov', movieHeaderV0(1_000, 12_500)),
  ]);

  assert.equal(duration, 12.5);
});

test('reads version-one duration from an extended-size movie box', async () => {
  const duration = await readFixture('version-one.mp4', [
    makeBox('moov', movieHeaderV1(90_000, 8_122_500), true),
  ]);

  assert.equal(duration, 90.25);
});

test('returns no duration for missing or malformed movie metadata', async () => {
  const malformedBox = Buffer.alloc(8);
  malformedBox.writeUInt32BE(128, 0);
  malformedBox.write('moov', 4, 4, 'ascii');

  assert.equal(await readFixture('no-moov.mp4', [makeBox('ftyp', Buffer.from('isom'))]), null);
  assert.equal(await readFixture('bad-box.mp4', [malformedBox]), null);
  assert.equal(await readFixture('missing-mvhd.mp4', [makeBox('moov', makeBox('trak', Buffer.alloc(4)))]), null);
});

test('rejects zero-scale, unsupported, and overlong movie headers', async () => {
  const unsupported = movieHeaderV0(1_000, 5_000);
  unsupported[8] = 2;

  assert.equal(await readFixture('zero-timescale.mp4', [makeBox('moov', movieHeaderV0(0, 5_000))]), null);
  assert.equal(await readFixture('unsupported-version.mp4', [makeBox('moov', unsupported)]), null);
  assert.equal(await readFixture('overlong.mp4', [makeBox('moov', movieHeaderV0(1, 24 * 60 * 60 + 1))]), null);
});

test('reads duration across fragmented video samples', async () => {
  const duration = await readFixture('fragmented.mp4', [
    makeBox('ftyp', Buffer.from('iso6')),
    fragmentedMovieMetadata(1_000),
    movieFragment(0, [1_000, 1_500]),
    makeBox('mdat', Buffer.alloc(16)),
    movieFragment(2_500, [2_500, 3_000]),
    makeBox('mdat', Buffer.alloc(16)),
  ]);

  assert.equal(duration, 8);
});

test('stops scanning files with excessive top-level boxes', async () => {
  const maximumTopLevelBoxes = 200_000;
  const fillerBox = makeBox('free', Buffer.alloc(8));
  const filler = Buffer.alloc(fillerBox.length * (maximumTopLevelBoxes - 1));
  for (let offset = 0; offset < filler.length; offset += fillerBox.length) fillerBox.copy(filler, offset);
  const duration = await readFixture('excessive-boxes.mp4', [
    fragmentedMovieMetadata(1_000),
    movieFragment(0, [1_000]),
    filler,
  ]);

  assert.equal(duration, null);
});

test('uses fragmented movie default sample durations when runs omit them', async () => {
  const duration = await readFixture('fragmented-defaults.mp4', [
    fragmentedMovieMetadata(90_000, 45_000),
    movieFragment(0, [45_000, 45_000], { useDefaults: true }),
  ]);

  assert.equal(duration, 1);
});

test('rejects malformed fragmented sample timing', async () => {
  const invalidRun = Buffer.alloc(12);
  invalidRun.writeUInt32BE(0x000100, 0);
  invalidRun.writeUInt32BE(2, 4);
  invalidRun.writeUInt32BE(1_000, 8);
  const fragment = makeBox('moof', makeBox('traf', Buffer.concat([
    makeBox('tfhd', Buffer.from([0, 0, 0, 0, 0, 0, 0, 1])),
    makeBox('tfdt', Buffer.from([0, 0, 0, 0, 0, 0, 0, 0])),
    makeBox('trun', invalidRun),
  ])));
  const duration = await readFixture('fragmented-malformed.mp4', [
    fragmentedMovieMetadata(1_000), fragment,
  ]);

  assert.equal(duration, null);
});
