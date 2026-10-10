import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { readMp4Duration } from './mp4-duration.js';

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
