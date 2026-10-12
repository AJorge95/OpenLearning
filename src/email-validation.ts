const invalidEmailMessage = 'Enter a valid email address (up to 254 characters).';

// Share the server's email rules so setup and signup can explain rejected values before sending a request.
export function validateEmail(email: unknown) {
  const normalized = typeof email === 'string' ? email.trim() : '';
  const separator = normalized.indexOf('@');
  const domain = separator >= 0 ? normalized.slice(separator + 1) : '';
  if (normalized.length > 254 || separator < 1 || separator !== normalized.lastIndexOf('@') || separator > 64
    || !/^[^\s@]+$/.test(normalized.slice(0, separator)) || !domain.includes('.')
    || domain.split('.').some((label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))) {
    return invalidEmailMessage;
  }
  return null;
}
