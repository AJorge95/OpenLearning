export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  // Express resolves this when creating or regenerating a session.
  secure: 'auto',
  maxAge: 12 * 60 * 60 * 1000,
  path: '/',
};

export function createSessionCookieProtocolMiddleware() {
  return (req, _res, next) => {
    // Stored sessions need a boolean for the current request. Assigning 'auto'
    // here is too late: Express treats the string as truthy and suppresses HTTP cookies.
    req.session.cookie.secure = req.secure === true;
    next();
  };
}
