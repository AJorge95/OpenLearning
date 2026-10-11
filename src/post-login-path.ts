const defaultPostLoginPath = '/courses';
const blockedPostLoginPaths = new Set(['/login', '/register', '/setup']);
const internalOrigin = 'http://openlearning.local';

export function getPostLoginPath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return defaultPostLoginPath;
  }

  try {
    const destination = new URL(value, internalOrigin);
    if (destination.origin !== internalOrigin || blockedPostLoginPaths.has(destination.pathname)) {
      return defaultPostLoginPath;
    }
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return defaultPostLoginPath;
  }
}
