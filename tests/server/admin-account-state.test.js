import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import express from 'express';
import { after, before, test } from 'node:test';

const isolatedConfig = {
  NODE_ENV: 'test',
  DATA_DIR: '',
  DB_PATH: '',
  MEDIA_ROOT: '',
  SESSION_SECRET: 'isolated-admin-account-state-tests',
  TRUST_PROXY: 'false',
  PORT: '3000',
  MAX_UPLOAD_BYTES: '2147483648',
  REQUEST_TIMEOUT_MS: '300000',
};
const previousConfig = new Map(Object.keys(isolatedConfig).map((key) => [key, process.env[key]]));
let fixtureDirectory;
let database;
let server;

function createFixtureDirectory() {
  const temporaryRoot = path.resolve(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(temporaryRoot, 'openlearning-admin-account-state-'));
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== temporaryRoot
    || !path.basename(resolvedDirectory).startsWith('openlearning-admin-account-state-')) {
    throw new Error('Refusing to use an unexpected temporary directory.');
  }
  return resolvedDirectory;
}

function removeFixtureDirectory(directory) {
  if (!directory) return;
  const temporaryRoot = path.resolve(os.tmpdir());
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== temporaryRoot
    || !path.basename(resolvedDirectory).startsWith('openlearning-admin-account-state-')) {
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

  ({ db: database } = await import('../../server/db.js'));
  const [{ adminRouter }, { errorHandler }] = await Promise.all([
    import('../../server/routes-admin.js'),
    import('../../server/http.js'),
  ]);

  database.exec(`
    INSERT INTO users (id, username, password_hash, role) VALUES
      ('account-state-admin', 'account_state_admin', 'unused', 'admin'),
      ('account-state-other', 'account_state_other', 'unused', 'learner');
  `);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.currentUser = database.prepare('SELECT id, username, role, disabled FROM users WHERE id = ?')
      .get('account-state-admin');
    next();
  });
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
  return `http://127.0.0.1:${address.port}/api/admin${pathname}`;
}

function addSession(sid, userId) {
  database.prepare('INSERT INTO sessions (sid, session_data, expires_at, user_id) VALUES (?, ?, ?, ?)')
    .run(sid, JSON.stringify({ userId }), Date.now() + 60_000, userId);
}

function addAccount(userId, username) {
  database.prepare('INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(userId, username, 'unused', 'learner');
}

async function updateAccount(userId, changes) {
  return fetch(apiUrl(`/users/${userId}`), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify(changes),
  });
}

test('disabling an account revokes its sessions and re-enabling does not restore them', async () => {
  const userId = 'account-state-disable-target';
  addAccount(userId, 'account_state_disable_target');
  addSession('account-state-disable-session-a', userId);
  addSession('account-state-disable-session-b', userId);
  addSession('account-state-other-session', 'account-state-other');

  const disabledResponse = await updateAccount(userId, { disabled: true });
  assert.equal(disabledResponse.status, 200);
  assert.equal((await disabledResponse.json()).user.disabled, true);
  // Revocation and the account update must leave unrelated users' sessions intact.
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?').get(userId).count, 0);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?').get('account-state-other').count, 1);

  const enabledResponse = await updateAccount(userId, { disabled: false });
  assert.equal(enabledResponse.status, 200);
  assert.equal((await enabledResponse.json()).user.disabled, false);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?').get(userId).count, 0);
});

test('account disable rolls back when its required audit record cannot be written', async () => {
  const userId = 'account-state-audit-target';
  addAccount(userId, 'account_state_audit_target');
  addSession('account-state-audit-session-a', userId);
  addSession('account-state-audit-session-b', userId);
  const auditCount = database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'account.updated' AND entity_id = ?")
    .get(userId).count;
  database.exec(`CREATE TRIGGER fail_account_state_audit BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'account.updated' AND NEW.entity_id = '${userId}'
    BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;`);

  try {
    const response = await updateAccount(userId, { disabled: true });
    assert.equal(response.status, 500);
    assert.equal((await response.json()).code, 'audit_unavailable');
    assert.equal(database.prepare('SELECT disabled FROM users WHERE id = ?').get(userId).disabled, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?').get(userId).count, 2);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'account.updated' AND entity_id = ?").get(userId).count, auditCount);
  } finally {
    database.exec('DROP TRIGGER IF EXISTS fail_account_state_audit');
  }
});
