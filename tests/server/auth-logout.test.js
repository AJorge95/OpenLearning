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
  SESSION_SECRET: 'isolated-auth-logout-tests',
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
  const tempBase = path.resolve(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(tempBase, 'openlearning-auth-logout-'));
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== tempBase
    || !path.basename(resolvedDirectory).startsWith('openlearning-auth-logout-')) {
    throw new Error('Refusing to use an unexpected temporary directory.');
  }
  return resolvedDirectory;
}

function removeFixtureDirectory(directory) {
  if (!directory) return;
  const tempBase = path.resolve(os.tmpdir());
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== tempBase
    || !path.basename(resolvedDirectory).startsWith('openlearning-auth-logout-')) {
    throw new Error('Refusing to remove an unexpected temporary directory.');
  }
  fs.rmSync(resolvedDirectory, { recursive: true, force: true });
}

function apiUrl(pathname) {
  const address = server.address();
  assert(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}/api${pathname}`;
}

function sessionCookie(response) {
  const setCookie = response.headers.get('set-cookie');
  assert.ok(setCookie, 'Expected the session response to set a cookie.');
  return setCookie.split(';', 1)[0];
}

async function createAuthenticatedSession() {
  const sessionResponse = await fetch(apiUrl('/test/session'), { headers: { connection: 'close' } });
  assert.equal(sessionResponse.status, 204);
  let cookie = sessionCookie(sessionResponse);

  const csrfResponse = await fetch(apiUrl('/csrf'), { headers: { cookie, connection: 'close' } });
  assert.equal(csrfResponse.status, 200);
  const csrf = await csrfResponse.json();
  cookie = csrfResponse.headers.get('set-cookie') ? sessionCookie(csrfResponse) : cookie;
  return { cookie, csrfToken: csrf.token };
}

async function signOut({ cookie, csrfToken }) {
  return fetch(apiUrl('/auth/logout'), {
    method: 'POST',
    headers: { cookie, 'x-csrf-token': csrfToken, connection: 'close' },
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

  ({ db: database } = await import('../../server/db.js'));
  const [{ authRouter }, { csrfMiddleware, errorHandler, loadCurrentUser }] = await Promise.all([
    import('../../server/routes-auth.js'),
    import('../../server/http.js'),
  ]);
  database.prepare(`INSERT INTO users (id, username, password_hash, role)
    VALUES (?, ?, ?, 'learner')`).run('logout-learner', 'logout_learner', 'not-used-by-this-fixture');

  const app = express();
  app.use(session({
    name: 'openlearning.sid',
    secret: isolatedConfig.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
  }));
  app.get('/api/test/session', (req, res) => {
    req.session.userId = 'logout-learner';
    res.status(204).end();
  });
  app.use(loadCurrentUser);
  app.use('/api', csrfMiddleware);
  app.use('/api', authRouter);
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

test('sign-out destroys the session and records an audit event', async () => {
  const auth = await createAuthenticatedSession();
  const response = await signOut(auth);

  assert.equal(response.status, 204);
  assert.equal(await response.text(), '');
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'auth.signed_out'").get().count, 1);

  const currentUserResponse = await fetch(apiUrl('/auth/me'), {
    headers: { cookie: auth.cookie, connection: 'close' },
  });
  assert.equal(currentUserResponse.status, 200);
  assert.equal((await currentUserResponse.json()).user, null);
});

test('sign-out still destroys the session when its audit write fails', async () => {
  const auditCountBefore = database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'auth.signed_out'").get().count;
  database.exec(`CREATE TRIGGER fail_sign_out_audit BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'auth.signed_out' BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END`);
  const originalConsoleError = console.error;
  const logErrors = [];
  console.error = (...args) => logErrors.push(args);

  try {
    const auth = await createAuthenticatedSession();
    const response = await signOut(auth);

    assert.equal(response.status, 204);
    assert.equal(await response.text(), '');
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'auth.signed_out'").get().count, auditCountBefore);
    assert.equal(logErrors.length, 1);

    const currentUserResponse = await fetch(apiUrl('/auth/me'), {
      headers: { cookie: auth.cookie, connection: 'close' },
    });
    assert.equal((await currentUserResponse.json()).user, null);
  } finally {
    console.error = originalConsoleError;
    database.exec('DROP TRIGGER IF EXISTS fail_sign_out_audit');
  }
});
