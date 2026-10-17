// Keep this fallback aligned with server/config.js until platform configuration loads.
export const DEFAULT_MAX_UPLOAD_BYTES = 2 * 1024 ** 3;

// Match server/http.js so local preflight errors use the same limit wording as HTTP 413 responses.
export function formatUploadLimit(bytes: number) {
  const units = ['bytes', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const size = unitIndex === 0
    ? `${value.toLocaleString('en-US')} ${value === 1 ? 'byte' : 'bytes'}`
    : `${Number.isInteger(value) ? value : value.toFixed(1)} ${units[unitIndex]}`;
  return `${size} (${bytes.toLocaleString('en-US')} ${bytes === 1 ? 'byte' : 'bytes'})`;
}

// This check improves feedback and saves bandwidth; upload routes remain authoritative.
export function uploadSizeError(fileSizeBytes: number, maxUploadBytes: number) {
  if (!Number.isSafeInteger(fileSizeBytes) || fileSizeBytes < 0
    || !Number.isSafeInteger(maxUploadBytes) || maxUploadBytes <= 0
    || fileSizeBytes <= maxUploadBytes) return null;
  return `This file exceeds the configured upload limit of ${formatUploadLimit(maxUploadBytes)}.`;
}
