import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db, setting } from './db.js';
import { hashPassword, validateCredentials } from './auth.js';
import { enumQuery, fail, pageQuery, requireAdmin, requireObjectBody } from './http.js';
import { invalidateUserSessions } from './session-store.js';
import { likeContains, textSearchPredicate } from './sql.js';
import { writeAuditLog } from './log-store.js';
import { courseSummaries } from './course-service.js';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

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
  if (query) { clauses.push("username LIKE ? ESCAPE '!'"); params.push(likeContains(query)); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const orderBy = role === 'all'
    ? "CASE role WHEN 'admin' THEN 1 WHEN 'moderator' THEN 2 ELSE 3 END, username COLLATE NOCASE"
    : 'username COLLATE NOCASE';
  const total = db.prepare(`SELECT COUNT(*) AS count FROM users ${where}`).get(...params).count;
  const requestedPage = pageQuery(req.query.page);
  const pageSize = 50;
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));
  const users = db.prepare(`SELECT id, username, role, disabled, created_at FROM users
    ${where}
    ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize);
  res.json({ users: users.map((user) => ({
    id: user.id,
    username: user.username,
    role: user.role,
    disabled: Boolean(user.disabled),
    createdAt: user.created_at,
    isCurrentUser: user.id === req.currentUser.id,
  })), total, page, pageSize });
});

adminRouter.post('/users', async (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const { password, confirmPassword } = req.body || {};
  const role = req.body?.role === undefined ? 'learner' : req.body.role;
  const credentialError = validateCredentials(username, password);
  if (credentialError) fail(400, credentialError, 'invalid_credentials');
  if (password !== confirmPassword) fail(400, 'Passwords do not match.', 'password_mismatch');
  if (!['admin', 'moderator', 'learner'].includes(role)) fail(400, 'Choose a valid role.', 'validation_error');
  assertAccountCapacity();
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) fail(409, 'That username is already in use.', 'username_taken');
  const passwordHash = await hashPassword(password);
  const id = randomUUID();
  const createAccount = db.transaction(() => {
    assertAccountCapacity();
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) fail(409, 'That username is already in use.', 'username_taken');
    db.prepare('INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(id, username, passwordHash, role);
  });
  try {
    createAccount.immediate();
  } catch (error) {
    if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') fail(409, 'That username is already in use.', 'username_taken');
    throw error;
  }
  const user = db.prepare('SELECT id, username, role, disabled, created_at, updated_at FROM users WHERE id = ?').get(id);
  writeAuditLog({ actor: req.currentUser, action: 'account.created', entityType: 'user', entityId: id,
    summary: `Created account for ${username}`, details: { username, role } });
  res.status(201).json({ user: { ...user, disabled: Boolean(user.disabled), createdAt: user.created_at, updatedAt: user.updated_at } });
});

adminRouter.get('/users/:userId', (req, res) => {
  const user = db.prepare('SELECT id, username, role, disabled, created_at, updated_at FROM users WHERE id = ?').get(req.params.userId);
  if (!user) fail(404, 'User not found.', 'not_found');
  const courseFilter = `EXISTS (SELECT 1 FROM enrollments e WHERE e.course_id = c.id AND e.user_id = ?)
       OR EXISTS (SELECT 1 FROM course_grants g WHERE g.course_id = c.id AND g.user_id = ?)`;
  const total = db.prepare(`SELECT COUNT(*) AS count FROM courses c WHERE ${courseFilter}`).get(user.id, user.id).count;
  const pageSize = 50;
  const requestedPage = pageQuery(req.query.page);
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));
  const courses = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM quizzes q JOIN course_modules m ON m.id = q.module_id WHERE m.course_id = c.id) AS quiz_count,
      (SELECT enrolled_at FROM enrollments e WHERE e.course_id = c.id AND e.user_id = ? LIMIT 1) AS enrolled_at,
      (SELECT granted_at FROM course_grants g WHERE g.course_id = c.id AND g.user_id = ? LIMIT 1) AS granted_at
    FROM courses c
    WHERE ${courseFilter}
    ORDER BY c.updated_at DESC, c.title COLLATE NOCASE, c.id ASC
    LIMIT ? OFFSET ?
  `).all(user.id, user.id, user.id, user.id, pageSize, (page - 1) * pageSize);
  const summaries = new Map(courseSummaries(courses, user).map((course) => [course.id, course]));
  res.json({
    user: { ...user, disabled: Boolean(user.disabled), createdAt: user.created_at, updatedAt: user.updated_at, isCurrentUser: user.id === req.currentUser.id },
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
    const user = db.prepare('SELECT id, username, role, disabled FROM users WHERE id = ?').get(req.params.userId);
    if (!user) fail(404, 'User not found.', 'not_found');
    const nextRole = body.role === undefined ? user.role : body.role;
    if (body.disabled !== undefined && typeof body.disabled !== 'boolean') {
      fail(400, 'Account disabled must be true or false.', 'validation_error');
    }
    const nextDisabled = body.disabled === undefined ? Boolean(user.disabled) : body.disabled;
    if (!['admin', 'moderator', 'learner'].includes(nextRole)) fail(400, 'Choose a valid role.', 'validation_error');
    if (user.role === 'admin' && !user.disabled && (nextDisabled || nextRole !== 'admin')) {
      const activeAdmins = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND disabled = 0").get().count;
      if (activeAdmins <= 1) fail(409, 'The last active administrator cannot be disabled or demoted.', 'last_admin');
    }
    const changed = user.role !== nextRole || Boolean(user.disabled) !== nextDisabled;
    if (changed) {
      db.prepare('UPDATE users SET role = ?, disabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(nextRole, nextDisabled ? 1 : 0, user.id);
    }
    if (nextDisabled) invalidateUserSessions(db, user.id);
    const updated = db.prepare('SELECT id, username, role, disabled, created_at, updated_at FROM users WHERE id = ?').get(user.id);
    return { user, nextRole, nextDisabled, updated, changed };
  });
  const { user, nextRole, nextDisabled, updated, changed } = updateUser.immediate();
  if (changed) {
    writeAuditLog({ actor: req.currentUser, action: 'account.updated', entityType: 'user', entityId: user.id,
      summary: `Updated account for ${user.username}`, details: { username: user.username, role: { from: user.role, to: nextRole }, disabled: { from: Boolean(user.disabled), to: nextDisabled } } });
  }
  res.json({ user: { ...updated, disabled: Boolean(updated.disabled), createdAt: updated.created_at, updatedAt: updated.updated_at } });
});

adminRouter.put('/users/:userId/password', async (req, res) => {
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.params.userId);
  if (!user) fail(404, 'User not found.', 'not_found');
  const { password, confirmPassword } = req.body || {};
  if (password !== confirmPassword) fail(400, 'Passwords do not match.', 'password_mismatch');
  const credentialError = validateCredentials(user.username, password);
  if (credentialError && !credentialError.startsWith('Username')) fail(400, credentialError, 'invalid_password');
  const passwordHash = await hashPassword(password);
  const resetPassword = db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(passwordHash, user.id);
    invalidateUserSessions(db, user.id);
  });
  resetPassword.immediate();
  writeAuditLog({ actor: req.currentUser, action: 'account.password_reset', entityType: 'user', entityId: user.id,
    summary: `Reset password for ${user.username}`, details: { username: user.username } });
  res.status(204).end();
});
