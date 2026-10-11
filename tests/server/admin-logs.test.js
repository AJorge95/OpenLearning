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
  SESSION_SECRET: 'isolated-admin-log-tests-use-a-local-secret',
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
  const directory = fs.mkdtempSync(path.join(tempBase, 'openlearning-admin-logs-'));
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== tempBase
    || !path.basename(resolvedDirectory).startsWith('openlearning-admin-logs-')) {
    throw new Error('Refusing to use an unexpected temporary directory.');
  }
  return resolvedDirectory;
}

function removeFixtureDirectory(directory) {
  if (!directory) return;
  const tempBase = path.resolve(os.tmpdir());
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== tempBase
    || !path.basename(resolvedDirectory).startsWith('openlearning-admin-logs-')) {
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

  const app = express();
  app.use((req, _res, next) => {
    const role = req.get('x-test-role');
    req.currentUser = role ? { id: `test-${role}`, username: role, role, disabled: false } : null;
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

test('audit log route is admin-only and keeps paging, filters, and action counts stable', async () => {
  const insert = database.prepare(`INSERT INTO audit_logs (actor_username, action, entity_type, entity_id, summary, details_json)
    VALUES (?, ?, ?, ?, ?, ?)`);
  const seed = database.transaction(() => {
    for (let index = 1; index <= 53; index += 1) {
      insert.run('admin', 'account.created', 'user', `user-${index}`, `Account created ${index}`, JSON.stringify({ index }));
    }
    for (let index = 1; index <= 12; index += 1) {
      insert.run('admin', 'course.published', 'course', `course-${index}`, `Course published ${index}`, '{}');
    }
  });
  seed();

  const anonymousResponse = await fetch(apiUrl('/audit-logs'));
  assert.equal(anonymousResponse.status, 401);
  assert.deepEqual(await anonymousResponse.json(), { error: 'Sign in to continue.', code: 'unauthorized' });

  const moderatorResponse = await fetch(apiUrl('/audit-logs'), { headers: { 'x-test-role': 'moderator' } });
  assert.equal(moderatorResponse.status, 403);
  assert.deepEqual(await moderatorResponse.json(), { error: 'You do not have permission to do that.', code: 'forbidden' });

  const response = await fetch(apiUrl('/audit-logs?page=2&action=account.created&q=account'), {
    headers: { 'x-test-role': 'admin' },
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.total, 53);
  assert.equal(result.page, 2);
  assert.equal(result.pageSize, 50);
  assert.deepEqual(result.entries.map((entry) => entry.id), [3, 2, 1]);
  assert.equal(result.entries[0].details.index, 3);
  assert.deepEqual(result.actions, [
    { action: 'account.created', count: 53 },
    { action: 'course.published', count: 12 },
  ]);
});
