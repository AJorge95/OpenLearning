import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import express from 'express';
import test from 'node:test';
import { mountAuthenticationRateLimits } from '../../server/auth-rate-limit-mount.js';

test('authentication rate limits apply only to their POST endpoints', async () => {
  const calls = { login: 0, account: 0 };
  const loginLimiter = (_req, _res, next) => { calls.login += 1; next(); };
  const accountLimiter = (_req, _res, next) => { calls.account += 1; next(); };
  const app = express();

  mountAuthenticationRateLimits(app, loginLimiter, accountLimiter);
  app.get('/api/setup/status', (_req, res) => res.sendStatus(200));
  app.post('/api/setup', (_req, res) => res.sendStatus(201));
  app.post('/api/auth/register', (_req, res) => res.sendStatus(201));
  app.post('/api/auth/login', (_req, res) => res.sendStatus(401));
  app.use((_req, res) => res.sendStatus(404));

  const server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const endpoint = `http://127.0.0.1:${address.port}`;
  const request = (method, path) => fetch(`${endpoint}${path}`, { method, headers: { connection: 'close' } });

  try {
    for (let index = 0; index < 15; index += 1) {
      assert.equal((await request('GET', '/api/setup/status')).status, 200);
    }
    assert.equal((await request('GET', '/api/auth/login')).status, 404);
    assert.equal((await request('GET', '/api/auth/register')).status, 404);
    assert.deepEqual(calls, { login: 0, account: 0 });

    assert.equal((await request('POST', '/api/setup')).status, 201);
    assert.equal((await request('POST', '/api/auth/register')).status, 201);
    assert.equal((await request('POST', '/api/auth/login')).status, 401);
    assert.deepEqual(calls, { login: 1, account: 2 });
  } finally {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
  }
});
