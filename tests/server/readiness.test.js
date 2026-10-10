import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import test from 'node:test';
import { isReadyToServe } from '../../server/readiness.js';

function createReadinessDatabase() {
  const database = new Database(':memory:');
  database.exec(`
    CREATE TABLE schema_migrations (version INTEGER NOT NULL);
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE users (id TEXT PRIMARY KEY, role TEXT NOT NULL);
    INSERT INTO schema_migrations (version) VALUES (1);
    INSERT INTO app_settings (key, value) VALUES ('setup_complete', '0');
  `);
  return database;
}

test('readiness requires a migrated schema and completed administrator setup', () => {
  const database = createReadinessDatabase();
  try {
    assert.equal(isReadyToServe(database, false), false);
    database.prepare("UPDATE app_settings SET value = '1' WHERE key = 'setup_complete'").run();
    assert.equal(isReadyToServe(database, false), false);
    database.prepare("INSERT INTO users (id, role) VALUES ('admin-1', 'admin')").run();
    assert.equal(isReadyToServe(database, false), true);
    database.prepare("UPDATE app_settings SET value = '0' WHERE key = 'setup_complete'").run();
    assert.equal(isReadyToServe(database, false), false);
    database.prepare("UPDATE app_settings SET value = '1' WHERE key = 'setup_complete'").run();
    database.prepare("DELETE FROM app_settings WHERE key = 'setup_complete'").run();
    assert.equal(isReadyToServe(database, false), false);
    database.prepare('DELETE FROM schema_migrations').run();
    assert.equal(isReadyToServe(database, false), false);
  } finally {
    database.close();
  }
});

test('readiness immediately fails during shutdown without querying SQLite', () => {
  const database = { prepare() { assert.fail('Readiness should short-circuit while shutting down.'); } };
  assert.equal(isReadyToServe(database, true), false);
});

test('readiness returns false when its database checks fail', () => {
  const database = new Database(':memory:');
  try {
    assert.equal(isReadyToServe(database, false), false);
  } finally {
    database.close();
  }
});
