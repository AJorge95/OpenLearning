import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db, setting } from './db.js';
import { hashPassword, normalizeEmail, validateCredentials, validateEmail, validatePassword } from './auth.js';
import { enumQuery, fail, pageQuery, requireAdmin, requireObjectBody } from './http.js';
import { invalidateUserSessions } from './session-store.js';
import { textSearchPredicate } from './sql.js';
import { writeAuditLog, writeSystemLog } from './log-store.js';
import { accountName, accountNames } from './account-names.js';
import { issueCompletedCertificatesForUser } from './certificate-service.js';
import { courseSummaries } from './course-service.js';
import { normalizeRegistrationFields, readRegistrationFields, saveRegistrationFields } from './registration-fields.js';
import { adminPasswordResetLimiter } from './rate-limits.js';
import { cancelPlatformReset, confirmPlatformReset, finishPlatformReset, getPlatformResetStatus, preparePlatformReset } from './platform-reset.js';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

function destroyCurrentSession(req) {
  return new Promise((resolve, reject) => req.session.destroy((error) => error ? reject(error) : resolve()));
}

adminRouter.get('/platform-reset', (req, res) => {
  res.json(getPlatformResetStatus(req.currentUser.id));
});

adminRouter.post('/platform-reset/prepare', async (req, res) => {
  try {
    res.json(await preparePlatformReset(req.currentUser));
  } catch (error) {
    if (error?.status) throw error;
    writeSystemLog('error', 'platform-reset', 'Could not create the pre-reset backup', {
      actorId: req.currentUser.id,
      errorName: String(error?.name || 'Error').slice(0, 100),
      errorCode: typeof error?.code === 'string' ? error.code.slice(0, 100) : undefined,
    });
    fail(500, 'The backup could not be completed, so the platform was not reset. Check the system log and available disk space.', 'platform_reset_backup_failed');
  }
});

adminRouter.post('/platform-reset/cancel', (req, res) => {
  const result = cancelPlatformReset(req.currentUser, req.body?.confirmationId);
  res.json(result);
});

adminRouter.post('/platform-reset/confirm', async (req, res) => {
  const result = await confirmPlatformReset(req.currentUser, req.body?.confirmationId, req.body?.confirmationPhrase);
  try {
    await destroyCurrentSession(req);
  } catch (error) {
    writeSystemLog('warn', 'platform-reset', 'Session cleanup after the platform reset reported an error', {
      actorId: req.currentUser.id,
      errorName: String(error?.name || 'Error').slice(0, 100),
      errorCode: typeof error?.code === 'string' ? error.code.slice(0, 100) : undefined,
    });
  } finally {
    finishPlatformReset();
  }
  res.json(result);
});

function textQuery(value, label, maxLength) {
  if (value === undefined) return '';
  if (typeof value !== 'string') fail(400, `${label} must be a single text value.`, 'validation_error');
  return value.trim().slice(0, maxLength);
}

function logPage(query) {
  return pageQuery(query.page, 200);
}

function parseLogDetails(value) {
  try {
    const details = JSON.parse(value);
    return details && typeof details === 'object' && !Array.isArray(details) ? details : {};
  } catch { return {}; }
}

adminRouter.get('/registration-fields', (_req, res) => {
  res.json(readRegistrationFields());
});

adminRouter.put('/registration-fields', (req, res) => {
  const fields = db.transaction(() => {
    const nextFields = normalizeRegistrationFields(req.body?.fields);
    const current = readRegistrationFields();
    if (current.configurationValid && JSON.stringify(current.fields) === JSON.stringify(nextFields)) return nextFields;
    const savedFields = saveRegistrationFields(nextFields);
    const auditId = writeAuditLog({ actor: req.currentUser, action: 'platform.registration_fields_updated', entityType: 'platform',
      summary: 'Registration fields updated', details: { fieldCount: savedFields.length, fieldTypes: savedFields.map((field) => field.type) } });
    if (!auditId) fail(500, 'Registration fields could not be saved because the audit log is unavailable.', 'audit_unavailable');
    return savedFields;
  }).immediate();
  res.json({ fields });
});

function assertAccountCapacity() {
  const limit = Number(setting('user_limit') || 0);
  if (limit > 0 && db.prepare('SELECT COUNT(*) AS count FROM users').get().count >= limit) {
    fail(409, 'The registered-account limit has been reached. Increase the account limit before creating another account.', 'user_limit_reached');
  }
}

adminRouter.get('/audit-logs', (req, res) => {
  const query = textQuery(req.query.q, 'Search', 100);
  const action = textQuery(req.query.action, 'Action filter', 80);
  const requestedPage = logPage(req.query);
  const pageSize = 50;
  const clauses = [];
  const params = [];
  if (query) {
    const search = textSearchPredicate(['actor_username', 'action', 'entity_type', 'summary', 'details_json'], query);
    clauses.push(`(${search.sql})`);
    params.push(...search.params);
  }
  if (action) { clauses.push('action = ?'); params.push(action); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS count FROM audit_logs ${where}`).get(...params).count;
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));
  const entries = db.prepare(`SELECT id, occurred_at, actor_username, action, entity_type, entity_id, summary, details_json
    FROM audit_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize);
  const actions = db.prepare('SELECT action, COUNT(*) AS count FROM audit_logs GROUP BY action ORDER BY action').all();
  res.json({ entries: entries.map((entry) => ({
    id: entry.id,
    occurredAt: entry.occurred_at,
    actorUsername: entry.actor_username,
    action: entry.action,
    entityType: entry.entity_type,
    entityId: entry.entity_id,
    summary: entry.summary,
    details: parseLogDetails(entry.details_json),
  })), actions, total, page, pageSize });
});

adminRouter.get('/system-logs', (req, res) => {
  const query = textQuery(req.query.q, 'Search', 100);
  const level = enumQuery(req.query.level, 'log level', ['all', 'info', 'warn', 'error']);
  const requestedPage = logPage(req.query);
  const pageSize = 50;
  const clauses = [];
  const params = [];
  if (query) {
    const search = textSearchPredicate(['source', 'message', 'details_json'], query);
    clauses.push(`(${search.sql})`);
    params.push(...search.params);
  }
  if (level !== 'all') { clauses.push('level = ?'); params.push(level); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS count FROM system_logs ${where}`).get(...params).count;
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));
  const entries = db.prepare(`SELECT id, occurred_at, level, source, message, details_json
    FROM system_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize);
  res.json({ entries: entries.map((entry) => ({
    id: entry.id,
    occurredAt: entry.occurred_at,
    level: entry.level,
    source: entry.source,
    message: entry.message,
    details: parseLogDetails(entry.details_json),
  })), total, page, pageSize });
});

adminRouter.get('/users', (req, res) => {
  const query = textQuery(req.query.q, 'Search', 100);
  const role = enumQuery(req.query.role, 'role', ['all', 'admin', 'moderator', 'learner']);
  const clauses = [];
  const params = [];
  if (role !== 'all') { clauses.push('role = ?'); params.push(role); }
  if (query) {
    const search = textSearchPredicate(['username', 'email'], query);
    clauses.push(`(${search.sql})`);
    params.push(...search.params);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const orderBy = role === 'all'
    ? "CASE role WHEN 'admin' THEN 1 WHEN 'moderator' THEN 2 ELSE 3 END, username COLLATE NOCASE"
    : 'username COLLATE NOCASE';
  const total = db.prepare(`SELECT COUNT(*) AS count FROM users ${where}`).get(...params).count;
  const requestedPage = pageQuery(req.query.page);
  const pageSize = 50;
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));
  const users = db.prepare(`SELECT id, username, email, role, disabled, created_at FROM users
    ${where}
    ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize);
  res.json({ users: users.map((user) => ({
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    disabled: Boolean(user.disabled),
    createdAt: user.created_at,
    isCurrentUser: user.id === req.currentUser.id,
  })), total, page, pageSize });
});

adminRouter.post('/users', async (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const email = normalizeEmail(req.body?.email);
  const { firstName, lastName } = accountNames(req.body);
  const { password, confirmPassword } = req.body || {};
  const role = req.body?.role === undefined ? 'learner' : req.body.role;
  const credentialError = validateCredentials(username, password);
  if (credentialError) fail(400, credentialError, 'invalid_credentials');
  const emailError = validateEmail(email);
  if (emailError) fail(400, emailError, 'invalid_email');
  if (password !== confirmPassword) fail(400, 'Passwords do not match.', 'password_mismatch');
  if (!['admin', 'moderator', 'learner'].includes(role)) fail(400, 'Choose a valid role.', 'validation_error');
  assertAccountCapacity();
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) fail(409, 'That username is already in use.', 'username_taken');
  if (db.prepare('SELECT 1 FROM users WHERE email = ? COLLATE NOCASE').get(email)) fail(409, 'That email address is already in use.', 'email_taken');
  const passwordHash = await hashPassword(password);
  const id = randomUUID();
  const createAccount = db.transaction(() => {
    assertAccountCapacity();
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) fail(409, 'That username is already in use.', 'username_taken');
    if (db.prepare('SELECT 1 FROM users WHERE email = ? COLLATE NOCASE').get(email)) fail(409, 'That email address is already in use.', 'email_taken');
    db.prepare('INSERT INTO users (id, username, email, first_name, last_name, password_hash, role) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, username, email, firstName, lastName, passwordHash, role);
    const user = db.prepare('SELECT id, username, email, first_name, last_name, role, disabled, created_at, updated_at FROM users WHERE id = ?').get(id);
    const auditId = writeAuditLog({ actor: req.currentUser, action: 'account.created', entityType: 'user', entityId: id,
      summary: `Created account for ${username}`, details: { username, role } });
    if (!auditId) fail(500, 'Account could not be created because the audit log is unavailable.', 'audit_unavailable');
    return user;
  });
  let user;
  try {
    user = createAccount.immediate();
  } catch (error) {
    if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      if (db.prepare('SELECT 1 FROM users WHERE email = ? COLLATE NOCASE').get(email)) fail(409, 'That email address is already in use.', 'email_taken');
      if (db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(username)) fail(409, 'That username is already in use.', 'username_taken');
    }
    throw error;
  }
  res.status(201).json({ user: {
    id: user.id, username: user.username, email: user.email,
    firstName: user.first_name, lastName: user.last_name, role: user.role,
    disabled: Boolean(user.disabled), createdAt: user.created_at, updatedAt: user.updated_at,
  } });
});

adminRouter.get('/users/:userId', (req, res) => {
  const user = db.prepare('SELECT id, username, email, first_name, last_name, role, disabled, created_at, updated_at, last_login_at FROM users WHERE id = ?').get(req.params.userId);
  if (!user) fail(404, 'User not found.', 'not_found');
  const userCourseIds = `SELECT course_id FROM enrollments WHERE user_id = ?
       UNION SELECT course_id FROM course_grants WHERE user_id = ?`;
  const total = db.prepare(`SELECT COUNT(*) AS count FROM (${userCourseIds}) AS user_courses`).get(user.id, user.id).count;
  const pageSize = 50;
  const requestedPage = pageQuery(req.query.page);
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));
  const courses = db.prepare(`
    WITH user_courses(course_id) AS (${userCourseIds})
    SELECT c.*,
      (SELECT COUNT(*) FROM quizzes q JOIN course_modules m ON m.id = q.module_id WHERE m.course_id = c.id) AS quiz_count,
      (SELECT enrolled_at FROM enrollments e WHERE e.course_id = c.id AND e.user_id = ? LIMIT 1) AS enrolled_at,
      (SELECT granted_at FROM course_grants g WHERE g.course_id = c.id AND g.user_id = ? LIMIT 1) AS granted_at
    FROM user_courses uc JOIN courses c ON c.id = uc.course_id
    ORDER BY c.updated_at DESC, c.title COLLATE NOCASE, c.id ASC
    LIMIT ? OFFSET ?
  `).all(user.id, user.id, user.id, user.id, pageSize, (page - 1) * pageSize);
  const summaries = new Map(courseSummaries(courses, user).map((course) => [course.id, course]));
  const registrationFields = db.prepare(`SELECT field_id, field_label, field_type, field_value
    FROM user_registration_field_values WHERE user_id = ? ORDER BY position, field_id`).all(user.id)
    .map((field) => ({ id: field.field_id, label: field.field_label, type: field.field_type,
      value: field.field_type === 'checkbox' ? field.field_value === 'true' : field.field_value }));
  res.json({
    user: { id: user.id, username: user.username, email: user.email, firstName: user.first_name, lastName: user.last_name,
      role: user.role, disabled: Boolean(user.disabled), createdAt: user.created_at, updatedAt: user.updated_at,
      lastLoginAt: user.last_login_at, isCurrentUser: user.id === req.currentUser.id },
    registrationFields,
    courses: courses.map((course) => ({
      ...summaries.get(course.id),
      quizCount: course.quiz_count,
      enrolledAt: course.enrolled_at,
      grantedAt: course.granted_at,
    })),
    total,
    page,
    pageSize,
  });
});

adminRouter.patch('/users/:userId', (req, res) => {
  const body = requireObjectBody(req.body, 'Account changes');
  const updateUser = db.transaction(() => {
    const user = db.prepare('SELECT id, username, role, disabled, first_name, last_name FROM users WHERE id = ?').get(req.params.userId);
    if (!user) fail(404, 'User not found.', 'not_found');
    const nextRole = body.role === undefined ? user.role : body.role;
    const hasNameChanges = body.firstName !== undefined || body.lastName !== undefined;
    const nextFirstName = hasNameChanges ? accountName(body.firstName ?? user.first_name, 'First name') : user.first_name;
    const nextLastName = hasNameChanges ? accountName(body.lastName ?? user.last_name, 'Last name') : user.last_name;
    if (body.disabled !== undefined && typeof body.disabled !== 'boolean') {
      fail(400, 'Account disabled must be true or false.', 'validation_error');
    }
    const nextDisabled = body.disabled === undefined ? Boolean(user.disabled) : body.disabled;
    if (!['admin', 'moderator', 'learner'].includes(nextRole)) fail(400, 'Choose a valid role.', 'validation_error');
    if (user.role === 'admin' && !user.disabled && (nextDisabled || nextRole !== 'admin')) {
      const activeAdmins = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND disabled = 0").get().count;
      if (activeAdmins <= 1) fail(409, 'The last active administrator cannot be disabled or demoted.', 'last_admin');
    }
    const profileChanged = user.first_name !== nextFirstName || user.last_name !== nextLastName;
    const accountChanged = user.role !== nextRole || Boolean(user.disabled) !== nextDisabled;
    const changed = accountChanged || profileChanged;
    if (changed) {
      db.prepare('UPDATE users SET role = ?, disabled = ?, first_name = ?, last_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(nextRole, nextDisabled ? 1 : 0, nextFirstName, nextLastName, user.id);
      const auditId = writeAuditLog({ actor: req.currentUser, action: 'account.updated', entityType: 'user', entityId: user.id,
        summary: `Updated account for ${user.username}`, details: {
          username: user.username,
          ...(user.role !== nextRole ? { role: { from: user.role, to: nextRole } } : {}),
          ...(Boolean(user.disabled) !== nextDisabled ? { disabled: { from: Boolean(user.disabled), to: nextDisabled } } : {}),
          ...(profileChanged ? { firstName: { from: user.first_name, to: nextFirstName }, lastName: { from: user.last_name, to: nextLastName } } : {}),
        } });
      if (!auditId) fail(500, 'Account could not be updated because the audit log is unavailable.', 'audit_unavailable');
    }
    if (nextDisabled) invalidateUserSessions(db, user.id);
    const updated = db.prepare('SELECT id, username, email, first_name, last_name, role, disabled, created_at, updated_at FROM users WHERE id = ?').get(user.id);
    return { updated, profileChanged };
  });
  const { updated, profileChanged } = updateUser.immediate();
  const certificatesIssued = profileChanged ? issueCompletedCertificatesForUser(updated.id).length : 0;
  res.json({ user: {
    id: updated.id, username: updated.username, email: updated.email,
    firstName: updated.first_name, lastName: updated.last_name, role: updated.role,
    disabled: Boolean(updated.disabled), createdAt: updated.created_at, updatedAt: updated.updated_at,
  }, certificatesIssued });
});

adminRouter.put('/users/:userId/password', adminPasswordResetLimiter, async (req, res) => {
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.params.userId);
  if (!user) fail(404, 'User not found.', 'not_found');
  const { password, confirmPassword } = req.body || {};
  if (password !== confirmPassword) fail(400, 'Passwords do not match.', 'password_mismatch');
  const passwordError = validatePassword(password);
  if (passwordError) fail(400, passwordError, 'invalid_password');
  const passwordHash = await hashPassword(password);
  const resetPassword = db.transaction(() => {
    const currentUser = db.prepare('SELECT id, username FROM users WHERE id = ?').get(user.id);
    if (!currentUser) fail(404, 'User not found.', 'not_found');
    db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(passwordHash, currentUser.id);
    invalidateUserSessions(db, currentUser.id);
    const auditId = writeAuditLog({ actor: req.currentUser, action: 'account.password_reset', entityType: 'user', entityId: currentUser.id,
      summary: `Reset password for ${currentUser.username}`, details: { username: currentUser.username } });
    if (!auditId) fail(500, 'Password could not be reset because the audit log is unavailable.', 'audit_unavailable');
  });
  resetPassword.immediate();
  res.status(204).end();
});
