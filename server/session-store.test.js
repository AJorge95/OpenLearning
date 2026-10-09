import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { SQLiteSessionStore, invalidateUserSessions } from './session-store.js';

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

function callStore(store, method, ...args) {
  return new Promise((resolve, reject) => {
    store[method](...args, (error, value) => error ? reject(error) : resolve(value));
  });
}

test('session set, get, and touch preserve expiry and user ownership', async () => {
  const database = createDatabase();
  const store = new SQLiteSessionStore(database);
  try {
    const firstExpiry = new Date(Date.now() + 60_000);
    const sessionData = { userId: 'learner-1', cookie: { expires: firstExpiry.toISOString() } };
    await callStore(store, 'set', 'session-1', sessionData);

    const saved = database.prepare('SELECT expires_at, user_id FROM sessions WHERE sid = ?').get('session-1');
    assert.deepEqual(saved, { expires_at: firstExpiry.getTime(), user_id: 'learner-1' });
    assert.deepEqual(await callStore(store, 'get', 'session-1'), sessionData);

    const extendedExpiry = new Date(Date.now() + 120_000);
    await callStore(store, 'touch', 'session-1', { userId: 'learner-1', cookie: { expires: extendedExpiry.toISOString() } });
    const touched = database.prepare('SELECT expires_at, user_id FROM sessions WHERE sid = ?').get('session-1');
    assert.deepEqual(touched, { expires_at: extendedExpiry.getTime(), user_id: 'learner-1' });
  } finally {
    database.close();
  }
});

test('startup and reads discard expired or malformed sessions', async () => {
  const database = createDatabase();
  try {
    const insert = database.prepare('INSERT INTO sessions (sid, session_data, expires_at, user_id) VALUES (?, ?, ?, ?)');
    insert.run('expired', JSON.stringify({ userId: 'learner-1' }), Date.now() - 1, 'learner-1');
    insert.run('broken-json', '{', Date.now() + 60_000, null);
    insert.run('array-session', '[]', Date.now() + 60_000, null);
    const store = new SQLiteSessionStore(database);

    assert.equal(database.prepare('SELECT 1 FROM sessions WHERE sid = ?').get('expired'), undefined);
    assert.equal(await callStore(store, 'get', 'broken-json'), null);
    assert.equal(await callStore(store, 'get', 'array-session'), null);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 0);
  } finally {
    database.close();
  }
});

test('session revocation preserves the current session and other users', () => {
  const database = createDatabase();
  try {
    const insert = database.prepare('INSERT INTO sessions (sid, session_data, expires_at, user_id) VALUES (?, ?, ?, ?)');
    insert.run('current', '{}', Date.now() + 60_000, 'user-1');
    insert.run('other-user-session', '{}', Date.now() + 60_000, 'user-2');
    insert.run('old-user-session', '{}', Date.now() + 60_000, 'user-1');

    assert.equal(invalidateUserSessions(database, 'user-1', 'current'), 1);
    assert.equal(database.prepare('SELECT sid FROM sessions WHERE sid = ?').get('current')?.sid, 'current');
    assert.equal(database.prepare('SELECT sid FROM sessions WHERE sid = ?').get('other-user-session')?.sid, 'other-user-session');
    assert.equal(invalidateUserSessions(database, 'user-1'), 1);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 1);
  } finally {
    database.close();
  }
});
