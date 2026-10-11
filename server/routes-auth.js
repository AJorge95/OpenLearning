import { Router } from 'express';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { db, setSetting, setting, setupComplete } from './db.js';
import { createUser, hashPassword, normalizeEmail, normalizeUsername, publicUser, regenerateSession, validateCredentials, validateEmail, validatePassword, verifyLoginPassword, verifyPassword } from './auth.js';
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

async function establishCreatedAccountSession(req, userId, { event, code, message }) {
  try {
    await regenerateSession(req, userId);
  } catch (error) {
    writeSystemLog('error', 'auth', event, {
      userId,
      errorName: String(error?.name || 'Error').slice(0, 100),
      ...(typeof error?.code === 'string' ? { errorCode: error.code.slice(0, 100) } : {}),
    });
    fail(503, message, code);
  }
}

const defaultPalette = 'violet';
const paletteIds = new Set(['violet', 'ocean', 'forest', 'rose', 'amber']);
const maxBrandIconBytes = 512 * 1024;
const maxBrandIconDimension = 1024;
const maxUserLimit = 1_000_000;
const brandIconPngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const brandIconJpegStart = Buffer.from([0xff, 0xd8, 0xff]);
const brandIconJpegEnd = Buffer.from([0xff, 0xd9]);
const brandIconJpegFrameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

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

function platformIconDimensions(type, bytes) {
  if (type === 'png') {
    if (bytes.length < 45
      || !bytes.subarray(0, brandIconPngSignature.length).equals(brandIconPngSignature)
      || bytes.readUInt32BE(8) !== 13
      || bytes.toString('ascii', 12, 16) !== 'IHDR'
      || bytes.readUInt32BE(16) === 0
      || bytes.readUInt32BE(20) === 0) return null;
    const trailer = bytes.subarray(bytes.length - 12);
    if (trailer.readUInt32BE(0) !== 0 || trailer.toString('ascii', 4, 8) !== 'IEND') return null;
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (type === 'jpeg') {
    if (bytes.length < 5 || !bytes.subarray(0, 3).equals(brandIconJpegStart)
      || bytes.lastIndexOf(brandIconJpegEnd) < Math.max(0, bytes.length - 4096)) return null;
    let offset = 2;
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      while (bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.length) return null;
      const marker = bytes[offset++];
      if (marker === 0x00 || marker === 0xd9 || marker === 0xda) return null;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
      if (offset + 2 > bytes.length) return null;
      const segmentLength = bytes.readUInt16BE(offset);
      if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
      if (brandIconJpegFrameMarkers.has(marker)) {
        if (segmentLength < 8) return null;
        const componentCount = bytes[offset + 7];
        if (componentCount < 1 || segmentLength < 8 + componentCount * 3) return null;
        const height = bytes.readUInt16BE(offset + 3);
        const width = bytes.readUInt16BE(offset + 5);
        return width > 0 && height > 0 ? { width, height } : null;
      }
      offset += segmentLength;
    }
    return null;
  }
  if (type === 'webp') {
    if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'RIFF'
      || bytes.toString('ascii', 8, 12) !== 'WEBP') return null;
    const riffSize = bytes.readUInt32LE(4);
    const riffEnd = riffSize + 8;
    const firstChunkType = bytes.toString('ascii', 12, 16);
    const firstChunkSize = bytes.readUInt32LE(16);
    const paddedChunkSize = firstChunkSize + (firstChunkSize % 2);
    if (!(riffSize >= 12 && riffSize % 2 === 0 && riffEnd <= bytes.length
      && ['VP8 ', 'VP8L', 'VP8X'].includes(firstChunkType)
      && firstChunkSize > 0
      && (firstChunkType !== 'VP8X' || firstChunkSize === 10)
      && 20 + paddedChunkSize <= riffEnd)) return null;
    if (firstChunkType === 'VP8X') {
      return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
    }
    if (firstChunkType === 'VP8L') {
      if (firstChunkSize < 5 || bytes[20] !== 0x2f) return null;
      const width = 1 + (((bytes[22] & 0x3f) << 8) | bytes[21]);
      const height = 1 + (((bytes[24] & 0x0f) << 10) | (bytes[23] << 2) | ((bytes[22] & 0xc0) >> 6));
      return { width, height };
    }
    if (firstChunkSize < 10 || bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    const width = bytes.readUInt16LE(26) & 0x3fff;
    const height = bytes.readUInt16LE(28) & 0x3fff;
    return width > 0 && height > 0 ? { width, height } : null;
  }
  return null;
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
  const dimensions = platformIconDimensions(match[1], bytes);
  if (!dimensions) {
    fail(400, 'The selected file does not match a supported image format.', 'invalid_platform_icon');
  }
  if (dimensions.width > maxBrandIconDimension || dimensions.height > maxBrandIconDimension) {
    fail(400, 'The platform icon dimensions must be 1024 × 1024 pixels or smaller.', 'invalid_platform_icon');
  }
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
  const configured = setupComplete();
  res.json({ configured, setupAvailable: !configured && Boolean(config.setupToken), ...getPlatformConfiguration() });
});

authRouter.get('/registration-fields', (_req, res) => {
  res.json({ fields: setting('registration_enabled') === '0' ? [] : getRegistrationFields() });
});

function setupTokenMatches(value) {
  if (!config.setupToken || typeof value !== 'string' || value.length > 256) return false;
  const expected = createHash('sha256').update(config.setupToken, 'utf8').digest();
  const provided = createHash('sha256').update(value, 'utf8').digest();
  return timingSafeEqual(expected, provided);
}

function registrationConflict() {
  fail(409, 'An account with those details could not be registered.', 'registration_conflict');
}

function isUserIdentifierUniqueConstraint(error) {
  return error?.code === 'SQLITE_CONSTRAINT_UNIQUE'
    && /users\.(?:username|email)/i.test(String(error.message || ''));
}

authRouter.post('/setup', async (req, res) => {
  if (setupComplete()) fail(409, 'This platform is already configured.', 'already_configured');
  if (!config.setupToken) fail(503, 'Initial setup is unavailable because no bootstrap credential is configured.', 'setup_credential_unavailable');
  if (!setupTokenMatches(req.body?.setupToken)) fail(403, 'The bootstrap credential is invalid.', 'invalid_setup_token');
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
  await establishCreatedAccountSession(req, userId, {
    event: 'Initial setup completed, but administrator sign-in could not be established',
    code: 'setup_session_unavailable',
    message: 'Platform setup completed, but automatic sign-in failed. Reload the page and sign in with the administrator account you created.',
  });
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
  let user;
  try {
    user = db.transaction(() => {
      assertRegistrationAvailable();
      if (db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE LIMIT 1').get(normalized, email)) {
        registrationConflict();
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
  } catch (error) {
    if (isUserIdentifierUniqueConstraint(error)) registrationConflict();
    throw error;
  }
  await establishCreatedAccountSession(req, user.id, {
    event: 'Account registration completed, but learner sign-in could not be established',
    code: 'registration_session_unavailable',
    message: 'Your account was created, but automatic sign-in failed. Go to the sign-in page and use the credentials you just registered.',
  });
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

authRouter.post('/auth/logout', requireAuth, async (req, res) => {
  const user = req.currentUser;
  await destroySession(req);
  writeAuditLog({ actor: user, action: 'auth.signed_out', entityType: 'user', entityId: user.id, summary: `${user.username} signed out` });
  res.status(204).end();
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
  const passwordError = validatePassword(password);
  if (passwordError) fail(400, passwordError, 'invalid_password');
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
