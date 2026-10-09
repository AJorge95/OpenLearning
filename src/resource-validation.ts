const unsafeLessonResourceUrlMessage = 'Links must use HTTP or HTTPS and cannot contain embedded credentials.';

export function lessonResourceUrlError(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return 'Enter a valid link URL.';
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    return unsafeLessonResourceUrlMessage;
  }
  return null;
}
