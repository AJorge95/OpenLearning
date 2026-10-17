import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import express from 'express';
import session from 'express-session';
import { after, before, test } from 'node:test';

const isolatedConfig = {
  NODE_ENV: 'test',
  DATA_DIR: '',
  DB_PATH: '',
  MEDIA_ROOT: '',
  SESSION_SECRET: 'isolated-registration-limit-tests',
  SETUP_TOKEN: '',
  TRUST_PROXY: 'false',
  PORT: '3000',
  MAX_UPLOAD_BYTES: '2147483648',
  REQUEST_TIMEOUT_MS: '300000',
};
const previousConfig = new Map(Object.keys(isolatedConfig).map((key) => [key, process.env[key]]));
let fixtureDirectory;
let database;
let setSetting;
let server;

function createFixtureDirectory() {
  const tempBase = path.resolve(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(tempBase, 'openlearning-registration-limits-'));
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== tempBase
    || !path.basename(resolvedDirectory).startsWith('openlearning-registration-limits-')) {
    throw new Error('Refusing to use an unexpected temporary directory.');
  }
  return resolvedDirectory;
}

function removeFixtureDirectory(directory) {
  if (!directory) return;
  const tempBase = path.resolve(os.tmpdir());
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== tempBase
    || !path.basename(resolvedDirectory).startsWith('openlearning-registration-limits-')) {
    throw new Error('Refusing to remove an unexpected temporary directory.');
  }
  fs.rmSync(resolvedDirectory, { recursive: true, force: true });
}

function apiUrl(pathname) {
  const address = server.address();
  assert(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}/api${pathname}`;
}

function registrationRequest(username, email = `${username}@example.invalid`, firstName = 'Limit', lastName = 'Check') {
  return fetch(apiUrl('/auth/register'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify({
      username,
      email,
      firstName,
      lastName,
      password: 'RegistrationLimitPassphrase-2026',
      confirmPassword: 'RegistrationLimitPassphrase-2026',
    }),
  });
}

before(async () => {
  fixtureDirectory = createFixtureDirectory();
  Object.assign(process.env, {
    ...isolatedConfig,
    DATA_DIR: fixtureDirectory,
    DB_PATH: path.join(fixtureDirectory, 'openlearning.sqlite'),
    MEDIA_ROOT: path.join(fixtureDirectory, 'course-media'),
  });

  ({ db: database, setSetting } = await import('../../server/db.js'));
  const { authRouter } = await import('../../server/routes-auth.js');
  const { errorHandler } = await import('../../server/http.js');

  database.prepare(`INSERT INTO users (id, username, email, password_hash, role)
    VALUES (?, ?, ?, ?, 'admin')`).run(
    'registration-limits-admin',
    'registration_limits_admin',
    'registration.limits.admin@example.invalid',
    'not-used-by-this-fixture',
  );
  setSetting('setup_complete', '1');
  setSetting('registration_enabled', '1');
  setSetting('user_limit', 2);

  const app = express();
  app.use(express.json());
  app.use(session({ secret: isolatedConfig.SESSION_SECRET, resave: false, saveUninitialized: false }));
  app.use('/api', authRouter);
  app.use(errorHandler);
  server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
});

test('registration rejects a host-only email domain before creating an account', async () => {
  const response = await registrationRequest('registration_local_email', 'learner@localhost');
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: 'Enter a valid email address (up to 254 characters).',
    code: 'invalid_email',
  });
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM users WHERE username = ?').get('registration_local_email').count, 0);
});

test('registration rejects a whitespace-only account name before creating an account', async () => {
  const response = await registrationRequest('registration_empty_name', 'empty.name@example.invalid', '   ');
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: 'First name must be between 1 and 80 characters.',
    code: 'invalid_name',
  });
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM users WHERE username = ?').get('registration_empty_name').count, 0);
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

test('concurrent registrations cannot exceed the account limit', async () => {
  const beforeStatusResponse = await fetch(apiUrl('/setup/status'));
  assert.equal(beforeStatusResponse.status, 200);
  assert.deepEqual(await beforeStatusResponse.json(), {
    configured: true,
    setupAvailable: false,
    platformName: '',
    platformIcon: null,
    themePalette: 'violet',
    maxUploadBytes: 2 * 1024 ** 3,
    connectionProtocol: 'http',
    registrationEnabled: true,
    registrationApprovalRequired: false,
    registrationAvailable: true,
    userLimit: 2,
  });

  const responses = await Promise.all([
    registrationRequest('registration_limit_race_one'),
    registrationRequest('registration_limit_race_two'),
  ]);
  const outcomes = await Promise.all(responses.map(async (response) => ({
    status: response.status,
    body: await response.json(),
  })));

  assert.deepEqual(outcomes.map(({ status }) => status).sort(), [201, 403]);
  assert.deepEqual(outcomes.find(({ status }) => status === 403)?.body, {
    error: 'The platform has reached its registered-user limit.',
    code: 'user_limit_reached',
  });
  assert.equal(outcomes.find(({ status }) => status === 201)?.body.registrationAvailable, false);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM users').get().count, 2);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'account.registered'").get().count, 1);

  const atLimitStatusResponse = await fetch(apiUrl('/setup/status'));
  const atLimitStatus = await atLimitStatusResponse.json();
  assert.equal(atLimitStatus.registrationAvailable, false);
  assert.equal(atLimitStatus.userLimit, 2);
});

test('disabled registration reports unavailable and creates no account', async () => {
  setSetting('user_limit', 0);
  setSetting('registration_enabled', '0');
  const userCount = database.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  const registrationAuditCount = database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'account.registered'").get().count;

  const statusResponse = await fetch(apiUrl('/setup/status'));
  const status = await statusResponse.json();
  assert.equal(status.registrationEnabled, false);
  assert.equal(status.registrationAvailable, false);
  assert.equal(status.userLimit, 0);

  const registrationResponse = await registrationRequest('registration_disabled_account');
  assert.equal(registrationResponse.status, 403);
  assert.deepEqual(await registrationResponse.json(), {
    error: 'New account registration is disabled by an administrator.',
    code: 'registration_disabled',
  });
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM users').get().count, userCount);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'account.registered'").get().count, registrationAuditCount);
});

test('unlimited registration does not count all users for its success response', async () => {
  setSetting('user_limit', 0);
  setSetting('registration_enabled', '1');
  const originalPrepare = database.prepare;
  let registeredUserCountReads = 0;
  database.prepare = function countRegisteredUserQueries(sql, ...parameters) {
    if (sql === 'SELECT COUNT(*) AS count FROM users') registeredUserCountReads += 1;
    return originalPrepare.call(this, sql, ...parameters);
  };

  let response;
  try {
    response = await registrationRequest('registration_unlimited_count');
  } finally {
    database.prepare = originalPrepare;
  }

  assert.equal(response.status, 201);
  assert.equal((await response.json()).registrationAvailable, true);
  assert.equal(registeredUserCountReads, 0);
});
