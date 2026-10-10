import { fail } from './http.js';

const maximumNameLength = 80;

export function accountName(value, label) {
  if (typeof value !== 'string') fail(400, `${label} must be between 1 and ${maximumNameLength} characters.`, 'invalid_name');
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > maximumNameLength || /[\u0000-\u001f\u007f]/.test(normalized)) {
    fail(400, `${label} must be between 1 and ${maximumNameLength} characters.`, 'invalid_name');
  }
  return normalized;
}

export function accountNames(body) {
  return {
    firstName: accountName(body?.firstName, 'First name'),
    lastName: accountName(body?.lastName, 'Last name'),
  };
}
