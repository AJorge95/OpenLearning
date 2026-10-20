const signalExitCodes = new Map([
  ['SIGINT', 130],
  ['SIGTERM', 143],
]);

// Preserve normal shell interrupt statuses so stopping dev is not reported as an app failure.
export function devChildExitCode(code, signal) {
  if (signal) return signalExitCodes.get(signal) ?? 1;
  return code ?? 1;
}
