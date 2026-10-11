import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { SQLiteSessionStore, invalidateUserSessions } from '../../server/session-store.js';

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
    store.close();
    database.close();
  }
});

test('session store callbacks that throw are invoked only once', () => {
  const database = createDatabase();
  const store = new SQLiteSessionStore(database);
  const operations = [
    ['get', (callback) => store.get('missing', callback)],
    ['set', (callback) => store.set('session-callback', { cookie: {} }, callback)],
    ['touch', (callback) => store.touch('session-callback', { cookie: {} }, callback)],
    ['destroy', (callback) => store.destroy('session-callback', callback)],
    ['clear', (callback) => store.clear(callback)],
  ];

  try {
    for (const [name, operation] of operations) {
      const callbackError = new Error(`${name} callback failed`);
      let callbackCalls = 0;

      assert.throws(() => operation(() => {
        callbackCalls += 1;
        throw callbackError;
      }), (error) => error === callbackError);
      assert.equal(callbackCalls, 1, `${name} must not report a callback exception as a store error`);
    }
  } finally {
    store.close();
    database.close();
  }
});

test('session store reports database errors through each callback only once', () => {
  const database = createDatabase();
  const store = new SQLiteSessionStore(database);
  const operations = [
    ['get', (callback) => store.get('session-db-error', callback)],
    ['set', (callback) => store.set('session-db-error', { cookie: {} }, callback)],
    ['touch', (callback) => store.touch('session-db-error', { cookie: {} }, callback)],
    ['destroy', (callback) => store.destroy('session-db-error', callback)],
    ['clear', (callback) => store.clear(callback)],
  ];
  database.exec('DROP TABLE sessions');

  try {
    for (const [name, operation] of operations) {
      let callbackCalls = 0;
      let receivedError;

      operation((error) => {
        callbackCalls += 1;
        receivedError = error;
      });
      assert.equal(callbackCalls, 1, `${name} must report the database failure exactly once`);
      assert.ok(receivedError instanceof Error, `${name} must expose the database failure`);
    }
  } finally {
    store.close();
    database.close();
  }
});

test('startup and reads discard expired or malformed sessions', async () => {
  const database = createDatabase();
  let store;
  try {
    const insert = database.prepare('INSERT INTO sessions (sid, session_data, expires_at, user_id) VALUES (?, ?, ?, ?)');
    insert.run('expired', JSON.stringify({ userId: 'learner-1' }), Date.now() - 1, 'learner-1');
    insert.run('broken-json', '{', Date.now() + 60_000, null);
    insert.run('array-session', '[]', Date.now() + 60_000, null);
    store = new SQLiteSessionStore(database);

    assert.equal(database.prepare('SELECT 1 FROM sessions WHERE sid = ?').get('expired'), undefined);
    assert.equal(await callStore(store, 'get', 'broken-json'), null);
    assert.equal(await callStore(store, 'get', 'array-session'), null);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 0);
  } finally {
    store?.close();
    database.close();
  }
});

test('startup keeps the session store available and reports expired-session cleanup failures', () => {
  const database = createDatabase();
  const failures = [];
  database.prepare('INSERT INTO sessions (sid, session_data, expires_at) VALUES (?, ?, ?)')
    .run('expired-cleanup-failure', '{}', Date.now() - 1);
  database.exec(`CREATE TRIGGER reject_expired_session_cleanup BEFORE DELETE ON sessions
    WHEN OLD.sid = 'expired-cleanup-failure' BEGIN SELECT RAISE(FAIL, 'cleanup unavailable'); END`);

  let store;
  try {
    assert.doesNotThrow(() => {
      store = new SQLiteSessionStore(database, { onCleanupError: (error) => failures.push(error) });
    });
    assert.equal(failures.length, 1);
    assert.match(failures[0].message, /cleanup unavailable/);
    assert.equal(database.prepare('SELECT 1 FROM sessions WHERE sid = ?').get('expired-cleanup-failure') !== undefined, true);
  } finally {
    store?.close();
    database.close();
  }
});

test('a failing cleanup error reporter falls back without aborting store startup', () => {
  const database = createDatabase();
  database.prepare('INSERT INTO sessions (sid, session_data, expires_at) VALUES (?, ?, ?)')
    .run('expired-cleanup-logger-failure', '{}', Date.now() - 1);
  database.exec(`CREATE TRIGGER reject_expired_session_cleanup BEFORE DELETE ON sessions
    WHEN OLD.sid = 'expired-cleanup-logger-failure' BEGIN SELECT RAISE(FAIL, 'cleanup unavailable'); END`);
  const originalConsoleError = console.error;
  const reports = [];
  console.error = (...args) => reports.push(args);

  let store;
  try {
    assert.doesNotThrow(() => {
      store = new SQLiteSessionStore(database, { onCleanupError: () => { throw new Error('logger unavailable'); } });
    });
    assert.equal(reports.length, 1);
    assert.match(String(reports[0][0]), /Unable to report expired-session cleanup failure/);
    assert.equal(database.prepare('SELECT 1 FROM sessions WHERE sid = ?').get('expired-cleanup-logger-failure') !== undefined, true);
  } finally {
    console.error = originalConsoleError;
    store?.close();
    database.close();
  }
});

test('closing the session store stops and clears its expiry timer', () => {
  const database = createDatabase();
  const store = new SQLiteSessionStore(database);
  try {
    assert.ok(store.cleanupTimer);
    store.close();
    assert.equal(store.cleanupTimer, null);
    assert.doesNotThrow(() => store.close(), 'closing the store more than once should be safe');
  } finally {
    store.close();
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
