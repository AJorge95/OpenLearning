export const MIN_PLATFORM_NAME_LENGTH = 2;
export const MAX_PLATFORM_NAME_LENGTH = 80;

// Keep setup, settings, and server persistence on the same trim-and-length contract.
export function normalizePlatformName(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function platformNameValidationError(value: unknown) {
  const normalizedName = normalizePlatformName(value);
  if (typeof value !== 'string' || normalizedName.length < MIN_PLATFORM_NAME_LENGTH
    || normalizedName.length > MAX_PLATFORM_NAME_LENGTH) {
    return `Platform name must be between ${MIN_PLATFORM_NAME_LENGTH} and ${MAX_PLATFORM_NAME_LENGTH} characters.`;
  }
  return null;
}
