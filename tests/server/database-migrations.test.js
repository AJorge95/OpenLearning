import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import Database from 'better-sqlite3';

const fixturePrefix = 'openlearning-database-migrations-';
const expectedLatestMigrationVersion = 38;
const configEnvironment = {
  NODE_ENV: 'test',
  DATA_DIR: '',
  DB_PATH: '',
  MEDIA_ROOT: '',
  SESSION_SECRET: 'isolated-database-migration-test-secret',
  SETUP_TOKEN: '',
  TRUST_PROXY: 'false',
  PORT: '6173',
};
const previousEnvironment = new Map(Object.keys(configEnvironment).map((key) => [key, process.env[key]]));
let fixtureDirectory;
let database;
let migrateDatabase;

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
    ...configEnvironment,
    DATA_DIR: fixtureDirectory,
    DB_PATH: path.join(fixtureDirectory, 'openlearning.sqlite'),
    MEDIA_ROOT: path.join(fixtureDirectory, 'course-media'),
  });

  // Import only after isolating paths because db.js opens and migrates its configured database on import.
  ({ db: database, migrateDatabase } = await import('../../server/db.js'));
});

after(() => {
  if (database?.open) database.close();
  removeFixtureDirectory(fixtureDirectory);
  for (const [key, value] of previousEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('fresh startup applies every migration and can be rerun without changing the schema', () => {
  const versions = database.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(({ version }) => version);
  assert.deepEqual(versions, Array.from({ length: expectedLatestMigrationVersion }, (_value, index) => index + 1));

  const tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(({ name }) => name));
  for (const table of [
    'app_settings',
    'users',
    'courses',
    'course_versions',
    'lesson_watch_progress',
    'lesson_watch_telemetry',
    'user_registration_field_values',
    'backup_jobs',
    'backup_runs',
  ]) {
    assert.ok(tables.has(table), `expected migrated table ${table}`);
  }
  const backupRunIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'backup_runs'").all().map(({ name }) => name));
  assert.ok(backupRunIndexes.has('backup_runs_job_created'));
  const latestRunPlan = database.prepare(`EXPLAIN QUERY PLAN
    SELECT candidate.* FROM backup_runs AS candidate
    WHERE NOT EXISTS (
      SELECT 1 FROM backup_runs AS newer
      WHERE newer.job_id = candidate.job_id
        AND (newer.created_at > candidate.created_at
          OR (newer.created_at = candidate.created_at AND newer.id > candidate.id))
    )`).all().map(({ detail }) => detail).join('\n');
  assert.match(latestRunPlan, /USING COVERING INDEX backup_runs_job_created/);
  const courseLearningStateIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'course_learning_state'").all().map(({ name }) => name));
  assert.ok(courseLearningStateIndexes.has('course_learning_state_course_user'));
  const courseStatePlan = database.prepare(`EXPLAIN QUERY PLAN
    SELECT user_id FROM course_learning_state WHERE course_id = ?`).all('course-id').map(({ detail }) => detail).join('\n');
  assert.match(courseStatePlan, /USING COVERING INDEX course_learning_state_course_user/);
  assert.deepEqual(database.prepare('SELECT key, value FROM app_settings ORDER BY key').all(), [
    { key: 'platform_name', value: '' },
    { key: 'registration_approval_required', value: '0' },
    { key: 'setup_complete', value: '0' },
  ]);
  assert.deepEqual(database.pragma('foreign_key_check'), []);

  migrateDatabase(database);
  assert.deepEqual(database.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(({ version }) => version), versions);
  assert.deepEqual(database.pragma('foreign_key_check'), []);
});

test('startup rejects a database from a newer schema before adding application tables', () => {
  const futureDatabase = new Database(':memory:');
  try {
    futureDatabase.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO schema_migrations (version) VALUES (${expectedLatestMigrationVersion + 1});
    `);

    assert.throws(
      () => migrateDatabase(futureDatabase),
      new RegExp(`Database schema version ${expectedLatestMigrationVersion + 1} is newer than this application supports`),
    );
    assert.deepEqual(futureDatabase.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all(), [
      { name: 'schema_migrations' },
    ]);
    assert.deepEqual(futureDatabase.prepare('SELECT version FROM schema_migrations').all(), [
      { version: expectedLatestMigrationVersion + 1 },
    ]);
  } finally {
    futureDatabase.close();
  }
});
