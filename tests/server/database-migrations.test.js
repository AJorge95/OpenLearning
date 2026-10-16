import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import Database from 'better-sqlite3';

const fixturePrefix = 'openlearning-database-migrations-';
const expectedLatestMigrationVersion = 42;
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
  const accountManagementIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'users'").all().map(({ name }) => name));
  assert.ok(accountManagementIndexes.has('users_registration_management_order'));
  const approvedAccountListPlan = database.prepare(`EXPLAIN QUERY PLAN
    SELECT id, username, email, role, disabled, registration_status, created_at FROM users
    WHERE registration_status = ?
    ORDER BY CASE role WHEN 'admin' THEN 1 WHEN 'moderator' THEN 2 ELSE 3 END, username COLLATE NOCASE
    LIMIT ? OFFSET ?`).all('approved', 50, 0).map(({ detail }) => detail).join('\n');
  assert.match(approvedAccountListPlan, /USING INDEX users_registration_management_order/);
  assert.doesNotMatch(approvedAccountListPlan, /TEMP B-TREE/);
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

test('the exam migration preserves existing module quizzes, questions, choices, and attempts', () => {
  const legacyDatabase = new Database(':memory:');
  legacyDatabase.pragma('foreign_keys = ON');
  try {
    legacyDatabase.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO schema_migrations (version) VALUES (39);
      CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE courses (id TEXT PRIMARY KEY);
      CREATE TABLE course_modules (id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE);
      CREATE TABLE quizzes (
        id TEXT PRIMARY KEY, module_id TEXT NOT NULL UNIQUE REFERENCES course_modules(id) ON DELETE CASCADE,
        title TEXT NOT NULL DEFAULT 'Module quiz', pass_mark INTEGER NOT NULL DEFAULT 70,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        stable_id TEXT
      );
      CREATE TABLE quiz_questions (
        id TEXT PRIMARY KEY, quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
        prompt TEXT NOT NULL, explanation TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE quiz_choices (
        id TEXT PRIMARY KEY, question_id TEXT NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
        choice_text TEXT NOT NULL, is_correct INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE quiz_attempts (
        id TEXT PRIMARY KEY, quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, score INTEGER NOT NULL,
        passed INTEGER NOT NULL, answers_json TEXT NOT NULL, question_snapshot_json TEXT NOT NULL,
        submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO users (id) VALUES ('legacy-learner');
      INSERT INTO courses (id) VALUES ('legacy-course');
      INSERT INTO course_modules (id, course_id) VALUES ('legacy-module', 'legacy-course');
      INSERT INTO quizzes (id, module_id, title, pass_mark, stable_id)
        VALUES ('legacy-quiz', 'legacy-module', 'Preserved module quiz', 80, 'stable-legacy-quiz');
      INSERT INTO quiz_questions (id, quiz_id, prompt, explanation, position)
        VALUES ('legacy-question', 'legacy-quiz', 'Preserved question?', 'Saved explanation', 0);
      INSERT INTO quiz_choices (id, question_id, choice_text, is_correct, position) VALUES
        ('legacy-choice-1', 'legacy-question', 'Correct', 1, 0),
        ('legacy-choice-2', 'legacy-question', 'Incorrect', 0, 1);
      INSERT INTO quiz_attempts (id, quiz_id, user_id, score, passed, answers_json, question_snapshot_json)
        VALUES ('legacy-attempt', 'legacy-quiz', 'legacy-learner', 100, 1, '{"legacy-question":"legacy-choice-1"}', '[]');
    `);

    migrateDatabase(legacyDatabase);

    assert.deepEqual(legacyDatabase.prepare('SELECT id, module_id, course_id, title, pass_mark, questions_per_attempt, required_for_completion, stable_id FROM quizzes').get(), {
      id: 'legacy-quiz', module_id: 'legacy-module', course_id: null, title: 'Preserved module quiz', pass_mark: 80,
      questions_per_attempt: 0, required_for_completion: 1, stable_id: 'stable-legacy-quiz',
    });
    assert.deepEqual(legacyDatabase.prepare('SELECT id, quiz_id, prompt, explanation, position FROM quiz_questions').get(), {
      id: 'legacy-question', quiz_id: 'legacy-quiz', prompt: 'Preserved question?', explanation: 'Saved explanation', position: 0,
    });
    assert.equal(legacyDatabase.prepare('SELECT COUNT(*) AS count FROM quiz_choices WHERE question_id = ?').get('legacy-question').count, 2);
    assert.equal(legacyDatabase.prepare('SELECT id, score, passed FROM quiz_attempts').get().id, 'legacy-attempt');
    assert.equal(legacyDatabase.prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1').get().version, expectedLatestMigrationVersion);
    assert.deepEqual(legacyDatabase.pragma('foreign_key_check'), []);
  } finally {
    legacyDatabase.close();
  }
});

test('the course-group migration coalesces legacy rows and recreates association indexes', () => {
  const legacyDatabase = new Database(':memory:');
  legacyDatabase.pragma('foreign_keys = ON');
  try {
    legacyDatabase.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO schema_migrations (version) VALUES (41);
      CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE courses (id TEXT PRIMARY KEY);
      CREATE TABLE course_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO users (id) VALUES ('legacy-admin');
      INSERT INTO courses (id) VALUES ('legacy-course-1'), ('legacy-course-2');
      INSERT INTO course_groups (id, name, description, course_id, created_by, created_at) VALUES
        ('legacy-group-1', 'Onboarding', 'First description', 'legacy-course-1', 'legacy-admin', '2026-10-01 09:00:00'),
        ('legacy-group-2', 'onboarding', 'Second description', 'legacy-course-2', 'legacy-admin', '2026-10-02 09:00:00');
    `);

    migrateDatabase(legacyDatabase);

    assert.deepEqual(legacyDatabase.prepare('SELECT id, name, description, created_by FROM course_groups').all(), [
      { id: 'legacy-group-1', name: 'Onboarding', description: 'First description\n\nSecond description', created_by: 'legacy-admin' },
    ]);
    assert.deepEqual(legacyDatabase.prepare('SELECT group_id, course_id, added_by, added_at FROM course_group_courses ORDER BY course_id').all(), [
      { group_id: 'legacy-group-1', course_id: 'legacy-course-1', added_by: 'legacy-admin', added_at: '2026-10-01 09:00:00' },
      { group_id: 'legacy-group-1', course_id: 'legacy-course-2', added_by: 'legacy-admin', added_at: '2026-10-02 09:00:00' },
    ]);
    assert.deepEqual(new Set(legacyDatabase.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('course_groups', 'course_group_courses')").all().map(({ name }) => name)), new Set(['course_groups', 'course_group_courses']));
    assert.deepEqual(new Set(legacyDatabase.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'course_groups'").all().map(({ name }) => name)), new Set(['sqlite_autoindex_course_groups_1', 'course_groups_name', 'course_groups_created']));
    assert.deepEqual(new Set(legacyDatabase.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'course_group_courses'").all().map(({ name }) => name)), new Set(['course_group_courses_course', 'sqlite_autoindex_course_group_courses_1']));
    assert.equal(legacyDatabase.prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1').get().version, expectedLatestMigrationVersion);
    assert.deepEqual(legacyDatabase.pragma('foreign_key_check'), []);
  } finally {
    legacyDatabase.close();
  }
});
