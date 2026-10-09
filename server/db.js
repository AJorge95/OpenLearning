import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';
import { unicodeContains } from './sql.js';

const latestSchemaVersion = 18;

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
fs.mkdirSync(config.mediaRoot, { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.function('unicode_contains', unicodeContains);

export function migrateDatabase(database = db) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const current = database.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get().version;
  if (current > latestSchemaVersion) {
    throw new Error(`Database schema version ${current} is newer than this application supports (version ${latestSchemaVersion}).`);
  }
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

  if (current < 3) {
    const migration = database.transaction(() => {
      database.exec(`
        CREATE TABLE audit_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
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
        INSERT INTO schema_migrations (version) VALUES (3);
      `);
    });
    migration();
  }

  if (current < 4) {
    const migration = database.transaction(() => {
      database.exec(`
        CREATE TABLE lesson_reactions (
          lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          reaction TEXT NOT NULL CHECK (reaction IN ('like', 'dislike')),
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (lesson_id, user_id)
        );
        CREATE INDEX lesson_reactions_lesson ON lesson_reactions(lesson_id, reaction);

        CREATE TABLE lesson_comments (
          id TEXT PRIMARY KEY,
          lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX lesson_comments_lesson_created ON lesson_comments(lesson_id, created_at DESC, id DESC);
        INSERT INTO schema_migrations (version) VALUES (4);
      `);
    });
    migration();
  }

  if (current < 5) {
    const migration = database.transaction(() => {
      database.exec(`
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
        CREATE INDEX course_certificates_user_issued ON course_certificates(user_id, issued_at DESC);
        INSERT INTO schema_migrations (version) VALUES (5);
      `);
    });
    migration();
  }

  if (current < 6) {
    const migration = database.transaction(() => {
      database.exec(`
        CREATE INDEX IF NOT EXISTS lesson_progress_lesson_user ON lesson_progress(lesson_id, user_id);
        CREATE INDEX IF NOT EXISTS quiz_attempts_quiz_user_submitted ON quiz_attempts(quiz_id, user_id, submitted_at DESC);
        INSERT INTO schema_migrations (version) VALUES (6);
      `);
    });
    migration();
  }

  if (current < 7) {
    const migration = database.transaction(() => {
      database.exec('ALTER TABLE sessions ADD COLUMN user_id TEXT');
      const rowsAfter = database.prepare('SELECT rowid AS row_id, session_data FROM sessions WHERE rowid > ? ORDER BY rowid LIMIT ?');
      const saveUserId = database.prepare('UPDATE sessions SET user_id = ? WHERE rowid = ?');
      let lastRowId = 0;
      while (true) {
        const rows = rowsAfter.all(lastRowId, 500);
        if (!rows.length) break;
        for (const row of rows) {
          let userId = null;
          try {
            const sessionData = JSON.parse(row.session_data);
            if (sessionData && typeof sessionData === 'object' && !Array.isArray(sessionData) && typeof sessionData.userId === 'string') {
              userId = sessionData.userId;
            }
          } catch {}
          saveUserId.run(userId, row.row_id);
          lastRowId = row.row_id;
        }
      }
      database.exec(`
        CREATE INDEX sessions_user_id ON sessions(user_id);
        INSERT INTO schema_migrations (version) VALUES (7);
      `);
    });
    migration();
  }

  if (current < 8) {
    const migration = database.transaction(() => {
      database.exec(`
        CREATE INDEX IF NOT EXISTS courses_created_by ON courses(created_by);
        CREATE INDEX IF NOT EXISTS courses_updated_by ON courses(updated_by);
        CREATE INDEX IF NOT EXISTS media_files_course_id ON media_files(course_id);
        CREATE INDEX IF NOT EXISTS lessons_media_id ON lessons(media_id);
        CREATE INDEX IF NOT EXISTS course_grants_granted_by ON course_grants(granted_by);
        CREATE INDEX IF NOT EXISTS audit_logs_actor_user ON audit_logs(actor_user_id);
        CREATE INDEX IF NOT EXISTS lesson_reactions_user ON lesson_reactions(user_id);
        CREATE INDEX IF NOT EXISTS lesson_comments_user ON lesson_comments(user_id);
        CREATE INDEX IF NOT EXISTS course_certificates_course ON course_certificates(course_id);
        INSERT INTO schema_migrations (version) VALUES (8);
      `);
    });
    migration();
  }

  if (current < 9) {
    const migration = database.transaction(() => {
      database.exec(`
        CREATE INDEX IF NOT EXISTS users_role ON users(role);
        INSERT INTO schema_migrations (version) VALUES (9);
      `);
    });
    migration();
  }

  if (current < 10) {
    const migration = database.transaction(() => {
      database.exec(`
        CREATE INDEX IF NOT EXISTS users_role_username ON users(role, username COLLATE NOCASE);
        DROP INDEX IF EXISTS users_role;
        INSERT INTO schema_migrations (version) VALUES (10);
      `);
    });
    migration();
  }

  if (current < 11) {
    const migration = database.transaction(() => {
      database.exec(`
        CREATE INDEX IF NOT EXISTS users_management_order ON users(
          CASE role WHEN 'admin' THEN 1 WHEN 'moderator' THEN 2 ELSE 3 END,
          username COLLATE NOCASE
        );
        INSERT INTO schema_migrations (version) VALUES (11);
      `);
    });
    migration();
  }

  if (current < 12) {
    const migration = database.transaction(() => {
      database.exec(`
        ALTER TABLE lessons ADD COLUMN transcript TEXT NOT NULL DEFAULT '';
        INSERT INTO schema_migrations (version) VALUES (12);
      `);
    });
    migration();
  }

  if (current < 13) {
    const migration = database.transaction(() => {
      database.exec(`
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
        CREATE INDEX lesson_captions_lesson ON lesson_captions(lesson_id, language);
        INSERT INTO schema_migrations (version) VALUES (13);
      `);
    });
    migration();
  }

  if (current < 14) {
    const migration = database.transaction(() => {
      database.exec(`
        DROP INDEX IF EXISTS lesson_captions_lesson;
        INSERT INTO schema_migrations (version) VALUES (14);
      `);
    });
    migration();
  }

  if (current < 15) {
    const migration = database.transaction(() => {
      database.exec(`
        DROP INDEX IF EXISTS modules_course_position;
        INSERT INTO schema_migrations (version) VALUES (15);
      `);
    });
    migration();
  }

  if (current < 16) {
    const migration = database.transaction(() => {
      database.exec(`
        ALTER TABLE users ADD COLUMN last_login_at TEXT;
        UPDATE users
        SET last_login_at = (
          SELECT MAX(occurred_at)
          FROM audit_logs
          WHERE actor_user_id = users.id AND action IN ('auth.signed_in', 'account.registered', 'platform.setup')
        );
        INSERT INTO schema_migrations (version) VALUES (16);
      `);
    });
    migration();
  }

  if (current < 17) {
    const migration = database.transaction(() => {
      database.exec(`
        ALTER TABLE users ADD COLUMN email TEXT;
        CREATE UNIQUE INDEX users_email_unique ON users(email COLLATE NOCASE) WHERE email IS NOT NULL;
        INSERT INTO schema_migrations (version) VALUES (17);
      `);
    });
    migration();
  }

  if (current < 18) {
    const migration = database.transaction(() => {
      database.exec(`
        CREATE TABLE user_registration_field_values (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          field_id TEXT NOT NULL,
          field_label TEXT NOT NULL,
          field_type TEXT NOT NULL CHECK (field_type IN ('date', 'text', 'select', 'checkbox')),
          field_value TEXT NOT NULL,
          position INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (user_id, field_id)
        );
        CREATE INDEX user_registration_fields_order ON user_registration_field_values(user_id, position);
        INSERT INTO schema_migrations (version) VALUES (18);
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
