export function mountAuthenticationRateLimits(app, loginLimiter, authLimiter) {
  app.post('/api/auth/login', loginLimiter);
  app.post('/api/auth/register', authLimiter);
  app.post('/api/setup', authLimiter);
}
