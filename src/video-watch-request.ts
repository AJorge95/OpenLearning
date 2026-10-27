import { ApiError } from './api.ts';

// Watch writes are serialized. A request that never settles must not hold every
// later checkpoint, rewind, or explicit retry behind it.
export async function withVideoWatchTimeout<T>(
  request: (signal: AbortSignal) => Promise<T>,
  parentSignal?: AbortSignal,
  timeoutMs = 10_000,
): Promise<T> {
  if (parentSignal?.aborted) throw new DOMException('Request cancelled.', 'AbortError');
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  let rejectAbort: () => void = () => {};
  const interrupted = new Promise<never>((_resolve, reject) => {
    rejectAbort = () => reject(timedOut
      ? new ApiError(0, 'The video connection took too long. Retry playback from your saved position.', 'request_timeout')
      : new DOMException('Request cancelled.', 'AbortError'));
    controller.signal.addEventListener('abort', rejectAbort, { once: true });
  });
  parentSignal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await Promise.race([request(controller.signal), interrupted]);
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener('abort', cancel);
    controller.signal.removeEventListener('abort', rejectAbort);
  }
}
