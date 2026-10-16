import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

async function hashFile(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

export async function copyMediaTree(source, destination, relativePath = '') {
  await fs.mkdir(destination, { recursive: true });
  let fileCount = 0;
  let byteCount = 0;
  const files = [];
  const entries = (await fs.readdir(source, { withFileTypes: true }))
    .sort((first, second) => (first.name < second.name ? -1 : first.name > second.name ? 1 : 0));
  for (const entry of entries) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    const relativeFilePath = path.join(relativePath, entry.name).split(path.sep).join('/');
    if (entry.isSymbolicLink()) throw new Error('The course media directory contains a symbolic link; the backup cannot safely include it.');
    if (entry.isDirectory()) {
      const nested = await copyMediaTree(from, to, relativeFilePath);
      fileCount += nested.fileCount;
      byteCount += nested.byteCount;
      for (const file of nested.files) files.push(file);
    } else if (entry.isFile()) {
      const sourceHash = createHash('sha256');
      let copiedBytes = 0;
      // Stream without buffering whole media files; compare the persisted copy before declaring it verified.
      const hashWhileCopying = new Transform({
        transform(chunk, _encoding, callback) {
          copiedBytes += chunk.length;
          sourceHash.update(chunk);
          callback(null, chunk);
        },
      });
      await pipeline(createReadStream(from), hashWhileCopying, createWriteStream(to, { flags: 'wx' }));
      const copied = await fs.stat(to);
      const sha256 = sourceHash.digest('hex');
      if (copied.size !== copiedBytes || await hashFile(to) !== sha256) {
        throw new Error(`Media file verification failed for ${relativeFilePath}.`);
      }
      fileCount += 1;
      byteCount += copiedBytes;
      files.push({ path: relativeFilePath, bytes: copiedBytes, sha256 });
    } else {
      throw new Error(`Unsupported entry in course media directory: ${entry.name}.`);
    }
  }
  return { fileCount, byteCount, files };
}
