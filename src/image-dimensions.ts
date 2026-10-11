export type ImageDimensions = { width: number; height: number };

export function isImageDimensionWithinLimit(width: number, height: number, maxDimension: number) {
  return Number.isSafeInteger(maxDimension) && maxDimension > 0
    && Number.isSafeInteger(width) && Number.isSafeInteger(height)
    && width > 0 && height > 0
    && width <= maxDimension && height <= maxDimension;
}

export function readImageDimensions(file: Blob): Promise<ImageDimensions> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      URL.revokeObjectURL(objectUrl);
    };

    image.onload = () => {
      const dimensions = { width: image.naturalWidth, height: image.naturalHeight };
      cleanup();
      resolve(dimensions);
    };
    image.onerror = () => {
      cleanup();
      reject(new Error('Image could not be decoded.'));
    };
    try {
      image.src = objectUrl;
    } catch (cause) {
      cleanup();
      reject(cause);
    }
  });
}
