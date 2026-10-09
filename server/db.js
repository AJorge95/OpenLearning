import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
fs.mkdirSync(config.mediaRoot, { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

export function migrateDatabase(database = db) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const current = database.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get().version;
  if (current < 1) {
    const migration = database.transaction(() => {
    database.exec(`
      CREATE TABLE app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT INTO app_settings (key, value) VALUES ('setup_complete', '0'), ('platform_name', '');

      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL COLLATE NOCASE UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'moderator', 'learner')),
        disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE courses (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'General',
        visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
        cover_media_id TEXT,
        created_by TEXT NOT NULL REFERENCES users(id),
        updated_by TEXT NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX courses_status_visibility ON courses(status, visibility);
      CREATE INDEX courses_category ON courses(category);

      CREATE TABLE course_modules (
        id TEXT PRIMARY KEY,
        course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(course_id, position)
      );
      CREATE INDEX modules_course_position ON course_modules(course_id, position);

      CREATE TABLE media_files (
        id TEXT PRIMARY KEY,
        course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        original_name TEXT NOT NULL,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        media_kind TEXT NOT NULL CHECK (media_kind IN ('video', 'cover')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE lessons (
        id TEXT PRIMARY KEY,
        module_id TEXT NOT NULL REFERENCES course_modules(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        media_id TEXT REFERENCES media_files(id) ON DELETE SET NULL,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(module_id, position)
      );

      CREATE TABLE quizzes (
        id TEXT PRIMARY KEY,
        module_id TEXT NOT NULL UNIQUE REFERENCES course_modules(id) ON DELETE CASCADE,
        title TEXT NOT NULL DEFAULT 'Module quiz',
        pass_mark INTEGER NOT NULL DEFAULT 70 CHECK (pass_mark BETWEEN 1 AND 100),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE quiz_questions (
        id TEXT PRIMARY KEY,
        quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
        prompt TEXT NOT NULL,
        explanation TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL DEFAULT 0,
        UNIQUE(quiz_id, position)
      );
      CREATE TABLE quiz_choices (
        id TEXT PRIMARY KEY,
        question_id TEXT NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
        choice_text TEXT NOT NULL,
        is_correct INTEGER NOT NULL DEFAULT 0 CHECK (is_correct IN (0, 1)),
        position INTEGER NOT NULL DEFAULT 0,
        UNIQUE(question_id, position)
      );

      CREATE TABLE course_grants (
        id TEXT PRIMARY KEY,
        course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        granted_by TEXT NOT NULL REFERENCES users(id),
        granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(course_id, user_id)
      );
      CREATE INDEX grants_user ON course_grants(user_id);
      CREATE TABLE enrollments (
        id TEXT PRIMARY KEY,
        course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        enrolled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(course_id, user_id)
      );
      CREATE INDEX enrollments_user ON enrollments(user_id, enrolled_at DESC);
      CREATE TABLE lesson_progress (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
        completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(user_id, lesson_id)
      );
      CREATE TABLE quiz_attempts (
        id TEXT PRIMARY KEY,
        quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
        passed INTEGER NOT NULL CHECK (passed IN (0, 1)),
        answers_json TEXT NOT NULL,
        question_snapshot_json TEXT NOT NULL,
        submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX quiz_attempts_user_quiz ON quiz_attempts(user_id, quiz_id, submitted_at DESC);

      CREATE TABLE sessions (
        sid TEXT PRIMARY KEY,
        session_data TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX sessions_expires ON sessions(expires_at);

      INSERT INTO schema_migrations (version) VALUES (1);
    `);
    });
    migration();
  }

  if (current < 2) {
    const migration = database.transaction(() => {
      database.exec(`
        CREATE TABLE lesson_resources (
          id TEXT PRIMARY KEY,
          lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
          resource_type TEXT NOT NULL CHECK (resource_type IN ('link', 'document')),
          title TEXT NOT NULL,
          href TEXT,
          file_name TEXT,
          original_name TEXT,
          mime_type TEXT,
          byte_size INTEGER,
          position INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CHECK (
            (resource_type = 'link' AND href IS NOT NULL AND file_name IS NULL) OR
            (resource_type = 'document' AND href IS NULL AND file_name IS NOT NULL)
          )
        );
        CREATE INDEX lesson_resources_lesson_position ON lesson_resources(lesson_id, position, id);
        INSERT INTO schema_migrations (version) VALUES (2);
      `);
    });
    migration();
  }
}

export function setting(key) {
  return db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value ?? null;
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

export function setupComplete() {
  return setting('setup_complete') === '1' && db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get() !== undefined;
}

export function getCourseForLesson(lessonId) {
  return db.prepare(`
    SELECT c.*, l.id AS lesson_id, l.media_id, l.title AS lesson_title
    FROM lessons l
    JOIN course_modules m ON m.id = l.module_id
    JOIN courses c ON c.id = m.course_id
    WHERE l.id = ?
  `).get(lessonId);
}

migrateDatabase();

