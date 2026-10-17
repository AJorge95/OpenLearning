let startupMediaCleanup = Promise.resolve();

export function setStartupMediaCleanup(promise) {
  startupMediaCleanup = promise;
}

export function waitForStartupMediaCleanup() {
  return startupMediaCleanup;
}
