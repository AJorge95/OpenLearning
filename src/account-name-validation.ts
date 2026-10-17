export const MAX_ACCOUNT_NAME_LENGTH = 80;

// Keep the browser and server normalization rules identical for certificate names.
export function normalizeAccountName(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

export function accountNameError(value: unknown, label: string) {
  const normalized = normalizeAccountName(value);
  if (typeof value !== 'string' || !normalized || normalized.length > MAX_ACCOUNT_NAME_LENGTH
    || /[\u0000-\u001f\u007f]/.test(normalized)) {
    return `${label} must be between 1 and ${MAX_ACCOUNT_NAME_LENGTH} characters.`;
  }
  return null;
}
