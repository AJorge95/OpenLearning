import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const isolatedConfig = {
  NODE_ENV: 'test',
  DATA_DIR: '',
  DB_PATH: '',
  MEDIA_ROOT: '',
  SESSION_SECRET: 'isolated-current-user-tests-use-a-local-secret',
  TRUST_PROXY: 'false',
  PORT: '3000',
  MAX_UPLOAD_BYTES: '2147483648',
  REQUEST_TIMEOUT_MS: '300000',
};
const previousConfig = new Map(Object.keys(isolatedConfig).map((key) => [key, process.env[key]]));
let fixtureDirectory;
let database;
let loadCurrentUser;

function createFixtureDirectory() {
  const tempBase = path.resolve(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(tempBase, 'openlearning-current-user-'));
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== tempBase
    || !path.basename(resolvedDirectory).startsWith('openlearning-current-user-')) {
    throw new Error('Refusing to use an unexpected temporary directory.');
  }
  return resolvedDirectory;
}

function removeFixtureDirectory(directory) {
  if (!directory) return;
  const tempBase = path.resolve(os.tmpdir());
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== tempBase
    || !path.basename(resolvedDirectory).startsWith('openlearning-current-user-')) {
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
  ({ loadCurrentUser } = await import('../../server/http.js'));
});

after(() => {
  if (database?.open) database.close();
  removeFixtureDirectory(fixtureDirectory);
  for (const [key, value] of previousConfig) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('current-user requests reuse the query while observing current account access', () => {
  database.prepare(`INSERT INTO users (id, username, password_hash, role)
    VALUES ('current-user-test', 'current-user-test', 'hash', 'admin')`).run();

  const originalPrepare = database.prepare;
  let currentUserPreparations = 0;
  database.prepare = (sql) => {
    if (sql.replace(/\s+/g, ' ').trim() === 'SELECT id, username, email, first_name, last_name, role, disabled, registration_status FROM users WHERE id = ?') {
      currentUserPreparations += 1;
    }
    return originalPrepare.call(database, sql);
  };

  function loadForAccount() {
    const request = { session: { userId: 'current-user-test', destroy: (callback) => callback(null) } };
    const nextCalls = [];
    loadCurrentUser(request, null, (error) => nextCalls.push(error));
    assert.deepEqual(nextCalls, [undefined]);
    return request.currentUser;
  }

  try {
    assert.equal(loadForAccount().role, 'admin');
    database.prepare('UPDATE users SET role = ? WHERE id = ?').run('learner', 'current-user-test');
    assert.equal(loadForAccount().role, 'learner');
    database.prepare('UPDATE users SET disabled = 1 WHERE id = ?').run('current-user-test');
    assert.equal(loadForAccount(), null);
  } finally {
    database.prepare = originalPrepare;
  }

  assert.equal(currentUserPreparations, 0);
});

test('current-user middleware destroys sessions for registrations awaiting approval', () => {
  const userId = 'current-user-pending-registration';
  database.prepare(`INSERT INTO users (id, username, password_hash, role, registration_status)
    VALUES (?, 'pending-registration', 'hash', 'learner', 'pending')`).run(userId);
  let destroyed = false;
  const request = { session: { userId, destroy: (callback) => { destroyed = true; callback(null); } } };
  const nextCalls = [];

  try {
    loadCurrentUser(request, null, (error) => nextCalls.push(error));
    assert.deepEqual(nextCalls, [undefined]);
    assert.equal(request.currentUser, null);
    assert.equal(destroyed, true);
  } finally {
    database.prepare('DELETE FROM users WHERE id = ?').run(userId);
  }
});
