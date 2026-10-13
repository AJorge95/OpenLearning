import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import session from 'express-session';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { SQLiteSessionStore } from '../../server/session-store.js';

function createDatabase() {
  const database = new Database(':memory:');
  database.exec(`
    CREATE TABLE sessions (
      sid TEXT PRIMARY KEY,
      session_data TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      user_id TEXT
    );
  `);
  return database;
}

test('anonymous CSRF bootstrap does not persist a session row', async () => {
  const database = createDatabase();
  const store = new SQLiteSessionStore(database);
  const { csrfMiddleware, errorHandler, newCsrfToken } = await import('../../server/http.js');
  const app = express();
  app.use(session({ secret: 'csrf-session-growth-test-secret', store, resave: false, saveUninitialized: false }));
  app.get('/api/csrf', (req, res) => res.json({ token: newCsrfToken(req) }));
  app.use('/api', csrfMiddleware);
  app.post('/api/test-write', (_req, res) => res.status(204).end());
  app.use(errorHandler);
  const server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const endpoint = `http://127.0.0.1:${address.port}`;

  try {
    const firstResponse = await fetch(`${endpoint}/api/csrf`);
    const first = await firstResponse.json();
    const secondResponse = await fetch(`${endpoint}/api/csrf`);
    const second = await secondResponse.json();

    assert.equal(firstResponse.status, 200);
    assert.equal(secondResponse.status, 200);
    assert.notEqual(first.token, second.token);
    assert.equal(firstResponse.headers.get('set-cookie'), null);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 0);

    const writeResponse = await fetch(`${endpoint}/api/test-write`, {
      method: 'POST',
      headers: { 'x-csrf-token': first.token },
    });
    assert.equal(writeResponse.status, 204);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 0);

    const tamperedToken = `${first.token.slice(0, -1)}${first.token.endsWith('a') ? 'b' : 'a'}`;
    const rejectedResponse = await fetch(`${endpoint}/api/test-write`, {
      method: 'POST',
      headers: { 'x-csrf-token': tamperedToken },
    });
    assert.equal(rejectedResponse.status, 403);
    assert.deepEqual(await rejectedResponse.json(), {
      error: 'Refresh the page and try again.',
      code: 'csrf_invalid',
    });
  } finally {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
    store.close();
    database.close();
  }
});
