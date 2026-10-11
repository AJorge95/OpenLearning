const malformedUrlMessage = 'Enter a valid link URL.';
const unsafeUrlMessage = 'Links must use HTTP or HTTPS and cannot contain embedded credentials.';

export function validateLessonResourceUrl(value) {
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return { url: null, error: malformedUrlMessage };
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    return { url: null, error: unsafeUrlMessage };
  }
  return { url, error: null };
}
