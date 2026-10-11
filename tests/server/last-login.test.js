import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import express from 'express';
import session from 'express-session';
import Database from 'better-sqlite3';
import { after, before, test } from 'node:test';

const isolatedConfig = {
  NODE_ENV: 'test',
  DATA_DIR: '',
  DB_PATH: '',
  MEDIA_ROOT: '',
  SESSION_SECRET: 'isolated-last-login-tests',
  SETUP_TOKEN: 'isolated-setup-bootstrap-token-with-at-least-32-chars',
  TRUST_PROXY: 'false',
  PORT: '3000',
  MAX_UPLOAD_BYTES: '2147483648',
  REQUEST_TIMEOUT_MS: '300000',
};
const previousConfig = new Map(Object.keys(isolatedConfig).map((key) => [key, process.env[key]]));
let fixtureDirectory;
let database;
let serverConfig;
let migrateDatabase;
let server;
let sessionStore;
let httpErrorHandler;

function createFixtureDirectory() {
  const tempBase = path.resolve(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(tempBase, 'openlearning-last-login-'));
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== tempBase
    || !path.basename(resolvedDirectory).startsWith('openlearning-last-login-')) {
    throw new Error('Refusing to use an unexpected temporary directory.');
  }
  return resolvedDirectory;
}

function removeFixtureDirectory(directory) {
  if (!directory) return;
  const tempBase = path.resolve(os.tmpdir());
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== tempBase
    || !path.basename(resolvedDirectory).startsWith('openlearning-last-login-')) {
    throw new Error('Refusing to remove an unexpected temporary directory.');
  }
  fs.rmSync(resolvedDirectory, { recursive: true, force: true });
}

before(async () => {
  fixtureDirectory = createFixtureDirectory();
  Object.assign(process.env, {
    ...isolatedConfig,
    DATA_DIR: fixtureDirectory,
    DB_PATH: path.join(fixtureDirectory, 'openlearning.sqlite'),
    MEDIA_ROOT: path.join(fixtureDirectory, 'course-media'),
  });

  ({ config: serverConfig } = await import('../../server/config.js'));
  ({ db: database, migrateDatabase } = await import('../../server/db.js'));
  const { authRouter } = await import('../../server/routes-auth.js');
  const { adminRouter } = await import('../../server/routes-admin.js');
  ({ errorHandler: httpErrorHandler } = await import('../../server/http.js'));

  const app = express();
  app.use(express.json());
  sessionStore = new session.MemoryStore();
  app.use(session({ secret: isolatedConfig.SESSION_SECRET, resave: false, saveUninitialized: false, store: sessionStore }));
  app.use((req, _res, next) => {
    req.currentUser = database.prepare('SELECT id, username, role, disabled FROM users WHERE username = ?')
      .get('admin_last_login');
    next();
  });
  app.use('/api', authRouter);
  app.use('/api/admin', adminRouter);
  app.use(httpErrorHandler);
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
  for (const [key, value] of previousConfig) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function apiUrl(pathname) {
  const address = server.address();
  assert(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}/api${pathname}`;
}

function storedSessionIds() {
  return new Promise((resolve, reject) => sessionStore.all((error, sessions) => {
    if (error) reject(error);
    else resolve(Object.keys(sessions || {}).sort());
  }));
}

test('request body parser failures return structured client errors', async () => {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb', parameterLimit: 2 }));
  app.post('/api/request-body-test', (_req, res) => res.json({ accepted: true }));
  app.use(httpErrorHandler);

  const parserServer = createServer(app);
  parserServer.listen(0, '127.0.0.1');
  await once(parserServer, 'listening');
  const address = parserServer.address();
  assert(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/api/request-body-test`;

  try {
    const malformedResponse = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"value":',
    });
    assert.equal(malformedResponse.status, 400);
    assert.deepEqual(await malformedResponse.json(), {
      error: 'Request body contains invalid JSON.',
      code: 'invalid_json',
    });

    const oversizedResponse = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'x'.repeat(1_048_576) }),
    });
    assert.equal(oversizedResponse.status, 413);
    assert.deepEqual(await oversizedResponse.json(), {
      error: 'Request body is too large.',
      code: 'payload_too_large',
    });

    const tooManyFieldsResponse = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'first=1&second=2&third=3',
    });
    assert.equal(tooManyFieldsResponse.status, 413);
    assert.deepEqual(await tooManyFieldsResponse.json(), {
      error: 'Request body contains too many form fields.',
      code: 'too_many_parameters',
    });

    const unsupportedCharsetResponse = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=shift_jis' },
      body: 'value=test',
    });
    assert.equal(unsupportedCharsetResponse.status, 415);
    assert.deepEqual(await unsupportedCharsetResponse.json(), {
      error: 'Request body uses an unsupported character set.',
      code: 'unsupported_charset',
    });
  } finally {
    const closed = once(parserServer, 'close');
    parserServer.close();
    parserServer.closeAllConnections();
    await closed;
  }
});

test('unhandled API errors still return a response when system logging fails', async () => {
  const originalConsoleError = console.error;
  let errorServer;
  console.error = () => {};
  try {
    database.exec(`CREATE TRIGGER fail_http_system_log BEFORE INSERT ON system_logs
      BEGIN SELECT RAISE(ABORT, 'simulated system log failure'); END`);
    const app = express();
    app.get('/api/unhandled-error-test', () => { throw new Error('simulated request failure'); });
    app.use(httpErrorHandler);
    errorServer = createServer(app);
    errorServer.listen(0, '127.0.0.1');
    await once(errorServer, 'listening');
    const address = errorServer.address();
    assert(address && typeof address !== 'string');

    const response = await fetch(`http://127.0.0.1:${address.port}/api/unhandled-error-test`);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: 'Something went wrong. Please try again.',
      code: 'internal_error',
    });
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM system_logs WHERE source = 'http' AND message = 'simulated request failure'").get().count, 0);
  } finally {
    if (errorServer?.listening) {
      const closed = once(errorServer, 'close');
      errorServer.close();
      errorServer.closeAllConnections();
      await closed;
    }
    database.exec('DROP TRIGGER IF EXISTS fail_http_system_log');
    console.error = originalConsoleError;
  }
});

test('migrations 16 to 33 preserve account history, course versions, captions, certificates, and lesson watch progress', () => {
  const migrationDb = new Database(':memory:');
  try {
    migrationDb.pragma('foreign_keys = ON');
    migrationDb.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO schema_migrations (version) VALUES (15);
      CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        actor_user_id TEXT,
        actor_username TEXT NOT NULL,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        summary TEXT NOT NULL,
        details_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX audit_logs_occurred ON audit_logs(occurred_at DESC, id DESC);
      CREATE INDEX audit_logs_action ON audit_logs(action, occurred_at DESC);
      CREATE TABLE system_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
        source TEXT NOT NULL,
        message TEXT NOT NULL,
        details_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX system_logs_occurred ON system_logs(occurred_at DESC, id DESC);
      CREATE INDEX system_logs_level ON system_logs(level, occurred_at DESC);
      CREATE TABLE courses (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL, updated_by TEXT, updated_at TEXT NOT NULL);
      CREATE TABLE media_files (
        id TEXT PRIMARY KEY,
        course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        original_name TEXT NOT NULL,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        media_kind TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE course_modules (id TEXT PRIMARY KEY);
      CREATE TABLE lessons (id TEXT PRIMARY KEY);
      CREATE TABLE quizzes (id TEXT PRIMARY KEY);
      CREATE TABLE lesson_captions (
        id TEXT PRIMARY KEY,
        lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
        language TEXT NOT NULL CHECK (length(language) BETWEEN 2 AND 35),
        label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
        file_name TEXT NOT NULL UNIQUE,
        original_name TEXT NOT NULL,
        byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 5242880),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(lesson_id, language)
      );
      CREATE TABLE course_certificates (
        id TEXT PRIMARY KEY,
        certificate_code TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        course_id TEXT REFERENCES courses(id) ON DELETE SET NULL,
        recipient_name TEXT NOT NULL,
        course_title TEXT NOT NULL,
        platform_name TEXT NOT NULL,
        issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, course_id)
      );
      INSERT INTO users (id) VALUES ('user-history'), ('user-registration'), ('user-never-signed-in');
      INSERT INTO audit_logs (actor_user_id, actor_username, action, entity_type, summary, occurred_at) VALUES
        ('user-history', 'History Learner', 'auth.signed_in', 'account', 'Signed in', '2026-10-01 09:00:00'),
        ('user-history', 'History Learner', 'auth.signed_out', 'account', 'Signed out', '2026-10-03 09:00:00'),
        ('user-history', 'History Learner', 'auth.signed_in', 'account', 'Signed in', '2026-10-02 09:00:00'),
        ('user-registration', 'Registration Learner', 'account.registered', 'account', 'Registered', '2026-10-02 10:00:00'),
        ('user-registration', 'Registration Learner', 'platform.setup', 'platform', 'Set up', '2026-10-03 10:00:00');
      INSERT INTO courses (id, title, status, updated_by, updated_at) VALUES
        ('course-published', 'Published Course', 'published', 'user-history', '2026-10-03 10:00:00'),
        ('course-archived', 'Archived Course', 'archived', 'user-history', '2026-10-03 11:00:00');
      INSERT INTO course_modules (id) VALUES ('module-legacy');
      INSERT INTO lessons (id) VALUES ('lesson-legacy'), ('lesson-legacy-copy');
      INSERT INTO quizzes (id) VALUES ('quiz-legacy');
      INSERT INTO lesson_captions (id, lesson_id, language, label, file_name, original_name, byte_size)
        VALUES ('caption-legacy', 'lesson-legacy', 'en', 'English', 'shared-caption.vtt', 'captions.vtt', 20);
      INSERT INTO course_certificates (id, certificate_code, user_id, course_id, recipient_name, course_title, platform_name)
        VALUES
          ('certificate-published', 'LEGACY-PUBLISHED', 'user-history', 'course-published', 'History Learner', 'Published Course', 'Learning Space'),
          ('certificate-archived', 'LEGACY-ARCHIVED', 'user-registration', 'course-archived', 'Registration Learner', 'Archived Course', 'Learning Space');
    `);

    migrateDatabase(migrationDb);
    assert.equal(migrationDb.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version, 33);
    assert.ok(migrationDb.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'competencies_admin_order'`).get());
    assert.deepEqual(migrationDb.prepare('SELECT id, last_login_at FROM users ORDER BY id').all(), [
      { id: 'user-history', last_login_at: '2026-10-02 09:00:00' },
      { id: 'user-never-signed-in', last_login_at: null },
      { id: 'user-registration', last_login_at: '2026-10-03 10:00:00' },
    ]);
    const initialVersion = migrationDb.prepare(`SELECT id, course_id, storage_course_id, version_number
      FROM course_versions WHERE course_id = 'course-published'`).get();
    assert.ok(initialVersion.id);
    assert.equal(initialVersion.course_id, 'course-published');
    assert.equal(initialVersion.storage_course_id, 'course-published');
    assert.equal(initialVersion.version_number, 1);
    assert.deepEqual(migrationDb.prepare(`SELECT id, stable_id FROM course_modules WHERE id = 'module-legacy'`).get(), { id: 'module-legacy', stable_id: 'module-legacy' });
    assert.deepEqual(migrationDb.prepare(`SELECT id, stable_id FROM lessons WHERE id = 'lesson-legacy'`).get(), { id: 'lesson-legacy', stable_id: 'lesson-legacy' });
    assert.deepEqual(migrationDb.prepare(`SELECT id, stable_id FROM quizzes WHERE id = 'quiz-legacy'`).get(), { id: 'quiz-legacy', stable_id: 'quiz-legacy' });
    assert.equal(migrationDb.prepare('SELECT course_version_id FROM course_certificates WHERE id = ?').get('certificate-published').course_version_id, initialVersion.id);
    const archivedVersion = migrationDb.prepare(`SELECT id FROM course_versions WHERE course_id = 'course-archived'`).get();
    assert.ok(archivedVersion?.id);
    assert.equal(migrationDb.prepare('SELECT course_version_id FROM course_certificates WHERE id = ?').get('certificate-archived').course_version_id, archivedVersion.id);
    assert.deepEqual(migrationDb.prepare('SELECT id, lesson_id, file_name FROM lesson_captions').get(), {
      id: 'caption-legacy', lesson_id: 'lesson-legacy', file_name: 'shared-caption.vtt',
    });
    migrationDb.prepare(`INSERT INTO lesson_captions
      (id, lesson_id, language, label, file_name, original_name, byte_size)
      VALUES ('caption-legacy-copy', 'lesson-legacy-copy', 'en', 'English', 'shared-caption.vtt', 'captions.vtt', 20)`).run();
    assert.equal(migrationDb.prepare("SELECT COUNT(*) AS count FROM lesson_captions WHERE file_name = 'shared-caption.vtt'").get().count, 2);
    assert.deepEqual(migrationDb.pragma('foreign_key_check'), []);

    migrateDatabase(migrationDb);
    assert.equal(migrationDb.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 16').get().count, 1);
    assert.equal(migrationDb.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 17').get().count, 1);
    assert.equal(migrationDb.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 18').get().count, 1);
    assert.equal(migrationDb.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 19').get().count, 1);
    assert.equal(migrationDb.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 20').get().count, 1);
    assert.equal(migrationDb.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 21').get().count, 1);
    assert.equal(migrationDb.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 22').get().count, 1);
    assert.equal(migrationDb.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 23').get().count, 1);
    assert.equal(migrationDb.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 24').get().count, 1);
    assert.equal(migrationDb.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 25').get().count, 1);
    assert.equal(migrationDb.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 26').get().count, 1);
    assert.equal(migrationDb.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 27').get().count, 1);
    assert.equal(migrationDb.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 28').get().count, 1);
    assert.equal(migrationDb.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 29').get().count, 1);
    assert.equal(migrationDb.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 30').get().count, 1);
    assert.equal(migrationDb.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 31').get().count, 1);
    assert.equal(migrationDb.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name IN ('learning_paths_active_updated', 'learning_paths_status_updated', 'courses_updated_order', 'courses_status_updated_order', 'courses_status_title_order', 'audit_logs_action', 'system_logs_level', 'course_certificates_user_issued')").get().count, 8);
    assert.equal(migrationDb.prepare("SELECT COUNT(*) AS count FROM pragma_table_info('users') WHERE name = 'email'").get().count, 1);
    assert.equal(migrationDb.prepare("SELECT COUNT(*) AS count FROM pragma_table_info('users') WHERE name = 'first_name'").get().count, 1);
    assert.equal(migrationDb.prepare("SELECT COUNT(*) AS count FROM pragma_table_info('users') WHERE name = 'last_name'").get().count, 1);
    assert.equal(migrationDb.prepare("SELECT COUNT(*) AS count FROM pragma_table_info('course_certificates') WHERE name = 'recipient_email'").get().count, 1);
    assert.deepEqual(migrationDb.prepare('SELECT recipient_name, recipient_email FROM course_certificates WHERE id = ?').get('certificate-published'), {
      recipient_name: 'History Learner', recipient_email: '',
    });
    assert.equal(migrationDb.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'user_registration_field_values'").get().count, 1);
    assert.deepEqual(migrationDb.prepare("SELECT name FROM pragma_table_info('lesson_watch_progress') ORDER BY cid").all(), [
      { name: 'user_id' }, { name: 'lesson_id' }, { name: 'watched_until_seconds' },
      { name: 'duration_seconds' }, { name: 'last_position_seconds' }, { name: 'last_heartbeat_at' }, { name: 'updated_at' },
    ]);
    assert.equal(migrationDb.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name = 'lesson_watch_progress_lesson'").get().count, 1);
    assert.deepEqual(migrationDb.prepare("SELECT name FROM pragma_table_info('lesson_watch_telemetry') ORDER BY cid").all(), [
      { name: 'user_id' }, { name: 'lesson_id' }, { name: 'watched_seconds' }, { name: 'rejected_seek_count' },
      { name: 'last_rejected_position_seconds' }, { name: 'last_rejected_at' }, { name: 'last_alerted_at' }, { name: 'updated_at' },
    ]);
    assert.equal(migrationDb.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name = 'lesson_watch_telemetry_lesson'").get().count, 1);
    assert.equal(migrationDb.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name = 'learning_path_courses_course_path'").get().count, 1);
    assert.equal(migrationDb.prepare("SELECT COUNT(*) AS count FROM pragma_table_info('media_files') WHERE name = 'duration_seconds'").get().count, 1);
    assert.deepEqual(migrationDb.pragma('foreign_key_check'), []);
  } finally {
    migrationDb.close();
  }
});

test('migration 31 backfills watch telemetry and can be rerun safely', () => {
  const migrationDb = new Database(':memory:');
  try {
    migrationDb.pragma('foreign_keys = ON');
    migrationDb.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO schema_migrations (version) VALUES (30);
      CREATE TABLE learning_path_courses (path_id TEXT NOT NULL, course_id TEXT NOT NULL);
      CREATE TABLE competencies (id TEXT PRIMARY KEY, title TEXT NOT NULL COLLATE NOCASE, active INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE lesson_watch_progress (
        user_id TEXT NOT NULL,
        lesson_id TEXT NOT NULL,
        watched_until_seconds REAL NOT NULL,
        duration_seconds REAL NOT NULL,
        last_position_seconds REAL NOT NULL,
        last_heartbeat_at INTEGER NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(user_id, lesson_id)
      );
      INSERT INTO lesson_watch_progress (user_id, lesson_id, watched_until_seconds, duration_seconds, last_position_seconds, last_heartbeat_at)
        VALUES ('watch-learner', 'watched-lesson', 42.5, 100, 42.5, 1000), ('watch-learner', 'unwatched-lesson', 0, 60, 0, 1000);
    `);

    migrateDatabase(migrationDb);
    assert.deepEqual(migrationDb.prepare('SELECT lesson_id, watched_seconds, rejected_seek_count FROM lesson_watch_telemetry ORDER BY lesson_id').all(), [
      { lesson_id: 'unwatched-lesson', watched_seconds: 0, rejected_seek_count: 0 },
      { lesson_id: 'watched-lesson', watched_seconds: 42.5, rejected_seek_count: 0 },
    ]);

    migrateDatabase(migrationDb);
    assert.equal(migrationDb.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 31').get().count, 1);
    assert.equal(migrationDb.prepare('SELECT COUNT(*) AS count FROM lesson_watch_telemetry').get().count, 2);
    assert.deepEqual(migrationDb.pragma('foreign_key_check'), []);
  } finally {
    migrationDb.close();
  }
});

test('migration 31 preserves telemetry already present in a version-30 database', () => {
  const migrationDb = new Database(':memory:');
  try {
    migrationDb.pragma('foreign_keys = ON');
    migrationDb.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO schema_migrations (version) VALUES (30);
      CREATE TABLE learning_path_courses (path_id TEXT NOT NULL, course_id TEXT NOT NULL);
      CREATE TABLE competencies (id TEXT PRIMARY KEY, title TEXT NOT NULL COLLATE NOCASE, active INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE lesson_watch_progress (
        user_id TEXT NOT NULL,
        lesson_id TEXT NOT NULL,
        watched_until_seconds REAL NOT NULL,
        duration_seconds REAL NOT NULL,
        last_position_seconds REAL NOT NULL,
        last_heartbeat_at INTEGER NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(user_id, lesson_id)
      );
      CREATE TABLE lesson_watch_telemetry (
        user_id TEXT NOT NULL,
        lesson_id TEXT NOT NULL,
        watched_seconds REAL NOT NULL DEFAULT 0,
        rejected_seek_count INTEGER NOT NULL DEFAULT 0,
        last_rejected_position_seconds REAL,
        last_rejected_at INTEGER NOT NULL DEFAULT 0,
        last_alerted_at INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(user_id, lesson_id),
        FOREIGN KEY(user_id, lesson_id) REFERENCES lesson_watch_progress(user_id, lesson_id) ON DELETE CASCADE
      );
      INSERT INTO lesson_watch_progress (user_id, lesson_id, watched_until_seconds, duration_seconds, last_position_seconds, last_heartbeat_at)
        VALUES ('watch-learner', 'watched-lesson', 42.5, 100, 42.5, 1000), ('watch-learner', 'unwatched-lesson', 0, 60, 0, 1000);
      INSERT INTO lesson_watch_telemetry (user_id, lesson_id, watched_seconds, rejected_seek_count)
        VALUES ('watch-learner', 'watched-lesson', 45, 2);
    `);

    migrateDatabase(migrationDb);
    assert.deepEqual(migrationDb.prepare('SELECT lesson_id, watched_seconds, rejected_seek_count FROM lesson_watch_telemetry ORDER BY lesson_id').all(), [
      { lesson_id: 'unwatched-lesson', watched_seconds: 0, rejected_seek_count: 0 },
      { lesson_id: 'watched-lesson', watched_seconds: 45, rejected_seek_count: 2 },
    ]);
    assert.equal(migrationDb.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 31').get().count, 1);
    assert.equal(migrationDb.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name = 'lesson_watch_telemetry_lesson'").get().count, 1);
    assert.deepEqual(migrationDb.pragma('foreign_key_check'), []);
  } finally {
    migrationDb.close();
  }
});

test('initial setup rejects missing or incorrect operator bootstrap credentials without writing setup state', async () => {
  const appSettingsBefore = database.prepare('SELECT key, value FROM app_settings ORDER BY key').all();
  const request = (setupToken) => fetch(apiUrl('/setup'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify({
      ...(setupToken === undefined ? {} : { setupToken }),
      platformName: 'Unauthorized Setup',
      username: 'unauthorized_setup',
      email: 'unauthorized.setup@example.invalid',
      firstName: 'Unauthorized',
      lastName: 'Setup',
      password: 'UnauthorizedSetupPassphrase-2026',
      confirmPassword: 'UnauthorizedSetupPassphrase-2026',
    }),
  });

  for (const credential of [undefined, 'incorrect-bootstrap-credential']) {
    const response = await request(credential);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'The bootstrap credential is invalid.', code: 'invalid_setup_token' });
  }

  const statusResponse = await fetch(apiUrl('/setup/status'), { headers: { connection: 'close' } });
  assert.equal(statusResponse.status, 200);
  const setupStatus = await statusResponse.json();
  assert.equal(setupStatus.setupAvailable, true);
  assert.equal(Object.hasOwn(setupStatus, 'setupToken'), false);

  const configuredSetupToken = serverConfig.setupToken;
  serverConfig.setupToken = '';
  try {
    const unavailableResponse = await fetch(apiUrl('/setup'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({ setupToken: configuredSetupToken }),
    });
    assert.equal(unavailableResponse.status, 503);
    assert.deepEqual(await unavailableResponse.json(), {
      error: 'Initial setup is unavailable because no bootstrap credential is configured.',
      code: 'setup_credential_unavailable',
    });
    const unavailableStatusResponse = await fetch(apiUrl('/setup/status'), { headers: { connection: 'close' } });
    assert.equal((await unavailableStatusResponse.json()).setupAvailable, false);
  } finally {
    serverConfig.setupToken = configuredSetupToken;
  }
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM users').get().count, 0);
  assert.deepEqual(database.prepare('SELECT key, value FROM app_settings ORDER BY key').all(), appSettingsBefore);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'platform.setup'").get().count, 0);
});

test('initial setup rolls back its administrator and settings when the audit entry cannot be written', async () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  database.exec(`CREATE TRIGGER fail_initial_setup_audit
    BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'platform.setup'
    BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END`);

  try {
    const request = () => fetch(apiUrl('/setup'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({
        setupToken: isolatedConfig.SETUP_TOKEN,
        platformName: 'Audit Rollback Test',
        username: 'setup_audit',
        email: 'setup.audit@example.invalid',
        firstName: 'Setup',
        lastName: 'Admin',
        password: 'SetupAuditPassphrase-2026',
        confirmPassword: 'SetupAuditPassphrase-2026',
      }),
    });
    const response = await request();
    assert.equal(response.status, 500);
    assert.equal((await response.json()).code, 'audit_unavailable');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM users WHERE username = ?').get('setup_audit').count, 0);
    assert.notEqual(database.prepare("SELECT value FROM app_settings WHERE key = 'setup_complete'").get()?.value, '1');
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'platform.setup'").get().count, 0);

    database.exec('DROP TRIGGER fail_initial_setup_audit');
    database.exec(`CREATE TRIGGER fail_initial_setup_login_timestamp
      BEFORE UPDATE OF last_login_at ON users
      WHEN NEW.username = 'setup_audit'
      BEGIN SELECT RAISE(ABORT, 'last login unavailable'); END`);
    const timestampFailure = await request();
    assert.equal(timestampFailure.status, 500);
    assert.equal((await timestampFailure.json()).code, 'internal_error');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM users WHERE username = ?').get('setup_audit').count, 0);
    assert.notEqual(database.prepare("SELECT value FROM app_settings WHERE key = 'setup_complete'").get()?.value, '1');
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'platform.setup'").get().count, 0);
  } finally {
    console.error = originalConsoleError;
    database.exec('DROP TRIGGER IF EXISTS fail_initial_setup_audit');
    database.exec('DROP TRIGGER IF EXISTS fail_initial_setup_login_timestamp');
  }
});

test('initial setup rolls back when its success payload cannot be read', async () => {
  const originalPrepare = database.prepare;
  const originalConsoleError = console.error;
  let payloadReadFailed = false;
  database.prepare = function prepareWithUnavailableSetupPayload(sql, ...args) {
    if (sql === 'SELECT id, username, email, first_name, last_name, role, disabled FROM users WHERE id = ?') {
      payloadReadFailed = true;
      throw new Error('setup response user unavailable');
    }
    return originalPrepare.call(this, sql, ...args);
  };
  console.error = () => {};

  try {
    const response = await fetch(apiUrl('/setup'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({
        setupToken: isolatedConfig.SETUP_TOKEN,
        platformName: 'Setup Payload Failure',
        username: 'setup_payload_failure',
        email: 'setup.payload.failure@example.invalid',
        firstName: 'Setup',
        lastName: 'Payload',
        password: 'SetupPayloadPassphrase-2026',
        confirmPassword: 'SetupPayloadPassphrase-2026',
      }),
    });
    assert.equal(response.status, 500);
    assert.equal(payloadReadFailed, true);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM users WHERE username = ?').get('setup_payload_failure').count, 0);
    assert.notEqual(database.prepare("SELECT value FROM app_settings WHERE key = 'setup_complete'").get()?.value, '1');
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'platform.setup'").get().count, 0);
  } finally {
    console.error = originalConsoleError;
    database.prepare = originalPrepare;
  }
});

test('setup, registration, and successful sign-in record last login for admin details', async () => {
  const setupResponse = await fetch(apiUrl('/setup'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify({
      setupToken: isolatedConfig.SETUP_TOKEN,
      platformName: 'Last Login Test',
      username: 'admin_last_login',
      email: 'admin.last-login@example.invalid',
      firstName: 'Last',
      lastName: 'Login',
      password: 'LastLoginPassphrase-2026',
      confirmPassword: 'LastLoginPassphrase-2026',
    }),
  });
  assert.equal(setupResponse.status, 201);
  const setup = await setupResponse.json();
  assert.equal(setup.platformName, 'Last Login Test');
  assert.equal(setup.registrationAvailable, true);
  const adminId = setup.user.id;
  const setupLastLogin = database.prepare('SELECT last_login_at FROM users WHERE id = ?').get(adminId).last_login_at;
  assert.match(setupLastLogin, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

  const registrationCollision = async ({ username, email }) => {
    const response = await fetch(apiUrl('/auth/register'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({
        username,
        email,
        firstName: 'Collision',
        lastName: 'Probe',
        password: 'CollisionProbePassphrase-2026',
        confirmPassword: 'CollisionProbePassphrase-2026',
      }),
    });
    assert.equal(response.status, 409);
    return response.json();
  };
  const userCountBeforeCollisions = database.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  const usernameCollision = await registrationCollision({ username: 'ADMIN_LAST_LOGIN', email: 'unused.username@example.invalid' });
  const emailCollision = await registrationCollision({ username: 'unused_email', email: 'ADMIN.LAST-LOGIN@EXAMPLE.INVALID' });
  const bothCollisions = await registrationCollision({ username: 'admin_last_login', email: 'admin.last-login@example.invalid' });
  assert.deepEqual(usernameCollision, { error: 'An account with those details could not be registered.', code: 'registration_conflict' });
  assert.deepEqual(emailCollision, usernameCollision);
  assert.deepEqual(bothCollisions, usernameCollision);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM users').get().count, userCountBeforeCollisions);

  const registrationResponse = await fetch(apiUrl('/auth/register'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify({
      username: 'new_learner',
      email: 'learner.last-login@example.invalid',
      firstName: 'New',
      lastName: 'Learner',
      password: 'LearnerPassphrase-2026',
      confirmPassword: 'LearnerPassphrase-2026',
    }),
  });
  assert.equal(registrationResponse.status, 201);
  const registration = await registrationResponse.json();
  assert.equal(registration.registrationAvailable, true);
  const learnerLastLogin = database.prepare('SELECT last_login_at FROM users WHERE id = ?').get(registration.user.id).last_login_at;
  assert.match(learnerLastLogin, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

  const emailSearchResponse = await fetch(apiUrl('/admin/users?q=LEARNER.LAST-LOGIN%40EXAMPLE.INVALID'), { headers: { connection: 'close' } });
  assert.equal(emailSearchResponse.status, 200);
  const emailSearch = await emailSearchResponse.json();
  assert.equal(emailSearch.total, 1);
  assert.equal(emailSearch.users[0].id, registration.user.id);
  assert.equal(emailSearch.users[0].email, 'learner.last-login@example.invalid');

  const priorLoginAt = '2000-01-01 00:00:00';
  database.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(priorLoginAt, adminId);
  const rejectedResponse = await fetch(apiUrl('/auth/login'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify({ username: 'admin_last_login', password: 'IncorrectPassphrase-2026' }),
  });
  assert.equal(rejectedResponse.status, 401);
  assert.equal(database.prepare('SELECT last_login_at FROM users WHERE id = ?').get(adminId).last_login_at, priorLoginAt);

  const response = await fetch(apiUrl('/auth/login'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify({ username: 'admin_last_login', password: 'LastLoginPassphrase-2026' }),
  });
  assert.equal(response.status, 200);

  const lastLoginAt = database.prepare('SELECT last_login_at FROM users WHERE id = ?').get(adminId).last_login_at;
  assert.match(lastLoginAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.notEqual(lastLoginAt, '2000-01-01 00:00:00');

  const detailsResponse = await fetch(apiUrl(`/admin/users/${adminId}`), { headers: { connection: 'close' } });
  assert.equal(detailsResponse.status, 200);
  const details = await detailsResponse.json();
  assert.equal(details.user.lastLoginAt, lastLoginAt);
});

test('registration rolls back when availability for its success payload cannot be read', async () => {
  const originalPrepare = database.prepare;
  const originalConsoleError = console.error;
  const targetUsername = 'registration_payload_failure';
  const targetUserExists = originalPrepare.call(database, 'SELECT 1 FROM users WHERE username = ?');
  const originalUserLimit = originalPrepare.call(database, 'SELECT value FROM app_settings WHERE key = ?').get('user_limit')?.value;
  let availabilityReadFailed = false;
  originalPrepare.call(database, `INSERT INTO app_settings (key, value) VALUES ('user_limit', '100')
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run();
  database.prepare = function prepareWithUnavailableAvailability(sql, ...args) {
    if (sql === 'SELECT COUNT(*) AS count FROM users' && targetUserExists.get(targetUsername)) {
      availabilityReadFailed = true;
      throw new Error('registration availability unavailable');
    }
    return originalPrepare.call(this, sql, ...args);
  };
  console.error = () => {};

  try {
    const response = await fetch(apiUrl('/auth/register'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({
        username: targetUsername,
        email: 'registration.payload.failure@example.invalid',
        firstName: 'Registration',
        lastName: 'Payload',
        password: 'RegistrationPayloadPassphrase-2026',
        confirmPassword: 'RegistrationPayloadPassphrase-2026',
      }),
    });
    assert.equal(response.status, 500);
    assert.equal(availabilityReadFailed, true);
    assert.equal(targetUserExists.get(targetUsername), undefined);
    assert.equal(originalPrepare.call(database, "SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'account.registered' AND actor_username = ?")
      .get(targetUsername).count, 0);
  } finally {
    console.error = originalConsoleError;
    database.prepare = originalPrepare;
    if (originalUserLimit === undefined) originalPrepare.call(database, "DELETE FROM app_settings WHERE key = 'user_limit'").run();
    else originalPrepare.call(database, `INSERT INTO app_settings (key, value) VALUES ('user_limit', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(originalUserLimit);
  }
});

test('admin user list returns the final page and clamps requests beyond the search results', async () => {
  const usernamePrefix = 'admin-user-pagination-fixture-';
  const fixtureUsers = Array.from({ length: 51 }, (_, index) => ({
    id: `admin-user-pagination-${index}`,
    username: `${usernamePrefix}${String(index).padStart(3, '0')}`,
  }));
  const passwordHash = database.prepare("SELECT password_hash FROM users WHERE username = 'admin_last_login'").get().password_hash;
  const insertUser = database.prepare('INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)');
  const seedUsers = database.transaction(() => {
    fixtureUsers.forEach(({ id, username }) => insertUser.run(id, username, passwordHash, 'learner'));
  });
  seedUsers();

  try {
    const firstResponse = await fetch(apiUrl(`/admin/users?q=${encodeURIComponent(usernamePrefix)}&page=1`), {
      headers: { connection: 'close' },
    });
    assert.equal(firstResponse.status, 200);
    const firstPage = await firstResponse.json();
    assert.equal(firstPage.total, fixtureUsers.length);
    assert.equal(firstPage.page, 1);
    assert.equal(firstPage.pageSize, 50);
    assert.deepEqual(firstPage.users.map((user) => user.username), fixtureUsers.slice(0, 50).map((user) => user.username));

    const finalResponse = await fetch(apiUrl(`/admin/users?q=${encodeURIComponent(usernamePrefix)}&page=2`), {
      headers: { connection: 'close' },
    });
    assert.equal(finalResponse.status, 200);
    const finalPage = await finalResponse.json();
    assert.equal(finalPage.total, fixtureUsers.length);
    assert.equal(finalPage.page, 2);
    assert.equal(finalPage.pageSize, 50);
    assert.deepEqual(finalPage.users.map((user) => user.username), fixtureUsers.slice(50).map((user) => user.username));

    const clampedResponse = await fetch(apiUrl(`/admin/users?q=${encodeURIComponent(usernamePrefix)}&page=99`), {
      headers: { connection: 'close' },
    });
    assert.equal(clampedResponse.status, 200);
    const clampedPage = await clampedResponse.json();
    assert.equal(clampedPage.page, 2);
    assert.deepEqual(clampedPage.users, finalPage.users);
  } finally {
    const deleteUser = database.prepare('DELETE FROM users WHERE id = ?');
    database.transaction(() => fixtureUsers.forEach(({ id }) => deleteUser.run(id)))();
  }
});

test('admin account course activity includes published paths and deduplicates overlapping access', async () => {
  const adminId = database.prepare("SELECT id FROM users WHERE username = 'admin_last_login'").get().id;
  const courseIds = ['account-activity-enrolled', 'account-activity-overlap', 'account-activity-granted',
    'account-activity-path', 'account-activity-draft-path'];
  const pathIds = ['account-activity-published-path', 'account-activity-draft'];
  const addCourse = database.prepare(`INSERT INTO courses (id, title, status, created_by, updated_by, updated_at)
    VALUES (?, ?, 'published', ?, ?, ?)`);
  const addCourses = database.transaction(() => {
    addCourse.run(courseIds[0], 'Enrolled only', adminId, adminId, '2026-10-01 10:00:00');
    addCourse.run(courseIds[1], 'Enrolled and granted', adminId, adminId, '2026-10-03 10:00:00');
    addCourse.run(courseIds[2], 'Granted only', adminId, adminId, '2026-10-02 10:00:00');
    addCourse.run(courseIds[3], 'Published path only', adminId, adminId, '2026-10-04 10:00:00');
    addCourse.run(courseIds[4], 'Draft path only', adminId, adminId, '2026-10-05 10:00:00');
    database.prepare('INSERT INTO enrollments (id, course_id, user_id) VALUES (?, ?, ?)')
      .run('account-activity-enrollment-1', courseIds[0], adminId);
    database.prepare('INSERT INTO enrollments (id, course_id, user_id) VALUES (?, ?, ?)')
      .run('account-activity-enrollment-2', courseIds[1], adminId);
    database.prepare('INSERT INTO course_grants (id, course_id, user_id, granted_by) VALUES (?, ?, ?, ?)')
      .run('account-activity-grant-1', courseIds[1], adminId, adminId);
    database.prepare('INSERT INTO course_grants (id, course_id, user_id, granted_by) VALUES (?, ?, ?, ?)')
      .run('account-activity-grant-2', courseIds[2], adminId, adminId);
    database.prepare(`INSERT INTO learning_paths (id, title, status, created_by, updated_by)
      VALUES (?, 'Account activity path', 'published', ?, ?), (?, 'Inactive account path', 'draft', ?, ?)`)
      .run(pathIds[0], adminId, adminId, pathIds[1], adminId, adminId);
    database.prepare(`INSERT INTO learning_path_courses (id, path_id, course_id, position)
      VALUES (?, ?, ?, 0), (?, ?, ?, 1), (?, ?, ?, 0)`)
      .run('account-activity-path-overlap', pathIds[0], courseIds[1],
        'account-activity-path-course', pathIds[0], courseIds[3],
        'account-activity-draft-course', pathIds[1], courseIds[4]);
    database.prepare(`INSERT INTO learning_path_enrollments (id, path_id, user_id, enrollment_source, assigned_by)
      VALUES (?, ?, ?, 'assigned', ?), (?, ?, ?, 'assigned', ?)`)
      .run('account-activity-published-enrollment', pathIds[0], adminId, adminId,
        'account-activity-draft-enrollment', pathIds[1], adminId, adminId);
  });
  addCourses();

  try {
    const membershipQueryPlan = database.prepare(`EXPLAIN QUERY PLAN WITH course_sources(course_id, learning_path_enrolled) AS (
      SELECT course_id, 0 FROM enrollments WHERE user_id = ?
      UNION ALL SELECT course_id, 0 FROM course_grants WHERE user_id = ?
      UNION ALL SELECT pc.course_id, 1 FROM learning_path_enrollments e
        CROSS JOIN learning_paths lp ON lp.id = e.path_id
        JOIN learning_path_courses pc ON pc.path_id = e.path_id WHERE e.user_id = ? AND lp.status = 'published'
    ), user_courses(course_id, learning_path_enrolled) AS (
      SELECT course_id, MAX(learning_path_enrolled) FROM course_sources GROUP BY course_id
    ) SELECT c.* FROM user_courses uc JOIN courses c ON c.id = uc.course_id
      ORDER BY c.updated_at DESC, c.title COLLATE NOCASE, c.id ASC LIMIT ? OFFSET ?`)
      .all(adminId, adminId, adminId, 50, 0).map((step) => step.detail).join('\n');
    assert.match(membershipQueryPlan, /SEARCH enrollments USING INDEX enrollments_user \(user_id=\?\)/);
    assert.match(membershipQueryPlan, /SEARCH course_grants USING INDEX grants_user \(user_id=\?\)/);
    assert.match(membershipQueryPlan, /SEARCH e USING INDEX learning_path_enrollments_user \(user_id=\?\)/);
    assert.match(membershipQueryPlan, /SEARCH lp USING INDEX sqlite_autoindex_learning_paths_1 \(id=\?\)/);
    assert.match(membershipQueryPlan, /SEARCH pc USING (?:COVERING )?INDEX .*learning_path_courses.*\(path_id=\?\)/);
    assert.doesNotMatch(membershipQueryPlan, /\bSCAN c\b/);

    const response = await fetch(apiUrl(`/admin/users/${adminId}`), { headers: { connection: 'close' } });
    assert.equal(response.status, 200);
    const details = await response.json();
    assert.equal(details.total, 4);
    assert.deepEqual(details.courses.map((course) => course.id), [courseIds[3], courseIds[1], courseIds[2], courseIds[0]]);
    assert.equal(details.courses.find((course) => course.id === courseIds[3]).learningPathEnrolled, true);
    assert.equal(details.courses.find((course) => course.id === courseIds[1]).learningPathEnrolled, true);
    assert.equal(details.courses.find((course) => course.id === courseIds[0]).learningPathEnrolled, false);
    assert.equal(details.courses.some((course) => course.id === courseIds[4]), false);
  } finally {
    database.prepare(`DELETE FROM learning_paths WHERE id IN (${pathIds.map(() => '?').join(', ')})`).run(...pathIds);
    database.prepare(`DELETE FROM courses WHERE id IN (${courseIds.map(() => '?').join(', ')})`).run(...courseIds);
  }
});

test('sign-in rolls back last-login history and session when its audit entry cannot be written', async () => {
  const user = database.prepare("SELECT id FROM users WHERE username = 'admin_last_login'").get();
  const originalLoginAt = '2001-01-01 00:00:00';
  database.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(originalLoginAt, user.id);
  const originalAuditCount = database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'auth.signed_in' AND entity_id = ?").get(user.id).count;
  const originalSessionIds = await storedSessionIds();
  const originalConsoleError = console.error;
  console.error = () => {};
  database.exec(`CREATE TRIGGER fail_sign_in_audit
    BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'auth.signed_in'
    BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END`);

  try {
    const request = () => fetch(apiUrl('/auth/login'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({ username: 'admin_last_login', password: 'LastLoginPassphrase-2026' }),
    });

    const failedResponse = await request();
    assert.equal(failedResponse.status, 500);
    assert.equal((await failedResponse.json()).code, 'audit_unavailable');
    assert.equal(database.prepare('SELECT last_login_at FROM users WHERE id = ?').get(user.id).last_login_at, originalLoginAt);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'auth.signed_in' AND entity_id = ?").get(user.id).count, originalAuditCount);
    assert.deepEqual(await storedSessionIds(), originalSessionIds);

    database.exec('DROP TRIGGER fail_sign_in_audit');
    const successfulResponse = await request();
    assert.equal(successfulResponse.status, 200);
    assert.notEqual(database.prepare('SELECT last_login_at FROM users WHERE id = ?').get(user.id).last_login_at, originalLoginAt);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'auth.signed_in' AND entity_id = ?").get(user.id).count, originalAuditCount + 1);
  } finally {
    console.error = originalConsoleError;
    database.exec('DROP TRIGGER IF EXISTS fail_sign_in_audit');
  }
});

test('self-service password changes roll back when their audit event cannot be saved', async () => {
  const user = database.prepare("SELECT id, password_hash FROM users WHERE username = 'admin_last_login'").get();
  const nextPassword = 'UpdatedLastLoginPassphrase-2026';
  const otherSessionId = 'self-password-change-other-session';
  database.prepare('INSERT INTO sessions (sid, session_data, expires_at, user_id) VALUES (?, ?, ?, ?)')
    .run(otherSessionId, JSON.stringify({ userId: user.id }), Date.now() + 60_000, user.id);
  const initialAuditCount = database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'account.password_changed' AND entity_id = ?").get(user.id).count;
  database.exec(`CREATE TRIGGER reject_password_changed_audit BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'account.password_changed' BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END`);

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const failedResponse = await fetch(apiUrl('/auth/password'), {
      method: 'PUT',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({
        currentPassword: 'LastLoginPassphrase-2026',
        password: nextPassword,
        confirmPassword: nextPassword,
      }),
    });
    assert.equal(failedResponse.status, 500);
    assert.equal((await failedResponse.json()).code, 'audit_unavailable');
    assert.equal(database.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id).password_hash, user.password_hash);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sessions WHERE sid = ?').get(otherSessionId).count, 1);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'account.password_changed' AND entity_id = ?").get(user.id).count, initialAuditCount);
  } finally {
    database.exec('DROP TRIGGER IF EXISTS reject_password_changed_audit');
    console.error = originalConsoleError;
  }

  const retryResponse = await fetch(apiUrl('/auth/password'), {
    method: 'PUT',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify({
      currentPassword: 'LastLoginPassphrase-2026',
      password: nextPassword,
      confirmPassword: nextPassword,
    }),
  });
  assert.equal(retryResponse.status, 204);
  const updatedPasswordHash = database.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id).password_hash;
  const { verifyPassword } = await import('../../server/auth.js');
  assert.equal(await verifyPassword(nextPassword, updatedPasswordHash), true);
  assert.equal(await verifyPassword('LastLoginPassphrase-2026', updatedPasswordHash), false);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sessions WHERE sid = ?').get(otherSessionId).count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'account.password_changed' AND entity_id = ?").get(user.id).count, initialAuditCount + 1);
});

test('registration explains how to sign in when the account is saved but session storage fails', async () => {
  const originalSet = sessionStore.set;
  const originalConsoleError = console.error;
  const originalSessionIds = await storedSessionIds();
  console.error = () => {};
  sessionStore.set = (_sessionId, _session, callback) => callback(new Error('session store unavailable'));

  let response;
  try {
    response = await fetch(apiUrl('/auth/register'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({
        username: 'session_recovery_learner',
        email: 'session.recovery@example.invalid',
        firstName: 'Session',
        lastName: 'Recovery',
        password: 'SessionRecoveryPassphrase-2026',
        confirmPassword: 'SessionRecoveryPassphrase-2026',
      }),
    });
  } finally {
    sessionStore.set = originalSet;
    console.error = originalConsoleError;
  }

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: 'Your account was created, but automatic sign-in failed. Go to the sign-in page and use the credentials you just registered.',
    code: 'registration_session_unavailable',
  });
  const createdUser = database.prepare('SELECT id FROM users WHERE username = ?').get('session_recovery_learner');
  assert.ok(createdUser);
  const sessionFailure = database.prepare(`SELECT details_json FROM system_logs
    WHERE source = 'auth' AND message = ? ORDER BY id DESC LIMIT 1`)
    .get('Account registration completed, but learner sign-in could not be established');
  assert.deepEqual(JSON.parse(sessionFailure.details_json), { userId: createdUser.id, errorName: 'Error' });
  assert.deepEqual(await storedSessionIds(), originalSessionIds);

  const signInResponse = await fetch(apiUrl('/auth/login'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify({ username: 'session_recovery_learner', password: 'SessionRecoveryPassphrase-2026' }),
  });
  assert.equal(signInResponse.status, 200);
});
