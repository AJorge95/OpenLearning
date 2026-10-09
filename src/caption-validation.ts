export const captionFileLimitBytes = 5 * 1024 * 1024;
export const captionLanguageErrorMessage = 'Enter a valid language tag such as en or en-GB.';

export function captionFileSizeError(size: number): string | null {
  return size > captionFileLimitBytes ? 'Choose a WebVTT file that is 5 MB or smaller.' : null;
}

export function canonicalCaptionLanguageTag(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 35) return null;
  try {
    return Intl.getCanonicalLocales(trimmed)[0] || null;
  } catch {
    return null;
  }
}
