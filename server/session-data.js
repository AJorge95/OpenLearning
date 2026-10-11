export function parseSessionData(serialized) {
  try {
    const sessionData = JSON.parse(serialized);
    return sessionData && typeof sessionData === 'object' && !Array.isArray(sessionData)
      ? sessionData
      : null;
  } catch {
    // Damaged legacy rows must not break startup; callers decide how to discard them.
    return null;
  }
}

export function sessionUserId(sessionData) {
  return typeof sessionData?.userId === 'string' ? sessionData.userId : null;
}

export function sessionUserIdFromJson(serialized) {
  return sessionUserId(parseSessionData(serialized));
}
