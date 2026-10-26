import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import express from 'express';
import session from 'express-session';
import { after, before, test } from 'node:test';
import { createSessionCookieProtocolMiddleware, sessionCookieOptions } from '../../server/session-cookie.js';

const password = 'isolated-session-cookie-password';
const environment = {
  NODE_ENV: 'test', DATA_DIR: '', DB_PATH: '', MEDIA_ROOT: '',
  SESSION_SECRET: 'isolated-session-cookie-login-secret', TRUST_PROXY: 'false',
};
const previousEnvironment = new Map(Object.keys(environment).map((key) => [key, process.env[key]]));
let directory;
let database;
let settings;
let authRouter;
let courseRouter;
let http;
let SQLiteSessionStore;

before(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openlearning-cookie-login-'));
  Object.assign(process.env, environment, {
    DATA_DIR: directory, DB_PATH: path.join(directory, 'openlearning.sqlite'), MEDIA_ROOT: path.join(directory, 'media'),
  });
  settings = await import('../../server/db.js');
  database = settings.db;
  ({ authRouter } = await import('../../server/routes-auth.js'));
  ({ courseRouter } = await import('../../server/routes-courses.js'));
  http = await import('../../server/http.js');
  ({ SQLiteSessionStore } = await import('../../server/session-store.js'));
  const { hashPassword } = await import('../../server/auth.js');
  database.prepare("INSERT INTO users (id, username, email, password_hash, role) VALUES (?, ?, ?, ?, 'admin')")
    .run('cookie-admin', 'cookie_admin', 'cookie-admin@example.test', await hashPassword(password));
});

after(() => {
  if (database?.open) database.close();
  if (directory) {
    const target = path.resolve(directory);
    assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
    assert.ok(path.basename(target).startsWith('openlearning-cookie-login-'));
    fs.rmSync(target, { recursive: true, force: true });
  }
  for (const [key, value] of previousEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function exerciseLogin({ protocol, trustProxy = false, forwardedProtocol, expectedSecure, identifier = 'cookie_admin' }) {
  settings.setSetting('connection_protocol', protocol);
  const store = new SQLiteSessionStore(database);
  const app = express();
  if (trustProxy) app.set('trust proxy', 1);
  app.use(express.json());
  app.use(session({
    name: 'openlearning.sid', secret: environment.SESSION_SECRET,
    store, resave: false, saveUninitialized: false, cookie: sessionCookieOptions,
  }));
  app.use(createSessionCookieProtocolMiddleware());
  app.use(http.loadCurrentUser);
  app.use('/api', http.csrfMiddleware);
  app.use('/api', authRouter);
  app.use('/api', courseRouter);
  app.use(http.errorHandler);
  const server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { connection: 'close', ...(forwardedProtocol ? { 'x-forwarded-proto': forwardedProtocol } : {}) };
  try {
    const csrfResponse = await fetch(`${base}/api/csrf`, { headers });
    assert.equal(csrfResponse.status, 200);
    const csrf = await csrfResponse.json();
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json', 'x-csrf-token': csrf.token },
      body: JSON.stringify({ username: identifier, password }),
    });
    assert.equal(login.status, 200);
    assert.equal((await login.json()).user.id, 'cookie-admin');
    const setCookie = login.headers.get('set-cookie');
    assert.ok(setCookie, 'Successful login must issue a session cookie after regeneration');
    assert.equal(/;\s*Secure(?:;|$)/i.test(setCookie), expectedSecure);
    assert.match(setCookie, /;\s*HttpOnly(?:;|$)/i);
    const cookie = setCookie.split(';', 1)[0];
    for (const endpoint of ['/api/auth/me', '/api/courses', '/api/admin/settings']) {
      const response = await fetch(`${base}${endpoint}`, { headers: { ...headers, cookie } });
      assert.equal(response.status, 200, `${endpoint} must recognize the login session`);
      const data = await response.json();
      if (endpoint === '/api/auth/me') assert.equal(data.user.id, 'cookie-admin');
    }
    const anonymous = await fetch(`${base}/api/admin/settings`, { headers });
    assert.equal(anonymous.status, 401, 'Protected routes still reject requests without a session');
  } finally {
    store.close();
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
  }
}

test('HTTP admin login persists with the saved HTTPS setting', () => exerciseLogin({ protocol: 'https', expectedSecure: false }));
test('HTTP admin login persists with the saved HTTP setting', () => exerciseLogin({ protocol: 'http', expectedSecure: false }));
test('trusted forwarded HTTPS issues a Secure session cookie', () => exerciseLogin({ protocol: 'https', trustProxy: true, forwardedProtocol: 'https', expectedSecure: true }));
test('untrusted forwarded HTTPS cannot change cookie transport detection', () => exerciseLogin({ protocol: 'https', forwardedProtocol: 'https', expectedSecure: false }));
test('email sign-in trims the identifier and matches email case-insensitively', () => exerciseLogin({
  protocol: 'http', expectedSecure: false, identifier: '  Cookie-Admin@Example.Test  ',
}));
