export function createSessionCookieProtocolMiddleware(setting, nodeEnv) {
  return (req, _res, next) => {
    const protocol = setting('connection_protocol');
    req.session.cookie.secure = protocol === 'http' ? false : protocol === 'https' ? true : nodeEnv === 'production';
    next();
  };
}
