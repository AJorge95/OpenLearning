import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { db, setSetting, setting, setupComplete } from './db.js';
import { createUser, hashPassword, normalizeEmail, normalizeUsername, publicUser, regenerateSession, validateCredentials, validateEmail, verifyLoginPassword, verifyPassword } from './auth.js';
import { ApiError, fail, newCsrfToken, requireAuth, requireAdmin } from './http.js';
import { invalidateUserSessions } from './session-store.js';
import { writeAuditLog, writeSystemLog } from './log-store.js';
import { passwordChangeLimiter } from './rate-limits.js';
import { getRegistrationFields, normalizeRegistrationFieldValues, saveUserRegistrationFieldValues } from './registration-fields.js';
import { accountNames } from './account-names.js';
import { issueCompletedCertificatesForUser } from './certificate-service.js';

export const authRouter = Router();

function recordLastLogin(userId) {
  db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
}

function destroySession(req) {
  return new Promise((resolve, reject) => req.session.destroy((error) => error ? reject(error) : resolve()));
}

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

function getPlatformConfiguration(registeredCount) {
  const protocol = setting('connection_protocol');
  return {
    ...getBranding(),
    connectionProtocol: protocol === 'http' || protocol === 'https' ? protocol : defaultConnectionProtocol(),
    registrationEnabled: setting('registration_enabled') !== '0',
    registrationAvailable: registrationAvailable(registeredCount),
    userLimit: getUserLimit(),
  };
}

function parsePlatformName(value) {
  if (typeof value !== 'string') {
    fail(400, 'Platform name must be between 2 and 80 characters.', 'invalid_platform_name');
  }
  const name = value.trim();
  if (name.length < 2 || name.length > 80) {
    fail(400, 'Platform name must be between 2 and 80 characters.', 'invalid_platform_name');
  }
  return name;
}

function registeredUserCount() {
  return db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
}

function registrationAvailable(registeredCount) {
  if (setting('registration_enabled') === '0') return false;
  const userLimit = getUserLimit();
  return userLimit === 0 || (registeredCount ?? registeredUserCount()) < userLimit;
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

authRouter.get('/registration-fields', (_req, res) => {
  res.json({ fields: setting('registration_enabled') === '0' ? [] : getRegistrationFields() });
});

authRouter.post('/setup', async (req, res) => {
  if (setupComplete()) fail(409, 'This platform is already configured.', 'already_configured');
  const { platformName, username, password, confirmPassword } = req.body || {};
  const { firstName, lastName } = accountNames(req.body);
  const email = normalizeEmail(req.body?.email);
  const name = parsePlatformName(platformName);
  const emailError = validateEmail(email);
  if (emailError) fail(400, emailError, 'invalid_email');
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
    if (db.prepare('SELECT 1 FROM users WHERE email = ? COLLATE NOCASE').get(email)) {
      fail(409, 'That email address is already in use.', 'email_taken');
    }
    db.prepare('INSERT INTO users (id, username, email, first_name, last_name, password_hash, role) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(userId, normalizeUsername(username), email, firstName, lastName, passwordHash, 'admin');
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
    recordLastLogin(userId);
    const auditId = writeAuditLog({ actor: { id: userId, username: normalizeUsername(username) }, action: 'platform.setup', entityType: 'platform',
      summary: 'Initial platform setup completed', details: { platformName: name, themePalette, connectionProtocol, registrationEnabled, userLimit } });
    if (!auditId) fail(500, 'Platform setup could not be completed because the audit log is unavailable.', 'audit_unavailable');
  });
  configure.immediate();
  await regenerateSession(req, userId);
  writeSystemLog('info', 'setup', 'Initial platform setup completed');
  res.status(201).json({ user: publicUser(db.prepare('SELECT id, username, email, first_name, last_name, role, disabled FROM users WHERE id = ?').get(userId)), ...getPlatformConfiguration() });
});

authRouter.post('/auth/register', async (req, res) => {
  if (!setupComplete()) fail(409, 'Complete platform setup before registering.', 'setup_required');
  assertRegistrationAvailable();
  const { username, password, confirmPassword } = req.body || {};
  const { firstName, lastName } = accountNames(req.body);
  const email = normalizeEmail(req.body?.email);
  const emailError = validateEmail(email);
  if (emailError) fail(400, emailError, 'invalid_email');
  if (password !== confirmPassword) fail(400, 'Passwords do not match.', 'password_mismatch');
  const credentialError = validateCredentials(username, password);
  if (credentialError) fail(400, credentialError, 'invalid_credentials');
  const normalized = normalizeUsername(username);
  const submittedRegistrationFieldValues = req.body?.registrationFieldValues;
  normalizeRegistrationFieldValues(submittedRegistrationFieldValues, getRegistrationFields());
  const passwordHash = await hashPassword(password);
  const user = db.transaction(() => {
    assertRegistrationAvailable();
    if (db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(normalized)) {
      fail(409, 'That username is already in use.', 'username_taken');
    }
    if (db.prepare('SELECT 1 FROM users WHERE email = ? COLLATE NOCASE').get(email)) {
      fail(409, 'That email address is already in use.', 'email_taken');
    }
    const fields = getRegistrationFields();
    const answers = normalizeRegistrationFieldValues(submittedRegistrationFieldValues, fields);
    const createdUser = createUser({ username: normalized, email, firstName, lastName, passwordHash, role: 'learner' });
    saveUserRegistrationFieldValues(createdUser.id, answers);
    recordLastLogin(createdUser.id);
    const auditId = writeAuditLog({ actor: createdUser, action: 'account.registered', entityType: 'user', entityId: createdUser.id,
      summary: `Learner account created: ${createdUser.username}` });
    if (!auditId) fail(500, 'Account could not be created because the audit log is unavailable.', 'audit_unavailable');
    return createdUser;
  }).immediate();
  await regenerateSession(req, user.id);
  res.status(201).json({ user: publicUser(user), registrationAvailable: registrationAvailable() });
});

authRouter.post('/auth/login', async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (username.length > 32 || password.length > 256) fail(400, 'Enter a valid username and password.', 'invalid_credentials');
  const user = db.prepare('SELECT id, username, email, first_name, last_name, password_hash, role, disabled FROM users WHERE username = ? COLLATE NOCASE').get(username);
  const valid = await verifyLoginPassword(password, user);
  if (!valid) {
    writeSystemLog('warn', 'auth', 'Sign-in attempt failed');
    fail(401, 'The username or password is incorrect.', 'login_failed');
  }
  await regenerateSession(req, user.id);
  const completeSignIn = db.transaction(() => {
    const currentUser = db.prepare('SELECT id, username, email, first_name, last_name, password_hash, role, disabled FROM users WHERE id = ?').get(user.id);
    if (!currentUser || currentUser.disabled || currentUser.password_hash !== user.password_hash) return null;
    recordLastLogin(currentUser.id);
    const auditId = writeAuditLog({ actor: currentUser, action: 'auth.signed_in', entityType: 'user', entityId: currentUser.id, summary: `${currentUser.username} signed in` });
    if (!auditId) fail(500, 'Sign-in could not be completed because the audit log is unavailable.', 'audit_unavailable');
    return currentUser;
  });
  let currentUser;
  try {
    currentUser = completeSignIn.immediate();
  } catch (error) {
    await destroySession(req);
    throw error;
  }
  if (!currentUser) {
    await destroySession(req);
    writeSystemLog('warn', 'auth', 'Sign-in attempt failed');
    fail(401, 'The username or password is incorrect.', 'login_failed');
  }
  res.json({ user: publicUser(currentUser), ...getPlatformConfiguration() });
});

authRouter.post('/auth/logout', requireAuth, async (req, res, next) => {
  const user = req.currentUser;
  req.session.destroy((error) => {
    if (error) return next(error);
    writeAuditLog({ actor: user, action: 'auth.signed_out', entityType: 'user', entityId: user.id, summary: `${user.username} signed out` });
    res.status(204).end();
  });
});

authRouter.get('/auth/me', (req, res) => {
  res.json({ user: publicUser(req.currentUser), ...getPlatformConfiguration() });
});

authRouter.put('/auth/profile', requireAuth, (req, res) => {
  const { firstName, lastName } = accountNames(req.body);
  const updateProfile = db.transaction(() => {
    const user = db.prepare('SELECT id, username, first_name, last_name, email FROM users WHERE id = ?').get(req.currentUser.id);
    if (!user) fail(404, 'Account not found.', 'not_found');
    const changed = user.first_name !== firstName || user.last_name !== lastName;
    if (changed) {
      db.prepare('UPDATE users SET first_name = ?, last_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(firstName, lastName, user.id);
      const auditId = writeAuditLog({ actor: req.currentUser, action: 'account.profile_updated', entityType: 'user', entityId: user.id,
        summary: `${user.username} updated their profile name`, details: { firstName, lastName } });
      if (!auditId) fail(500, 'Profile could not be updated because the audit log is unavailable.', 'audit_unavailable');
    }
    return db.prepare('SELECT id, username, email, first_name, last_name, role, disabled FROM users WHERE id = ?').get(user.id);
  });
  const user = updateProfile.immediate();
  const certificates = issueCompletedCertificatesForUser(user.id);
  res.json({ user: publicUser(user), certificatesIssued: certificates.length });
});

authRouter.put('/auth/password', requireAuth, passwordChangeLimiter, async (req, res) => {
  const { currentPassword, password, confirmPassword } = req.body || {};
  if (typeof currentPassword !== 'string' || currentPassword.length === 0 || currentPassword.length > 256) {
    fail(400, 'Enter a valid current password.', 'invalid_current_password');
  }
  const currentPasswordValue = currentPassword;
  if (password !== confirmPassword) fail(400, 'Passwords do not match.', 'password_mismatch');
  const credentialError = validateCredentials(req.currentUser.username, password);
  if (credentialError && !credentialError.startsWith('Username')) fail(400, credentialError, 'invalid_password');
  const user = db.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(req.currentUser.id);
  if (!user) fail(401, 'Sign in to continue.', 'unauthorized');
  if (!await verifyPassword(currentPasswordValue, user.password_hash)) fail(400, 'Your current password is incorrect.', 'password_incorrect');
  const passwordHash = await hashPassword(password);
  const updatePassword = db.transaction(() => {
    const currentUser = db.prepare('SELECT password_hash, disabled FROM users WHERE id = ?').get(req.currentUser.id);
    if (!currentUser || currentUser.disabled) throw new ApiError(401, 'Your account is no longer active. Contact an administrator.', 'unauthorized');
    if (currentUser.password_hash !== user.password_hash) {
      throw new ApiError(409, 'Your password changed while this request was being processed. Enter the current password and try again.', 'password_changed');
    }
    db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(passwordHash, req.currentUser.id);
    invalidateUserSessions(db, req.currentUser.id, req.sessionID);
    const auditId = writeAuditLog({ actor: req.currentUser, action: 'account.password_changed', entityType: 'user', entityId: req.currentUser.id,
      summary: `${req.currentUser.username} changed their password` });
    if (!auditId) fail(500, 'Password could not be changed because the audit log is unavailable.', 'audit_unavailable');
  });
  updatePassword.immediate();
  res.status(204).end();
});

authRouter.get('/admin/settings', requireAdmin, (_req, res) => {
  const userCount = registeredUserCount();
  res.json({ ...getPlatformConfiguration(userCount), registeredUserCount: userCount });
});

authRouter.put('/admin/settings', requireAdmin, (req, res) => {
  const platformName = parsePlatformName(req.body?.platformName);
  const themePalette = req.body?.themePalette === undefined
    ? (paletteIds.has(setting('theme_palette')) ? setting('theme_palette') : defaultPalette)
    : parsePalette(req.body.themePalette);
  const savedProtocol = setting('connection_protocol');
  const connectionProtocol = req.body?.connectionProtocol === undefined
    ? (savedProtocol === 'http' || savedProtocol === 'https' ? savedProtocol : defaultConnectionProtocol())
    : parseConnectionProtocol(req.body.connectionProtocol);
  const registrationEnabled = req.body?.registrationEnabled === undefined
    ? setting('registration_enabled') !== '0'
    : parseRegistrationEnabled(req.body.registrationEnabled);
  const userLimit = req.body?.userLimit === undefined ? getUserLimit() : parseUserLimit(req.body.userLimit);
  const platformIcon = Object.hasOwn(req.body || {}, 'platformIcon') ? parsePlatformIcon(req.body.platformIcon) : undefined;
  const update = db.transaction(() => {
    const changedFields = [];
    const updateSetting = (key, value, field) => {
      if (setting(key) === String(value)) return;
      setSetting(key, value);
      changedFields.push(field);
    };
    updateSetting('platform_name', platformName, 'platformName');
    updateSetting('theme_palette', themePalette, 'themePalette');
    updateSetting('connection_protocol', connectionProtocol, 'connectionProtocol');
    updateSetting('registration_enabled', registrationEnabled ? '1' : '0', 'registrationEnabled');
    updateSetting('user_limit', userLimit, 'userLimit');
    if (platformIcon !== undefined && setting('platform_icon') !== platformIcon) {
      changedFields.push('platformIcon');
      if (platformIcon) {
        setSetting('platform_icon', platformIcon);
        setSetting('platform_icon_version', randomUUID());
      } else {
        db.prepare("DELETE FROM app_settings WHERE key IN ('platform_icon', 'platform_icon_version')").run();
      }
    }
    if (changedFields.length) {
      const auditId = writeAuditLog({ actor: req.currentUser, action: 'platform.settings_updated', entityType: 'platform', summary: 'Platform settings updated',
        details: { changedFields, platformName, themePalette, connectionProtocol, registrationEnabled, userLimit, platformIconChanged: changedFields.includes('platformIcon') } });
      if (!auditId) fail(500, 'Platform settings could not be saved because the audit log is unavailable.', 'audit_unavailable');
    }
    return changedFields;
  });
  const changedFields = update.immediate();
  const userCount = registeredUserCount();
  res.json({ ...getPlatformConfiguration(userCount), registeredUserCount: userCount });
});

export function authRateLimitError() {
  return new ApiError(429, 'Too many attempts. Wait a little and try again.', 'rate_limited');
}
