import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db, setSetting, setting, setupComplete } from './db.js';
import { createUser, hashPassword, normalizeUsername, publicUser, regenerateSession, validateCredentials, verifyPassword } from './auth.js';
import { ApiError, fail, newCsrfToken, requireAuth, requireAdmin } from './http.js';

export const authRouter = Router();

authRouter.get('/csrf', (req, res) => res.json({ token: newCsrfToken(req) }));

authRouter.get('/setup/status', (_req, res) => {
  res.json({ configured: setupComplete(), platformName: setting('platform_name') || '' });
});

authRouter.post('/setup', async (req, res) => {
  if (setupComplete()) fail(409, 'This platform is already configured.', 'already_configured');
  const { platformName, username, password, confirmPassword } = req.body || {};
  const name = String(platformName || '').trim();
  if (name.length < 2 || name.length > 80) fail(400, 'Platform name must be between 2 and 80 characters.', 'invalid_platform_name');
  if (password !== confirmPassword) fail(400, 'Passwords do not match.', 'password_mismatch');
  const credentialError = validateCredentials(username, password);
  if (credentialError) fail(400, credentialError, 'invalid_credentials');
  const passwordHash = await hashPassword(password);
  const userId = randomUUID();
  const configure = db.transaction(() => {
    if (setupComplete()) throw new ApiError(409, 'This platform is already configured.', 'already_configured');
    if (db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get()) {
      throw new ApiError(409, 'An administrator already exists. Use the sign-in page.', 'already_configured');
    }
    db.prepare('INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(userId, normalizeUsername(username), passwordHash, 'admin');
    setSetting('platform_name', name);
    setSetting('setup_complete', '1');
  });
  configure();
  await regenerateSession(req, userId);
  res.status(201).json({ user: publicUser(db.prepare('SELECT id, username, role, disabled FROM users WHERE id = ?').get(userId)), platformName: name });
});

authRouter.post('/auth/register', async (req, res) => {
  if (!setupComplete()) fail(409, 'Complete platform setup before registering.', 'setup_required');
  const { username, password, confirmPassword } = req.body || {};
  if (password !== confirmPassword) fail(400, 'Passwords do not match.', 'password_mismatch');
  const credentialError = validateCredentials(username, password);
  if (credentialError) fail(400, credentialError, 'invalid_credentials');
  const normalized = normalizeUsername(username);
  if (db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(normalized)) {
    fail(409, 'That username is already in use.', 'username_taken');
  }
  const user = createUser({ username: normalized, passwordHash: await hashPassword(password), role: 'learner' });
  await regenerateSession(req, user.id);
  res.status(201).json({ user: publicUser(user) });
});

authRouter.post('/auth/login', async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || '');
  if (username.length > 32 || password.length > 256) fail(400, 'Enter a valid username and password.', 'invalid_credentials');
  const user = db.prepare('SELECT id, username, password_hash, role, disabled FROM users WHERE username = ? COLLATE NOCASE').get(username);
  const valid = user && !user.disabled && await verifyPassword(password, user.password_hash);
  if (!valid) fail(401, 'The username or password is incorrect.', 'login_failed');
  await regenerateSession(req, user.id);
  res.json({ user: publicUser(user), platformName: setting('platform_name') || '' });
});

authRouter.post('/auth/logout', requireAuth, async (req, res, next) => {
  req.session.destroy((error) => error ? next(error) : res.status(204).end());
});

authRouter.get('/auth/me', (req, res) => {
  res.json({ user: publicUser(req.currentUser), platformName: setting('platform_name') || '' });
});

authRouter.put('/auth/password', requireAuth, async (req, res) => {
  const { currentPassword, password, confirmPassword } = req.body || {};
  if (password !== confirmPassword) fail(400, 'Passwords do not match.', 'password_mismatch');
  const credentialError = validateCredentials(req.currentUser.username, password);
  if (credentialError && !credentialError.startsWith('Username')) fail(400, credentialError, 'invalid_password');
  const user = db.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(req.currentUser.id);
  if (!await verifyPassword(String(currentPassword || ''), user.password_hash)) fail(400, 'Your current password is incorrect.', 'password_incorrect');
  db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(await hashPassword(password), req.currentUser.id);
  res.status(204).end();
});

authRouter.get('/admin/settings', requireAdmin, (_req, res) => {
  res.json({ platformName: setting('platform_name') || '' });
});

authRouter.put('/admin/settings', requireAdmin, (req, res) => {
  const platformName = String(req.body?.platformName || '').trim();
  if (platformName.length < 2 || platformName.length > 80) fail(400, 'Platform name must be between 2 and 80 characters.', 'invalid_platform_name');
  setSetting('platform_name', platformName);
  res.json({ platformName });
});

export function authRateLimitError() {
  return new ApiError(429, 'Too many attempts. Wait a little and try again.', 'rate_limited');
}
