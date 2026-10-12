const defaultUnavailableTtlMs = 5 * 60 * 1000;
const defaultUnavailableEntryLimit = 256;
const defaultDurationEntryLimit = 256;

export function createVideoDurationReader(readDuration, {
  now = () => Date.now(),
  unavailableTtlMs = defaultUnavailableTtlMs,
  unavailableEntryLimit = defaultUnavailableEntryLimit,
  durationEntryLimit = defaultDurationEntryLimit,
} = {}) {
  const pendingReads = new Map();
  const unavailableUntil = new Map();
  const verifiedDurations = new Map();
  const verifiedDurationLimit = Number.isSafeInteger(durationEntryLimit)
    ? Math.max(0, durationEntryLimit)
    : defaultDurationEntryLimit;

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

  function cachedVerifiedDuration(mediaId) {
    const duration = verifiedDurations.get(mediaId);
    if (duration === undefined) return undefined;
    verifiedDurations.delete(mediaId);
    verifiedDurations.set(mediaId, duration);
    return duration;
  }

  function rememberVerifiedDuration(mediaId, duration) {
    if (verifiedDurationLimit === 0) return;
    verifiedDurations.delete(mediaId);
    verifiedDurations.set(mediaId, duration);
    while (verifiedDurations.size > verifiedDurationLimit) {
      verifiedDurations.delete(verifiedDurations.keys().next().value);
    }
  }

  return async function readVideoDuration(mediaId, filePath) {
    const cachedDuration = cachedVerifiedDuration(mediaId);
    if (cachedDuration !== undefined) return cachedDuration;
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
        // Keep a bounded copy so a failed database-cache write does not rescan the MP4 on every request.
        rememberVerifiedDuration(mediaId, duration);
        return duration;
      })
      .finally(() => {
        if (pendingReads.get(mediaId) === request) pendingReads.delete(mediaId);
      });
    pendingReads.set(mediaId, request);
    return request;
  };
}
