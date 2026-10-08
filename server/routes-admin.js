import { Router } from 'express';
import { db } from './db.js';
import { hashPassword, validateCredentials } from './auth.js';
import { fail, requireAdmin } from './http.js';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

function invalidateUserSessions(userId) {
  const rows = db.prepare('SELECT sid, session_data FROM sessions').all();
  const remove = rows.filter((row) => {
    try { return JSON.parse(row.session_data).userId === userId; } catch { return true; }
  }).map((row) => row.sid);
  if (!remove.length) return;
  const deleteOne = db.prepare('DELETE FROM sessions WHERE sid = ?');
  const transaction = db.transaction((ids) => ids.forEach((id) => deleteOne.run(id)));
  transaction(remove);
}

adminRouter.get('/users', (req, res) => {
  const query = String(req.query.q || '').trim().slice(0, 100);
  const role = ['admin', 'moderator', 'learner'].includes(req.query.role) ? req.query.role : 'all';
  const clauses = [];
  const params = [];
  if (role !== 'all') { clauses.push('role = ?'); params.push(role); }
  if (query) { clauses.push('username LIKE ?'); params.push(`%${query}%`); }
  const users = db.prepare(`SELECT id, username, role, disabled, created_at FROM users
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY CASE role WHEN 'admin' THEN 1 WHEN 'moderator' THEN 2 ELSE 3 END, username COLLATE NOCASE LIMIT 300`)
    .all(...params);
  res.json({ users: users.map((user) => ({
    id: user.id,
    username: user.username,
    role: user.role,
    disabled: Boolean(user.disabled),
    createdAt: user.created_at,
    isCurrentUser: user.id === req.currentUser.id,
  })) });
});

adminRouter.patch('/users/:userId', (req, res) => {
  const user = db.prepare('SELECT id, username, role, disabled FROM users WHERE id = ?').get(req.params.userId);
  if (!user) fail(404, 'User not found.', 'not_found');
  const nextRole = req.body?.role === undefined ? user.role : req.body.role;
  const nextDisabled = req.body?.disabled === undefined ? Boolean(user.disabled) : Boolean(req.body.disabled);
  if (!['admin', 'moderator', 'learner'].includes(nextRole)) fail(400, 'Choose a valid role.', 'validation_error');
  if (user.role === 'admin' && (!nextDisabled && nextRole === 'admin')) {
    // A no-op admin edit is allowed.
  } else if (user.role === 'admin' && (nextDisabled || nextRole !== 'admin')) {
    const activeAdmins = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND disabled = 0").get().count;
    if (activeAdmins <= 1) fail(409, 'The last active administrator cannot be disabled or demoted.', 'last_admin');
  }
  db.prepare('UPDATE users SET role = ?, disabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(nextRole, nextDisabled ? 1 : 0, user.id);
  if (nextDisabled) invalidateUserSessions(user.id);
  const updated = db.prepare('SELECT id, username, role, disabled, created_at FROM users WHERE id = ?').get(user.id);
  res.json({ user: { ...updated, disabled: Boolean(updated.disabled), createdAt: updated.created_at } });
});

adminRouter.put('/users/:userId/password', async (req, res) => {
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.params.userId);
  if (!user) fail(404, 'User not found.', 'not_found');
  const { password, confirmPassword } = req.body || {};
  if (password !== confirmPassword) fail(400, 'Passwords do not match.', 'password_mismatch');
  const credentialError = validateCredentials(user.username, password);
  if (credentialError && !credentialError.startsWith('Username')) fail(400, credentialError, 'invalid_password');
  db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(await hashPassword(password), user.id);
  invalidateUserSessions(user.id);
  res.status(204).end();
});

