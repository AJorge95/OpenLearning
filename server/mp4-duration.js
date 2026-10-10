import fs from 'node:fs/promises';

const maximumMetadataBytes = 128 * 1024 * 1024;
const maximumFragmentBytes = 16 * 1024 * 1024;
const maximumTopLevelBoxes = 200_000;
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

function boxesIn(buffer, start = 0, end = buffer.length) {
  const boxes = [];
  let offset = start;
  while (offset + 8 <= end) {
    const size32 = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const headerBytes = size32 === 1 ? 16 : 8;
    if (offset + headerBytes > end) return null;
    let size = size32;
    if (size32 === 1) {
      const extendedSize = buffer.readBigUInt64BE(offset + 8);
      if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      size = Number(extendedSize);
    } else if (size32 === 0) size = end - offset;
    if (size < headerBytes || offset + size > end) return null;
    boxes.push({ type, offset, size, headerBytes, payload: offset + headerBytes, end: offset + size });
    offset += size;
  }
  return boxes;
}

function trackIdFromHeader(buffer, box) {
  const version = buffer[box.payload];
  const trackIdOffset = box.payload + (version === 1 ? 20 : 12);
  return trackIdOffset + 4 <= box.end ? buffer.readUInt32BE(trackIdOffset) : null;
}

function timescaleFromMediaHeader(buffer, box) {
  const version = buffer[box.payload];
  const timescaleOffset = box.payload + (version === 1 ? 20 : 12);
  if (timescaleOffset + 4 > box.end) return null;
  const timescale = buffer.readUInt32BE(timescaleOffset);
  return timescale > 0 ? timescale : null;
}

function movieTracksFromMetadata(movie) {
  const children = boxesIn(movie);
  if (!children) return null;
  const tracks = new Map();
  const defaultSampleDurations = new Map();
  for (const box of children) {
    if (box.type === 'trak') {
      const trackBoxes = boxesIn(movie, box.payload, box.end);
      if (!trackBoxes) return null;
      const header = trackBoxes.find((child) => child.type === 'tkhd');
      const mediaBox = trackBoxes.find((child) => child.type === 'mdia');
      if (!header || !mediaBox) continue;
      const trackId = trackIdFromHeader(movie, header);
      const mediaBoxes = boxesIn(movie, mediaBox.payload, mediaBox.end);
      if (!trackId || !mediaBoxes) continue;
      const mediaHeader = mediaBoxes.find((child) => child.type === 'mdhd');
      const handler = mediaBoxes.find((child) => child.type === 'hdlr');
      if (!mediaHeader || !handler || handler.payload + 12 > handler.end) continue;
      const timescale = timescaleFromMediaHeader(movie, mediaHeader);
      if (timescale && movie.toString('ascii', handler.payload + 8, handler.payload + 12) === 'vide') {
        tracks.set(trackId, { timescale, firstPresentationTime: Number.POSITIVE_INFINITY,
          lastPresentationEnd: Number.NEGATIVE_INFINITY, nextDecodeTime: null });
      }
    } else if (box.type === 'mvex') {
      const extensionBoxes = boxesIn(movie, box.payload, box.end);
      if (!extensionBoxes) return null;
      for (const extension of extensionBoxes) {
        if (extension.type !== 'trex' || extension.payload + 20 > extension.end) continue;
        const trackId = movie.readUInt32BE(extension.payload + 4);
        const defaultDuration = movie.readUInt32BE(extension.payload + 12);
        if (trackId && defaultDuration) defaultSampleDurations.set(trackId, defaultDuration);
      }
    }
  }
  return tracks.size ? { tracks, defaultSampleDurations } : null;
}

function trackFragmentHeader(buffer, box) {
  if (box.payload + 8 > box.end) return null;
  const flags = buffer.readUInt32BE(box.payload) & 0x00ffffff;
  const trackId = buffer.readUInt32BE(box.payload + 4);
  let offset = box.payload + 8;
  if (flags & 0x000001) offset += 8;
  if (flags & 0x000002) offset += 4;
  let defaultDuration = null;
  if (flags & 0x000008) {
    if (offset + 4 > box.end) return null;
    defaultDuration = buffer.readUInt32BE(offset);
  }
  return trackId ? { trackId, defaultDuration } : null;
}

function baseDecodeTimeFromFragment(buffer, box) {
  if (box.payload + 8 > box.end) return null;
  const version = buffer[box.payload];
  if (version === 1) {
    const value = buffer.readBigUInt64BE(box.payload + 4);
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
  }
  return buffer.readUInt32BE(box.payload + 4);
}

function sampleRunTimes(buffer, box, decodeStart, defaultDuration) {
  if (box.payload + 8 > box.end) return null;
  const versionAndFlags = buffer.readUInt32BE(box.payload);
  const version = versionAndFlags >>> 24;
  const flags = versionAndFlags & 0x00ffffff;
  const sampleCount = buffer.readUInt32BE(box.payload + 4);
  if (sampleCount > 1_000_000) return null;
  let offset = box.payload + 8;
  if (flags & 0x000001) offset += 4;
  if (flags & 0x000004) offset += 4;
  if (offset > box.end) return null;

  let decodeTime = decodeStart;
  let firstPresentationTime = Number.POSITIVE_INFINITY;
  let lastPresentationEnd = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < sampleCount; index += 1) {
    let sampleDuration = defaultDuration;
    if (flags & 0x000100) {
      if (offset + 4 > box.end) return null;
      sampleDuration = buffer.readUInt32BE(offset);
      offset += 4;
    }
    if (!sampleDuration || !Number.isSafeInteger(sampleDuration)) return null;
    if (flags & 0x000200) offset += 4;
    if (flags & 0x000400) offset += 4;
    let compositionOffset = 0;
    if (flags & 0x000800) {
      if (offset + 4 > box.end) return null;
      compositionOffset = version === 1 ? buffer.readInt32BE(offset) : buffer.readUInt32BE(offset);
      offset += 4;
    }
    if (offset > box.end) return null;
    const presentationTime = decodeTime + compositionOffset;
    firstPresentationTime = Math.min(firstPresentationTime, presentationTime);
    lastPresentationEnd = Math.max(lastPresentationEnd, presentationTime + sampleDuration);
    decodeTime += sampleDuration;
  }
  return { decodeEnd: decodeTime, firstPresentationTime, lastPresentationEnd };
}

function updateFragmentedTrackDurations(fragment, movie) {
  const moofBoxes = boxesIn(fragment);
  if (!moofBoxes) return false;
  for (const traf of moofBoxes.filter((box) => box.type === 'traf')) {
    const children = boxesIn(fragment, traf.payload, traf.end);
    if (!children) return false;
    const headerBox = children.find((box) => box.type === 'tfhd');
    if (!headerBox) continue;
    const header = trackFragmentHeader(fragment, headerBox);
    const track = header && movie.tracks.get(header.trackId);
    if (!track) continue;
    const timingBox = children.find((box) => box.type === 'tfdt');
    let decodeTime = timingBox ? baseDecodeTimeFromFragment(fragment, timingBox) : track.nextDecodeTime;
    if (decodeTime === null || decodeTime === undefined) continue;
    track.firstPresentationTime = Math.min(track.firstPresentationTime, decodeTime);
    const defaultDuration = header.defaultDuration || movie.defaultSampleDurations.get(header.trackId) || 0;
    for (const run of children.filter((box) => box.type === 'trun')) {
      const timing = sampleRunTimes(fragment, run, decodeTime, defaultDuration);
      if (!timing) return false;
      if (timing.firstPresentationTime !== Number.POSITIVE_INFINITY) {
        track.firstPresentationTime = Math.min(track.firstPresentationTime, timing.firstPresentationTime);
        track.lastPresentationEnd = Math.max(track.lastPresentationEnd, timing.lastPresentationEnd);
      }
      decodeTime = timing.decodeEnd;
    }
    track.nextDecodeTime = decodeTime;
  }
  return true;
}

function durationFromFragments(movie) {
  let duration = 0;
  for (const track of movie.tracks.values()) {
    const ticks = track.lastPresentationEnd - track.firstPresentationTime;
    const seconds = ticks / track.timescale;
    if (Number.isFinite(seconds) && seconds > duration) duration = seconds;
  }
  return duration > 0 && duration <= maximumDurationSeconds ? duration : null;
}

export async function readMp4Duration(filePath) {
  const handle = await fs.open(filePath, 'r');
  try {
    const { size } = await handle.stat();
    let offset = 0;
    let topLevelBoxCount = 0;
    let fragmentedMovie = null;
    while (offset + 8 <= size && topLevelBoxCount < maximumTopLevelBoxes) {
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
        if (!metadata) return null;
        const movieDuration = durationFromMovieHeader(metadata);
        if (movieDuration) return movieDuration;
        fragmentedMovie = movieTracksFromMetadata(metadata);
        if (!fragmentedMovie) return null;
      } else if (type === 'moof' && fragmentedMovie) {
        const fragmentSize = boxSize - headerBytes;
        if (fragmentSize > maximumFragmentBytes) return null;
        const fragment = await readAt(handle, fragmentSize, offset + headerBytes);
        if (!fragment || !updateFragmentedTrackDurations(fragment, fragmentedMovie)) return null;
      }
      offset += boxSize;
      topLevelBoxCount += 1;
    }
    if (offset + 8 <= size) return null;
    return fragmentedMovie ? durationFromFragments(fragmentedMovie) : null;
  } finally {
    await handle.close();
  }
}
