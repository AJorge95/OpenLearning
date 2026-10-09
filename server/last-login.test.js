import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import express from 'express';
import session from 'express-session';
import Database from 'better-sqlite3';
import { after, before, test } from 'node:test';

const isolatedConfig = {
  NODE_ENV: 'test',
  DATA_DIR: '',
  DB_PATH: '',
  MEDIA_ROOT: '',
  SESSION_SECRET: 'isolated-last-login-tests',
  TRUST_PROXY: 'false',
  PORT: '3000',
  MAX_UPLOAD_BYTES: '2147483648',
  REQUEST_TIMEOUT_MS: '300000',
};
const previousConfig = new Map(Object.keys(isolatedConfig).map((key) => [key, process.env[key]]));
let fixtureDirectory;
let database;
let migrateDatabase;
let server;

function createFixtureDirectory() {
  const tempBase = path.resolve(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(tempBase, 'openlearning-last-login-'));
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== tempBase
    || !path.basename(resolvedDirectory).startsWith('openlearning-last-login-')) {
    throw new Error('Refusing to use an unexpected temporary directory.');
  }
  return resolvedDirectory;
}

function removeFixtureDirectory(directory) {
  if (!directory) return;
  const tempBase = path.resolve(os.tmpdir());
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== tempBase
    || !path.basename(resolvedDirectory).startsWith('openlearning-last-login-')) {
    throw new Error('Refusing to remove an unexpected temporary directory.');
  }
  fs.rmSync(resolvedDirectory, { recursive: true, force: true });
}

before(async () => {
  fixtureDirectory = createFixtureDirectory();
  Object.assign(process.env, {
    ...isolatedConfig,
    DATA_DIR: fixtureDirectory,
    DB_PATH: path.join(fixtureDirectory, 'openlearning.sqlite'),
    MEDIA_ROOT: path.join(fixtureDirectory, 'course-media'),
  });

  ({ db: database, migrateDatabase } = await import('./db.js'));
  const { authRouter } = await import('./routes-auth.js');
  const { adminRouter } = await import('./routes-admin.js');
  const { errorHandler } = await import('./http.js');

  const app = express();
  app.use(express.json());
  app.use(session({ secret: isolatedConfig.SESSION_SECRET, resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => {
    req.currentUser = database.prepare('SELECT id, username, role, disabled FROM users WHERE username = ?')
      .get('admin_last_login');
    next();
  });
  app.use('/api', authRouter);
  app.use('/api/admin', adminRouter);
  app.use(errorHandler);
  server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
});

after(async () => {
  if (server?.listening) {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
  }
  if (database?.open) database.close();
  removeFixtureDirectory(fixtureDirectory);
  for (const [key, value] of previousConfig) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function apiUrl(pathname) {
  const address = server.address();
  assert(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}/api${pathname}`;
}

test('migrations 16 to 18 preserve last-login history and add account fields once', () => {
  const migrationDb = new Database(':memory:');
  try {
    migrationDb.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO schema_migrations (version) VALUES (15);
      CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE audit_logs (actor_user_id TEXT, action TEXT, occurred_at TEXT);
      INSERT INTO users (id) VALUES ('user-history'), ('user-registration'), ('user-never-signed-in');
      INSERT INTO audit_logs (actor_user_id, action, occurred_at) VALUES
        ('user-history', 'auth.signed_in', '2026-10-01 09:00:00'),
        ('user-history', 'auth.signed_out', '2026-10-03 09:00:00'),
        ('user-history', 'auth.signed_in', '2026-10-02 09:00:00'),
        ('user-registration', 'account.registered', '2026-10-02 10:00:00'),
        ('user-registration', 'platform.setup', '2026-10-03 10:00:00');
    `);

    migrateDatabase(migrationDb);
    assert.equal(migrationDb.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version, 18);
    assert.deepEqual(migrationDb.prepare('SELECT id, last_login_at FROM users ORDER BY id').all(), [
      { id: 'user-history', last_login_at: '2026-10-02 09:00:00' },
      { id: 'user-never-signed-in', last_login_at: null },
      { id: 'user-registration', last_login_at: '2026-10-03 10:00:00' },
    ]);

    migrateDatabase(migrationDb);
    assert.equal(migrationDb.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 16').get().count, 1);
    assert.equal(migrationDb.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 17').get().count, 1);
    assert.equal(migrationDb.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 18').get().count, 1);
    assert.equal(migrationDb.prepare("SELECT COUNT(*) AS count FROM pragma_table_info('users') WHERE name = 'email'").get().count, 1);
    assert.equal(migrationDb.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'user_registration_field_values'").get().count, 1);
  } finally {
    migrationDb.close();
  }
});

test('setup, registration, and successful sign-in record last login for admin details', async () => {
  const setupResponse = await fetch(apiUrl('/setup'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify({
      platformName: 'Last Login Test',
      username: 'admin_last_login',
      email: 'admin.last-login@example.invalid',
      password: 'LastLoginPassphrase-2026',
      confirmPassword: 'LastLoginPassphrase-2026',
    }),
  });
  assert.equal(setupResponse.status, 201);
  const setup = await setupResponse.json();
  const adminId = setup.user.id;
  const setupLastLogin = database.prepare('SELECT last_login_at FROM users WHERE id = ?').get(adminId).last_login_at;
  assert.match(setupLastLogin, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

  const registrationResponse = await fetch(apiUrl('/auth/register'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify({
      username: 'new_learner',
      email: 'learner.last-login@example.invalid',
      password: 'LearnerPassphrase-2026',
      confirmPassword: 'LearnerPassphrase-2026',
    }),
  });
  assert.equal(registrationResponse.status, 201);
  const registration = await registrationResponse.json();
  const learnerLastLogin = database.prepare('SELECT last_login_at FROM users WHERE id = ?').get(registration.user.id).last_login_at;
  assert.match(learnerLastLogin, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

  const emailSearchResponse = await fetch(apiUrl('/admin/users?q=LEARNER.LAST-LOGIN%40EXAMPLE.INVALID'), { headers: { connection: 'close' } });
  assert.equal(emailSearchResponse.status, 200);
  const emailSearch = await emailSearchResponse.json();
  assert.equal(emailSearch.total, 1);
  assert.equal(emailSearch.users[0].id, registration.user.id);

  const priorLoginAt = '2000-01-01 00:00:00';
  database.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(priorLoginAt, adminId);
  const rejectedResponse = await fetch(apiUrl('/auth/login'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify({ username: 'admin_last_login', password: 'IncorrectPassphrase-2026' }),
  });
  assert.equal(rejectedResponse.status, 401);
  assert.equal(database.prepare('SELECT last_login_at FROM users WHERE id = ?').get(adminId).last_login_at, priorLoginAt);

  const response = await fetch(apiUrl('/auth/login'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify({ username: 'admin_last_login', password: 'LastLoginPassphrase-2026' }),
  });
  assert.equal(response.status, 200);

  const lastLoginAt = database.prepare('SELECT last_login_at FROM users WHERE id = ?').get(adminId).last_login_at;
  assert.match(lastLoginAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.notEqual(lastLoginAt, '2000-01-01 00:00:00');

  const detailsResponse = await fetch(apiUrl(`/admin/users/${adminId}`), { headers: { connection: 'close' } });
  assert.equal(detailsResponse.status, 200);
  const details = await detailsResponse.json();
  assert.equal(details.user.lastLoginAt, lastLoginAt);
});
