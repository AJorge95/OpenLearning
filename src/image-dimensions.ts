export type ImageDimensions = { width: number; height: number };

export function isImageDimensionWithinLimit(width: number, height: number, maxDimension: number) {
  return Number.isSafeInteger(maxDimension) && maxDimension > 0
    && Number.isSafeInteger(width) && Number.isSafeInteger(height)
    && width > 0 && height > 0
    && width <= maxDimension && height <= maxDimension;
}

export function readImageDimensions(file: Blob, signal?: AbortSignal): Promise<ImageDimensions> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Image decoding was cancelled.', 'AbortError'));
      return;
    }

    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    let settled = false;
    const cleanup = (cancelLoading = false) => {
      image.onload = null;
      image.onerror = null;
      signal?.removeEventListener('abort', handleAbort);
      if (cancelLoading) image.removeAttribute('src');
      URL.revokeObjectURL(objectUrl);
    };
    function finish<T>(callback: (value: T) => void, value: T, cancelLoading = false) {
      if (settled) return;
      settled = true;
      cleanup(cancelLoading);
      callback(value);
    }
    const handleAbort = () => {
      if (settled) return;
      settled = true;
      cleanup(true);
      reject(signal?.reason ?? new DOMException('Image decoding was cancelled.', 'AbortError'));
    };

    image.onload = () => {
      const dimensions = { width: image.naturalWidth, height: image.naturalHeight };
      finish(resolve, dimensions);
    };
    image.onerror = () => {
      finish(reject, new Error('Image could not be decoded.'));
    };
    signal?.addEventListener('abort', handleAbort, { once: true });
    try {
      image.src = objectUrl;
    } catch (cause) {
      finish(reject, cause instanceof Error ? cause : new Error('Image could not be decoded.'), true);
    }
  });
}
