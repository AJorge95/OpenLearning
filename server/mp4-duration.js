import fs from 'node:fs/promises';

const maximumMetadataBytes = 128 * 1024 * 1024;
const maximumDurationSeconds = 24 * 60 * 60;

async function readAt(handle, length, position) {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return bytesRead === length ? buffer : null;
}

function durationFromMovieHeader(movie) {
  const marker = Buffer.from('mvhd');
  let markerOffset = movie.indexOf(marker);
  while (markerOffset >= 4) {
    const boxOffset = markerOffset - 4;
    const boxSize = movie.readUInt32BE(boxOffset);
    if (boxSize >= 28 && boxOffset + boxSize <= movie.length) {
      const headerBytes = boxSize === 1 ? 16 : 8;
      const payload = boxOffset + headerBytes;
      const version = movie[payload];
      let timeScale;
      let duration;
      if (version === 0 && boxSize >= headerBytes + 20) {
        timeScale = movie.readUInt32BE(payload + 12);
        duration = movie.readUInt32BE(payload + 16);
      } else if (version === 1 && boxSize >= headerBytes + 32) {
        timeScale = movie.readUInt32BE(payload + 20);
        duration = Number(movie.readBigUInt64BE(payload + 24));
      }
      const seconds = timeScale && duration ? duration / timeScale : 0;
      if (Number.isFinite(seconds) && seconds > 0 && seconds <= maximumDurationSeconds) return seconds;
    }
    markerOffset = movie.indexOf(marker, markerOffset + marker.length);
  }
  return null;
}

export async function readMp4Duration(filePath) {
  const handle = await fs.open(filePath, 'r');
  try {
    const { size } = await handle.stat();
    let offset = 0;
    while (offset + 8 <= size) {
      const header = await readAt(handle, 16, offset);
      if (!header) break;
      const size32 = header.readUInt32BE(0);
      const type = header.toString('ascii', 4, 8);
      const headerBytes = size32 === 1 ? 16 : 8;
      let boxSize = size32;
      if (size32 === 1) {
        const largeSize = header.readBigUInt64BE(8);
        if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) return null;
        boxSize = Number(largeSize);
      } else if (size32 === 0) boxSize = size - offset;
      if (boxSize < headerBytes || offset + boxSize > size) return null;
      if (type === 'moov') {
        const metadataSize = boxSize - headerBytes;
        if (metadataSize > maximumMetadataBytes) return null;
        const metadata = await readAt(handle, metadataSize, offset + headerBytes);
        return metadata ? durationFromMovieHeader(metadata) : null;
      }
      offset += boxSize;
    }
    return null;
  } finally {
    await handle.close();
  }
}
