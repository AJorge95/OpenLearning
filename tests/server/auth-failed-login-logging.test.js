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
  SESSION_SECRET: 'isolated-auth-failed-login-tests',
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
  const directory = fs.mkdtempSync(path.join(tempBase, 'openlearning-auth-failed-login-'));
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== tempBase
    || !path.basename(resolvedDirectory).startsWith('openlearning-auth-failed-login-')) {
    throw new Error('Refusing to use an unexpected temporary directory.');
  }
  return resolvedDirectory;
}

function removeFixtureDirectory(directory) {
  if (!directory) return;
  const tempBase = path.resolve(os.tmpdir());
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== tempBase
    || !path.basename(resolvedDirectory).startsWith('openlearning-auth-failed-login-')) {
    throw new Error('Refusing to remove an unexpected temporary directory.');
  }
  fs.rmSync(resolvedDirectory, { recursive: true, force: true });
}

function apiUrl(pathname) {
  const address = server.address();
  assert(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}/api${pathname}`;
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
  const [{ authRouter }, { errorHandler }] = await Promise.all([
    import('../../server/routes-auth.js'),
    import('../../server/http.js'),
  ]);
  const app = express();
  app.use(express.json());
  app.use(session({
    name: 'openlearning.sid',
    secret: isolatedConfig.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
  }));
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

test('failed sign-in log identifies the attempted username without credentials', async () => {
  const username = ' issue8_missing_user ';
  const password = 'NeverPersistThisPassword-2026';
  const response = await fetch(apiUrl('/auth/login'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify({ username, password }),
  });

  assert.equal(response.status, 401);
  const log = database.prepare(`SELECT level, source, message, details_json
    FROM system_logs WHERE source = 'auth' AND message = 'Sign-in attempt failed'
    ORDER BY id DESC LIMIT 1`).get();
  assert.deepEqual(log && {
    level: log.level,
    source: log.source,
    message: log.message,
    details: JSON.parse(log.details_json),
  }, {
    level: 'warn',
    source: 'auth',
    message: 'Sign-in attempt failed',
    details: { username: 'issue8_missing_user' },
  });
  assert.doesNotMatch(log.details_json, /NeverPersistThisPassword-2026/);
});
