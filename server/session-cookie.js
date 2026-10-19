export function createSessionCookieProtocolMiddleware(setting, nodeEnv) {
  return (req, _res, next) => {
    const protocol = setting('connection_protocol');
    // Match the Secure attribute to the connection Express actually sees. A
    // static Secure cookie is discarded over HTTP, leaving the UI signed in
    // while every authenticated API request is anonymous.
    req.session.cookie.secure = protocol === 'http'
      ? false
      : protocol === 'https' || nodeEnv === 'production'
        ? 'auto'
        : false;
    next();
  };
}
