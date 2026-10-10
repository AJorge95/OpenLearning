const defaultUnavailableTtlMs = 5 * 60 * 1000;
const defaultUnavailableEntryLimit = 256;

export function createVideoDurationReader(readDuration, {
  now = () => Date.now(),
  unavailableTtlMs = defaultUnavailableTtlMs,
  unavailableEntryLimit = defaultUnavailableEntryLimit,
} = {}) {
  const pendingReads = new Map();
  const unavailableUntil = new Map();

  function hasRecentUnavailableResult(mediaId) {
    const expiresAt = unavailableUntil.get(mediaId);
    if (expiresAt === undefined) return false;
    if (expiresAt <= now()) {
      unavailableUntil.delete(mediaId);
      return false;
    }
    unavailableUntil.delete(mediaId);
    unavailableUntil.set(mediaId, expiresAt);
    return true;
  }

  function rememberUnavailableResult(mediaId) {
    if (unavailableTtlMs <= 0 || unavailableEntryLimit <= 0) return;
    unavailableUntil.delete(mediaId);
    unavailableUntil.set(mediaId, now() + unavailableTtlMs);
    while (unavailableUntil.size > unavailableEntryLimit) {
      unavailableUntil.delete(unavailableUntil.keys().next().value);
    }
  }

  return async function readVideoDuration(mediaId, filePath) {
    if (hasRecentUnavailableResult(mediaId)) return null;
    const pending = pendingReads.get(mediaId);
    if (pending) return pending;

    let request;
    request = Promise.resolve()
      .then(() => readDuration(filePath))
      .then((duration) => {
        if (!Number.isFinite(duration) || duration <= 0) {
          rememberUnavailableResult(mediaId);
          return null;
        }
        return duration;
      })
      .finally(() => {
        if (pendingReads.get(mediaId) === request) pendingReads.delete(mediaId);
      });
    pendingReads.set(mediaId, request);
    return request;
  };
}
