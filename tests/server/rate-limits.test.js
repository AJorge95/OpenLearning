import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import express from 'express';
import test from 'node:test';
import { adminPasswordResetLimiter, learnerCommentLimiter, passwordChangeLimiter } from '../../server/rate-limits.js';

test('administrator password reset throttling is bounded per authenticated admin', async () => {
  const primaryAdmin = `admin-password-limit-test-${randomUUID()}`;
  const secondAdmin = `admin-password-limit-test-${randomUUID()}`;
  const primaryKey = `user:${primaryAdmin}`;
  const secondKey = `user:${secondAdmin}`;
  adminPasswordResetLimiter.resetKey(primaryKey);
  adminPasswordResetLimiter.resetKey(secondKey);

  const app = express();
  app.use((req, _res, next) => {
    req.currentUser = { id: req.get('x-test-user'), role: 'admin' };
    next();
  });
  app.put('/admin/users/:userId/password', adminPasswordResetLimiter, (_req, res) => res.sendStatus(204));

  const server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const endpoint = `http://127.0.0.1:${address.port}/admin/users/target/password`;
  const resetPassword = (adminId) => fetch(endpoint, {
    method: 'PUT',
    headers: { 'x-test-user': adminId, connection: 'close' },
  });

  try {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await resetPassword(primaryAdmin);
      assert.equal(response.status, 204);
    }

    const limitedResponse = await resetPassword(primaryAdmin);
    assert.equal(limitedResponse.status, 429);
    assert.deepEqual(await limitedResponse.json(), {
      error: 'Too many administrator password resets. Please wait before trying again.',
      code: 'rate_limited',
    });

    const independentResponse = await resetPassword(secondAdmin);
    assert.equal(independentResponse.status, 204);
  } finally {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
    adminPasswordResetLimiter.resetKey(primaryKey);
    adminPasswordResetLimiter.resetKey(secondKey);
  }
});

test('password change throttling is bounded per authenticated user', async () => {
  const primaryUser = `password-limit-test-${randomUUID()}`;
  const secondUser = `password-limit-test-${randomUUID()}`;
  const primaryKey = `user:${primaryUser}`;
  const secondKey = `user:${secondUser}`;
  passwordChangeLimiter.resetKey(primaryKey);
  passwordChangeLimiter.resetKey(secondKey);

  const app = express();
  app.use((req, _res, next) => {
    req.currentUser = { id: req.get('x-test-user') };
    next();
  });
  app.put('/password', passwordChangeLimiter, (_req, res) => res.sendStatus(204));

  const server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const endpoint = `http://127.0.0.1:${address.port}/password`;
  const changePassword = (userId) => fetch(endpoint, {
    method: 'PUT',
    headers: { 'x-test-user': userId, connection: 'close' },
  });

  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await changePassword(primaryUser);
      assert.equal(response.status, 204);
    }

    const limitedResponse = await changePassword(primaryUser);
    assert.equal(limitedResponse.status, 429);
    assert.deepEqual(await limitedResponse.json(), {
      error: 'Too many password change attempts. Please wait a few minutes before trying again.',
      code: 'rate_limited',
    });

    const independentResponse = await changePassword(secondUser);
    assert.equal(independentResponse.status, 204);
  } finally {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
    passwordChangeLimiter.resetKey(primaryKey);
    passwordChangeLimiter.resetKey(secondKey);
  }
});

test('learner comment throttling returns a retryable error and is isolated per user', async () => {
  const primaryUser = `rate-limit-test-${randomUUID()}`;
  const secondUser = `rate-limit-test-${randomUUID()}`;
  const primaryKey = `user:${primaryUser}`;
  const secondKey = `user:${secondUser}`;
  learnerCommentLimiter.resetKey(primaryKey);
  learnerCommentLimiter.resetKey(secondKey);

  const app = express();
  app.use((req, _res, next) => {
    req.currentUser = { id: req.get('x-test-user') };
    next();
  });
  app.post('/comments', learnerCommentLimiter, (_req, res) => res.sendStatus(204));

  const server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const endpoint = `http://127.0.0.1:${address.port}/comments`;
  const postComment = (userId) => fetch(endpoint, {
    method: 'POST',
    headers: { 'x-test-user': userId, connection: 'close' },
  });

  try {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await postComment(primaryUser);
      assert.equal(response.status, 204);
    }

    const limitedResponse = await postComment(primaryUser);
    assert.equal(limitedResponse.status, 429);
    assert.deepEqual(await limitedResponse.json(), {
      error: 'You are posting comments too quickly. Please wait a few minutes and try again.',
      code: 'rate_limited',
    });

    const independentResponse = await postComment(secondUser);
    assert.equal(independentResponse.status, 204);
  } finally {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
    learnerCommentLimiter.resetKey(primaryKey);
    learnerCommentLimiter.resetKey(secondKey);
  }
});
