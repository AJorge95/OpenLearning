function requestAbortError() {
  return new DOMException('Request cancelled.', 'AbortError');
}

/** Stop a startup backoff immediately when the owning request is cancelled. */
export function waitForStartupRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(requestAbortError());
  return new Promise<void>((resolve, reject) => {
    const timerId = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, delayMs);
    function abort() {
      clearTimeout(timerId);
      signal.removeEventListener('abort', abort);
      reject(requestAbortError());
    }
    signal.addEventListener('abort', abort, { once: true });
  });
}
