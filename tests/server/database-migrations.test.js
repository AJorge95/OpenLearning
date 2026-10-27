import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import Database from 'better-sqlite3';

const fixturePrefix = 'openlearning-database-migrations-';
const expectedLatestMigrationVersion = 43;
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

test('the exam migration tolerates historical fixtures without a complete quiz schema', () => {
  const sparseDatabase = new Database(':memory:');
  sparseDatabase.pragma('foreign_keys = ON');
  try {
    sparseDatabase.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO schema_migrations (version) VALUES (40);
      CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE courses (id TEXT PRIMARY KEY);
      CREATE TABLE quizzes (id TEXT PRIMARY KEY);
    `);

    migrateDatabase(sparseDatabase);

    assert.equal(sparseDatabase.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version, expectedLatestMigrationVersion);
    assert.deepEqual(sparseDatabase.prepare('PRAGMA table_info(quizzes)').all().map(({ name }) => name), ['id']);
    assert.equal(sparseDatabase.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'quiz_attempt_sessions'").get(), undefined);
    assert.deepEqual(sparseDatabase.pragma('foreign_key_check'), []);
  } finally {
    sparseDatabase.close();
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
test('watch timing migration preserves completed lessons, quiz passes, certificates, and learner checkpoints', async () => {
  // The previous release differs only by the new advisory watch-credit column.
  // Build a populated schema-42 snapshot so cascading data loss is observable.
  const snapshotPath = path.join(fixtureDirectory, 'populated-schema-42.sqlite');
  await database.backup(snapshotPath);
  const populatedDatabase = new Database(snapshotPath);
  populatedDatabase.pragma('foreign_keys = ON');
  try {
    populatedDatabase.exec(`
      ALTER TABLE lesson_watch_progress DROP COLUMN pending_credit_seconds;
      DELETE FROM schema_migrations WHERE version = 43;
      INSERT INTO users (id, username, email, password_hash, role) VALUES
        ('compat-admin', 'compat_admin', 'admin@example.invalid', 'unused', 'admin'),
        ('compat-learner', 'compat_learner', 'learner@example.invalid', 'unused', 'learner');
      INSERT INTO courses (id, title, status, created_by, updated_by)
        VALUES ('compat-course', 'Existing course', 'published', 'compat-admin', 'compat-admin');
      INSERT INTO course_modules (id, course_id, title) VALUES ('compat-module', 'compat-course', 'Module');
      INSERT INTO lessons (id, module_id, title, stable_id, position) VALUES
        ('compat-lesson', 'compat-module', 'Completed lesson', 'compat-lesson', 0),
        ('compat-video', 'compat-module', 'Partially watched video', 'compat-video', 1);
      INSERT INTO course_versions (id, course_id, storage_course_id, version_number, published_by)
        VALUES ('compat-version', 'compat-course', 'compat-course', 1, 'compat-admin');
      INSERT INTO enrollments (id, course_id, user_id) VALUES ('compat-enrollment', 'compat-course', 'compat-learner');
      INSERT INTO lesson_progress (user_id, lesson_id, completed_at)
        VALUES ('compat-learner', 'compat-lesson', '2026-10-01 10:00:00');
      INSERT INTO quizzes (id, module_id, title, stable_id) VALUES ('compat-quiz', 'compat-module', 'Passed quiz', 'compat-quiz');
      INSERT INTO quiz_attempts (id, quiz_id, user_id, score, passed, answers_json, question_snapshot_json, submitted_at)
        VALUES ('compat-attempt', 'compat-quiz', 'compat-learner', 100, 1, '{}', '[]', '2026-10-01 11:00:00');
      INSERT INTO course_learning_state (user_id, course_id, deadline_at)
        VALUES ('compat-learner', 'compat-course', '2026-11-01 00:00:00');
      INSERT INTO course_certificates
        (id, certificate_code, user_id, course_id, course_version_id, recipient_name, course_title, platform_name, issued_at)
        VALUES ('compat-certificate', 'COMPAT-001', 'compat-learner', 'compat-course', 'compat-version',
          'Existing learner', 'Existing course', 'OpenLearning', '2026-10-01 12:00:00');
      INSERT INTO lesson_watch_progress
        (user_id, lesson_id, watched_until_seconds, duration_seconds, last_position_seconds, last_heartbeat_at)
        VALUES ('compat-learner', 'compat-video', 2011, 4724.544, 1981, 12345);
    `);
    const preservedTables = ['users', 'courses', 'course_versions', 'enrollments', 'lessons', 'lesson_progress',
      'quiz_attempts', 'course_learning_state', 'course_certificates'];
    const before = preservedTables.map(table => populatedDatabase.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
    migrateDatabase(populatedDatabase);
    migrateDatabase(populatedDatabase);
    assert.deepEqual(preservedTables.map(table => populatedDatabase.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()), before);
    assert.deepEqual(populatedDatabase.pragma('foreign_key_check'), []);
    assert.equal(populatedDatabase.pragma('quick_check', { simple: true }), 'ok');
    assert.equal(populatedDatabase.prepare('SELECT watched_until_seconds FROM lesson_watch_progress').get().watched_until_seconds, 2011);
    assert.equal(populatedDatabase.prepare('SELECT pending_credit_seconds FROM lesson_watch_progress').get().pending_credit_seconds, 0);
  } finally {
    populatedDatabase.close();
  }
});

test('watch timing migration preserves sparse historical learner checkpoints', () => {
  const legacyDatabase = new Database(':memory:');
  try {
    legacyDatabase.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO schema_migrations (version) VALUES (42);
      CREATE TABLE lesson_watch_progress (
        user_id TEXT NOT NULL, lesson_id TEXT NOT NULL, watched_until_seconds REAL NOT NULL,
        duration_seconds REAL NOT NULL, last_position_seconds REAL NOT NULL, last_heartbeat_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, lesson_id)
      );
      INSERT INTO lesson_watch_progress VALUES ('learner', 'lesson', 2011, 4724.544, 1981, 12345);
    `);
    migrateDatabase(legacyDatabase);
    migrateDatabase(legacyDatabase);
    assert.deepEqual(legacyDatabase.prepare('SELECT * FROM lesson_watch_progress').get(), {
      user_id: 'learner', lesson_id: 'lesson', watched_until_seconds: 2011,
      duration_seconds: 4724.544, last_position_seconds: 1981, last_heartbeat_at: 12345, pending_credit_seconds: 0,
    });
    assert.throws(() => legacyDatabase.exec('UPDATE lesson_watch_progress SET pending_credit_seconds = 9'), /CHECK constraint/);
  } finally {
    legacyDatabase.close();
  }
});
