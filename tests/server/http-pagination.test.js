import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import express from 'express';
import { after, before, test } from 'node:test';

const fixturePrefix = 'openlearning-http-pagination-';
const environmentKeys = ['NODE_ENV', 'DATA_DIR', 'DB_PATH', 'MEDIA_ROOT', 'TRUST_PROXY', 'PORT'];
const originalEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
let fixtureDirectory;
let database;
let pageQuery;
let errorHandler;
let server;

function createFixtureDirectory() {
  const temporaryRoot = path.resolve(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(temporaryRoot, fixturePrefix));
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== temporaryRoot
    || !path.basename(resolvedDirectory).startsWith(fixturePrefix)) {
    throw new Error('Refusing to use an unexpected temporary directory.');
  }
  return resolvedDirectory;
}

function removeFixtureDirectory(directory) {
  if (!directory) return;
  const temporaryRoot = path.resolve(os.tmpdir());
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== temporaryRoot
    || !path.basename(resolvedDirectory).startsWith(fixturePrefix)) {
    throw new Error('Refusing to remove an unexpected temporary directory.');
  }
  fs.rmSync(resolvedDirectory, { recursive: true, force: true });
}

before(async () => {
  fixtureDirectory = createFixtureDirectory();
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATA_DIR: fixtureDirectory,
    DB_PATH: path.join(fixtureDirectory, 'openlearning.sqlite'),
    MEDIA_ROOT: path.join(fixtureDirectory, 'course-media'),
    TRUST_PROXY: 'false',
    PORT: '3000',
  });
  ({ db: database } = await import('../../server/db.js'));
  ({ pageQuery, errorHandler } = await import('../../server/http.js'));

  const app = express();
  app.get('/api/paged', (req, res) => res.json({ page: pageQuery(req.query.page) }));
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
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function apiUrl(query = '') {
  const address = server.address();
  assert(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}/api/paged${query}`;
}

test('page query defaults missing values and clamps valid out-of-range requests', () => {
  assert.equal(pageQuery(undefined), 1);
  assert.equal(pageQuery(' 2 '), 2);
  assert.equal(pageQuery('100001'), 100_000);
  assert.equal(pageQuery('21', 20), 20);
});

test('page query rejects repeated, malformed, and non-positive values', () => {
  for (const value of [
    ['1', '2'], '', '0', '-1', '1.5', '1e2', 'NaN', '9007199254740992',
  ]) {
    assert.throws(() => pageQuery(value), (error) => (
      error.status === 400 && error.code === 'validation_error'
    ), `expected ${JSON.stringify(value)} to be rejected`);
  }
});

test('Express page routes return a structured validation error instead of page one for malformed input', async () => {
  const invalidResponse = await fetch(apiUrl('?page=abc'));
  assert.equal(invalidResponse.status, 400);
  assert.deepEqual(await invalidResponse.json(), {
    error: 'Page must be a positive integer.',
    code: 'validation_error',
  });

  const omittedResponse = await fetch(apiUrl());
  assert.equal(omittedResponse.status, 200);
  assert.deepEqual(await omittedResponse.json(), { page: 1 });
});
