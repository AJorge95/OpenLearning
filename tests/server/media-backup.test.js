import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { copyMediaTree } from '../../server/media-backup.js';

function createFixtureDirectory() {
  const temporaryRoot = path.resolve(os.tmpdir());
  const directory = fsSync.mkdtempSync(path.join(temporaryRoot, 'openlearning-media-backup-'));
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== temporaryRoot || !path.basename(resolved).startsWith('openlearning-media-backup-')) {
    throw new Error('Refusing to use an unexpected temporary directory.');
  }
  return resolved;
}

async function withFixtureDirectory(run) {
  const directory = createFixtureDirectory();
  try {
    await run(directory);
  } finally {
    fsSync.rmSync(directory, { recursive: true, force: true });
  }
}

test('media backup copier returns deterministic per-file digests and copies nested media', async () => {
  await withFixtureDirectory(async (directory) => {
    const source = path.join(directory, 'source');
    const destination = path.join(directory, 'destination');
    const nestedContents = Buffer.from('nested media fixture');
    const rootContents = Buffer.from('root media fixture');
    await fs.mkdir(path.join(source, 'chapter'), { recursive: true });
    await fs.writeFile(path.join(source, 'chapter', 'notes.txt'), nestedContents);
    await fs.writeFile(path.join(source, 'video.mp4'), rootContents);

    const result = await copyMediaTree(source, destination);

    assert.equal(result.fileCount, 2);
    assert.equal(result.byteCount, nestedContents.length + rootContents.length);
    assert.deepEqual(result.files, [
      {
        path: 'chapter/notes.txt',
        bytes: nestedContents.length,
        sha256: createHash('sha256').update(nestedContents).digest('hex'),
      },
      {
        path: 'video.mp4',
        bytes: rootContents.length,
        sha256: createHash('sha256').update(rootContents).digest('hex'),
      },
    ]);
    assert.deepEqual(await fs.readFile(path.join(destination, 'chapter', 'notes.txt')), nestedContents);
    assert.deepEqual(await fs.readFile(path.join(destination, 'video.mp4')), rootContents);
  });
});

test('media backup copier rejects same-size corruption in the persisted copy', async () => {
  await withFixtureDirectory(async (directory) => {
    const source = path.join(directory, 'source');
    const destination = path.join(directory, 'destination');
    const sourceFile = path.join(source, 'video.mp4');
    const destinationFile = path.join(destination, 'video.mp4');
    const changedContents = Buffer.from('same-size fixture');
    changedContents[0] ^= 0xff;
    await fs.mkdir(source, { recursive: true });
    await fs.writeFile(sourceFile, 'same-size fixture');

    const originalStat = fsSync.promises.stat;
    let corruptionInjected = false;
    fsSync.promises.stat = async (filePath, ...options) => {
      const result = await originalStat.call(fsSync.promises, filePath, ...options);
      if (!corruptionInjected && path.resolve(String(filePath)) === path.resolve(destinationFile)) {
        await fs.writeFile(filePath, changedContents);
        corruptionInjected = true;
        fsSync.promises.stat = originalStat;
      }
      return result;
    };

    try {
      await assert.rejects(copyMediaTree(source, destination), /Media file verification failed for video\.mp4\./);
    } finally {
      fsSync.promises.stat = originalStat;
    }

    assert.equal(corruptionInjected, true);
    assert.equal((await fs.stat(destinationFile)).size, Buffer.byteLength('same-size fixture'));
  });
});
