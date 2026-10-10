import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { streamFileToResponse } from '../../server/file-stream.js';

function createFixtureDirectory() {
  const tempBase = path.resolve(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(tempBase, 'openlearning-file-stream-'));
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== tempBase
    || !path.basename(resolvedDirectory).startsWith('openlearning-file-stream-')) {
    throw new Error('Refusing to use an unexpected temporary directory.');
  }
  return resolvedDirectory;
}

function removeFixtureDirectory(directory) {
  if (!directory) return;
  const tempBase = path.resolve(os.tmpdir());
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== tempBase
    || !path.basename(resolvedDirectory).startsWith('openlearning-file-stream-')) {
    throw new Error('Refusing to remove an unexpected temporary directory.');
  }
  fs.rmSync(resolvedDirectory, { recursive: true, force: true });
}

test('file streams deliver their bytes and finish normally', async () => {
  const directory = createFixtureDirectory();
  try {
    const expected = Buffer.from('course media payload');
    const filePath = path.join(directory, 'media.bin');
    fs.writeFileSync(filePath, expected);

    const response = new PassThrough();
    const chunks = [];
    const errors = [];
    response.on('data', (chunk) => chunks.push(chunk));
    const responseEnded = once(response, 'end');
    const stream = streamFileToResponse(filePath, response, (error) => errors.push(error));
    const streamClosed = once(stream, 'close');

    await responseEnded;
    await streamClosed;

    assert.deepEqual(Buffer.concat(chunks), expected);
    assert.deepEqual(errors, []);
    assert.equal(response.writableFinished, true);
  } finally {
    removeFixtureDirectory(directory);
  }
});

test('file streams stop reading when the client response closes early', async () => {
  const directory = createFixtureDirectory();
  try {
    const filePath = path.join(directory, 'large-media.bin');
    fs.writeFileSync(filePath, Buffer.alloc(8 * 1024 * 1024, 0x61));

    const response = new PassThrough();
    const errors = [];
    const firstChunk = once(response, 'data');
    const stream = streamFileToResponse(filePath, response, (error) => errors.push(error));
    const streamClosed = once(stream, 'close');

    await firstChunk;
    response.destroy();
    await streamClosed;

    assert.equal(stream.destroyed, true);
    assert.deepEqual(errors, []);
  } finally {
    removeFixtureDirectory(directory);
  }
});
