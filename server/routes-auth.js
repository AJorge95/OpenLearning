import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { db, setSetting, setting, setupComplete } from './db.js';
import { createUser, hashPassword, normalizeUsername, publicUser, regenerateSession, validateCredentials, verifyPassword } from './auth.js';
import { ApiError, fail, newCsrfToken, requireAuth, requireAdmin } from './http.js';

export const authRouter = Router();

const defaultPalette = 'violet';
const paletteIds = new Set(['violet', 'ocean', 'forest', 'rose', 'amber']);
const maxBrandIconBytes = 512 * 1024;
const maxUserLimit = 1_000_000;

function defaultConnectionProtocol() {
  return config.nodeEnv === 'production' ? 'https' : 'http';
}

function getBranding() {
  const palette = setting('theme_palette');
  const iconVersion = setting('platform_icon_version');
  return {
    platformName: setting('platform_name') || '',
    platformIcon: iconVersion ? `/api/branding/icon?v=${encodeURIComponent(iconVersion)}` : null,
    themePalette: paletteIds.has(palette) ? palette : defaultPalette,
  };
}

function getUserLimit() {
  const value = Number(setting('user_limit') ?? 0);
  return Number.isSafeInteger(value) && value >= 0 && value <= maxUserLimit ? value : 0;
}

function getPlatformConfiguration() {
  const protocol = setting('connection_protocol');
  return {
    ...getBranding(),
    connectionProtocol: protocol === 'http' || protocol === 'https' ? protocol : defaultConnectionProtocol(),
    registrationEnabled: setting('registration_enabled') !== '0',
    registrationAvailable: registrationAvailable(),
    userLimit: getUserLimit(),
  };
}

function registeredUserCount() {
  return db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
}

function registrationAvailable() {
  if (setting('registration_enabled') === '0') return false;
  const userLimit = getUserLimit();
  return userLimit === 0 || registeredUserCount() < userLimit;
}

function assertRegistrationAvailable() {
  if (setting('registration_enabled') === '0') {
    fail(403, 'New account registration is disabled by an administrator.', 'registration_disabled');
  }
  const userLimit = getUserLimit();
  if (userLimit > 0 && registeredUserCount() >= userLimit) {
    fail(403, 'The platform has reached its registered-user limit.', 'user_limit_reached');
  }
}

function parsePalette(value) {
  if (typeof value !== 'string' || !paletteIds.has(value)) {
    fail(400, 'Choose one of the available color palettes.', 'invalid_palette');
  }
  return value;
}

function parseConnectionProtocol(value) {
  if (value !== 'http' && value !== 'https') {
    fail(400, 'Choose HTTP or HTTPS for the public connection protocol.', 'invalid_connection_protocol');
  }
  return value;
}

function parseRegistrationEnabled(value) {
  if (typeof value !== 'boolean') fail(400, 'Choose whether new registrations are enabled.', 'invalid_registration_setting');
  return value;
}

function parseUserLimit(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maxUserLimit) {
    fail(400, `The registered-user limit must be between 0 and ${maxUserLimit}.`, 'invalid_user_limit');
  }
  return value;
}

function parsePlatformIcon(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > Math.ceil(maxBrandIconBytes * 4 / 3) + 64) {
    fail(400, 'The platform icon must be 512 KB or smaller.', 'invalid_platform_icon');
  }
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) fail(400, 'Upload a PNG, JPG, or WebP image for the platform icon.', 'invalid_platform_icon');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length === 0 || bytes.length > maxBrandIconBytes || bytes.toString('base64') !== match[2]) {
    fail(400, 'The platform icon must be a valid image no larger than 512 KB.', 'invalid_platform_icon');
  }
  const isPng = match[1] === 'png' && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = match[1] === 'jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
  const isWebp = match[1] === 'webp' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!isPng && !isJpeg && !isWebp) fail(400, 'The selected file does not match a supported image format.', 'invalid_platform_icon');
  return value;
}

authRouter.get('/csrf', (req, res) => res.json({ token: newCsrfToken(req) }));

authRouter.get('/branding/icon', (_req, res) => {
  const storedIcon = setting('platform_icon');
  const match = storedIcon && /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(storedIcon);
  if (!match) return res.status(404).end();
  const mimeType = match[1] === 'jpeg' ? 'image/jpeg' : `image/${match[1]}`;
  res.set('Cache-Control', 'public, max-age=31536000, immutable').type(mimeType).send(Buffer.from(match[2], 'base64'));
});

authRouter.get('/setup/status', (_req, res) => {
  res.json({ configured: setupComplete(), ...getPlatformConfiguration() });
});

authRouter.post('/setup', async (req, res) => {
  if (setupComplete()) fail(409, 'This platform is already configured.', 'already_configured');
  const { platformName, username, password, confirmPassword } = req.body || {};
  const name = String(platformName || '').trim();
  if (name.length < 2 || name.length > 80) fail(400, 'Platform name must be between 2 and 80 characters.', 'invalid_platform_name');
  if (password !== confirmPassword) fail(400, 'Passwords do not match.', 'password_mismatch');
  const credentialError = validateCredentials(username, password);
  if (credentialError) fail(400, credentialError, 'invalid_credentials');
  const themePalette = req.body?.themePalette === undefined ? defaultPalette : parsePalette(req.body.themePalette);
  const platformIcon = parsePlatformIcon(req.body?.platformIcon ?? null);
  const connectionProtocol = req.body?.connectionProtocol === undefined ? defaultConnectionProtocol() : parseConnectionProtocol(req.body.connectionProtocol);
  const registrationEnabled = req.body?.registrationEnabled === undefined ? true : parseRegistrationEnabled(req.body.registrationEnabled);
  const userLimit = req.body?.userLimit === undefined ? 0 : parseUserLimit(req.body.userLimit);
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
    setSetting('theme_palette', themePalette);
    setSetting('connection_protocol', connectionProtocol);
    setSetting('registration_enabled', registrationEnabled ? '1' : '0');
    setSetting('user_limit', userLimit);
    if (platformIcon) {
      setSetting('platform_icon', platformIcon);
      setSetting('platform_icon_version', randomUUID());
    }
    setSetting('setup_complete', '1');
  });
  configure();
  await regenerateSession(req, userId);
  res.status(201).json({ user: publicUser(db.prepare('SELECT id, username, role, disabled FROM users WHERE id = ?').get(userId)), ...getPlatformConfiguration() });
});

authRouter.post('/auth/register', async (req, res) => {
  if (!setupComplete()) fail(409, 'Complete platform setup before registering.', 'setup_required');
  assertRegistrationAvailable();
  const { username, password, confirmPassword } = req.body || {};
  if (password !== confirmPassword) fail(400, 'Passwords do not match.', 'password_mismatch');
  const credentialError = validateCredentials(username, password);
  if (credentialError) fail(400, credentialError, 'invalid_credentials');
  const normalized = normalizeUsername(username);
  const passwordHash = await hashPassword(password);
  const user = db.transaction(() => {
    assertRegistrationAvailable();
    if (db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(normalized)) {
      fail(409, 'That username is already in use.', 'username_taken');
    }
    return createUser({ username: normalized, passwordHash, role: 'learner' });
  })();
  await regenerateSession(req, user.id);
  res.status(201).json({ user: publicUser(user), registrationAvailable: registrationAvailable() });
});

authRouter.post('/auth/login', async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || '');
  if (username.length > 32 || password.length > 256) fail(400, 'Enter a valid username and password.', 'invalid_credentials');
  const user = db.prepare('SELECT id, username, password_hash, role, disabled FROM users WHERE username = ? COLLATE NOCASE').get(username);
  const valid = user && !user.disabled && await verifyPassword(password, user.password_hash);
  if (!valid) fail(401, 'The username or password is incorrect.', 'login_failed');
  await regenerateSession(req, user.id);
  res.json({ user: publicUser(user), ...getPlatformConfiguration() });
});

authRouter.post('/auth/logout', requireAuth, async (req, res, next) => {
  req.session.destroy((error) => error ? next(error) : res.status(204).end());
});

authRouter.get('/auth/me', (req, res) => {
  res.json({ user: publicUser(req.currentUser), ...getPlatformConfiguration() });
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
  res.json({ ...getPlatformConfiguration(), registeredUserCount: registeredUserCount() });
});

authRouter.put('/admin/settings', requireAdmin, (req, res) => {
  const platformName = String(req.body?.platformName || '').trim();
  if (platformName.length < 2 || platformName.length > 80) fail(400, 'Platform name must be between 2 and 80 characters.', 'invalid_platform_name');
  const themePalette = req.body?.themePalette === undefined
    ? (paletteIds.has(setting('theme_palette')) ? setting('theme_palette') : defaultPalette)
    : parsePalette(req.body.themePalette);
  const connectionProtocol = req.body?.connectionProtocol === undefined ? getPlatformConfiguration().connectionProtocol : parseConnectionProtocol(req.body.connectionProtocol);
  const registrationEnabled = req.body?.registrationEnabled === undefined
    ? getPlatformConfiguration().registrationEnabled
    : parseRegistrationEnabled(req.body.registrationEnabled);
  const userLimit = req.body?.userLimit === undefined ? getUserLimit() : parseUserLimit(req.body.userLimit);
  const platformIcon = Object.hasOwn(req.body || {}, 'platformIcon') ? parsePlatformIcon(req.body.platformIcon) : undefined;
  const update = db.transaction(() => {
    setSetting('platform_name', platformName);
    setSetting('theme_palette', themePalette);
    setSetting('connection_protocol', connectionProtocol);
    setSetting('registration_enabled', registrationEnabled ? '1' : '0');
    setSetting('user_limit', userLimit);
    if (platformIcon !== undefined) {
      if (platformIcon) {
        setSetting('platform_icon', platformIcon);
        setSetting('platform_icon_version', randomUUID());
      } else {
        db.prepare("DELETE FROM app_settings WHERE key IN ('platform_icon', 'platform_icon_version')").run();
      }
    }
  });
  update();
  res.json({ ...getPlatformConfiguration(), registeredUserCount: registeredUserCount() });
});

export function authRateLimitError() {
  return new ApiError(429, 'Too many attempts. Wait a little and try again.', 'rate_limited');
}
