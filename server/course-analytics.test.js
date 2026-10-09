import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import express from 'express';
import { after, before, test } from 'node:test';

const isolatedConfig = {
  NODE_ENV: 'test',
  DATA_DIR: '',
  DB_PATH: '',
  MEDIA_ROOT: '',
  SESSION_SECRET: 'isolated-course-analytics-tests',
  TRUST_PROXY: 'false',
  PORT: '3000',
  MAX_UPLOAD_BYTES: '2147483648',
  REQUEST_TIMEOUT_MS: '300000',
};
const previousConfig = new Map(Object.keys(isolatedConfig).map((key) => [key, process.env[key]]));
let fixtureDirectory;
let database;
let server;

function createFixtureDirectory() {
  const tempBase = path.resolve(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(tempBase, 'openlearning-course-analytics-'));
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== tempBase
    || !path.basename(resolvedDirectory).startsWith('openlearning-course-analytics-')) {
    throw new Error('Refusing to use an unexpected temporary directory.');
  }
  return resolvedDirectory;
}

function removeFixtureDirectory(directory) {
  if (!directory) return;
  const tempBase = path.resolve(os.tmpdir());
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== tempBase
    || !path.basename(resolvedDirectory).startsWith('openlearning-course-analytics-')) {
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

  ({ db: database } = await import('./db.js'));
  const [{ courseRouter }, { errorHandler }] = await Promise.all([
    import('./routes-courses.js'),
    import('./http.js'),
  ]);
  database.exec(`
    INSERT INTO users (id, username, email, password_hash, role, disabled) VALUES
      ('admin-1', 'admin', 'admin@example.invalid', 'not-used', 'admin', 0),
      ('learner-active', 'learner_active', 'active@example.invalid', 'not-used', 'learner', 0),
      ('learner-disabled', 'learner_disabled', 'disabled@example.invalid', 'not-used', 'learner', 1),
      ('learner-unassigned', 'learner_unassigned', 'unassigned@example.invalid', 'not-used', 'learner', 0);
    INSERT INTO courses (id, title, status, created_by, updated_by) VALUES
      ('course-analytics', 'Analytics course', 'published', 'admin-1', 'admin-1'),
      ('course-empty', 'Empty course', 'published', 'admin-1', 'admin-1');
    INSERT INTO course_modules (id, course_id, title, position)
      VALUES ('module-analytics', 'course-analytics', 'Analytics module', 0);
    INSERT INTO lessons (id, module_id, title, position)
      VALUES ('lesson-analytics', 'module-analytics', 'Analytics lesson', 0);
    INSERT INTO quizzes (id, module_id, title, pass_mark)
      VALUES ('quiz-analytics', 'module-analytics', 'Analytics quiz', 70);
    INSERT INTO enrollments (id, course_id, user_id, enrolled_at) VALUES
      ('enrollment-active', 'course-analytics', 'learner-active', '2026-10-01 09:00:00'),
      ('enrollment-disabled', 'course-analytics', 'learner-disabled', '2026-10-01 09:00:00');
    INSERT INTO course_grants (id, course_id, user_id, granted_by, granted_at)
      VALUES ('grant-active', 'course-analytics', 'learner-active', 'admin-1', '2026-10-01 08:00:00');
    INSERT INTO lesson_progress (user_id, lesson_id, completed_at) VALUES
      ('learner-active', 'lesson-analytics', '2026-10-01 10:00:00'),
      ('learner-unassigned', 'lesson-analytics', '2026-10-01 11:00:00');
    INSERT INTO quiz_attempts
      (id, quiz_id, user_id, score, passed, answers_json, question_snapshot_json, submitted_at) VALUES
      ('attempt-active-failed', 'quiz-analytics', 'learner-active', 50, 0, '{}', '[]', '2026-10-01 12:00:00'),
      ('attempt-active-passed', 'quiz-analytics', 'learner-active', 100, 1, '{}', '[]', '2026-10-02 12:00:00'),
      ('attempt-disabled-failed', 'quiz-analytics', 'learner-disabled', 60, 0, '{}', '[]', '2026-10-03 12:00:00'),
      ('attempt-unassigned-passed', 'quiz-analytics', 'learner-unassigned', 90, 1, '{}', '[]', '2026-10-04 12:00:00');
  `);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.currentUser = database.prepare('SELECT id, username, role, disabled FROM users WHERE id = ?')
      .get(req.get('x-test-user'));
    next();
  });
  app.use('/api', courseRouter);
  app.use(errorHandler);
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

function userHeaders(userId) {
  return { 'x-test-user': userId, connection: 'close' };
}

test('analytics count each eligible learner once and report course-wide completion and weighted quiz metrics', async () => {
  const response = await fetch(apiUrl('/manage/courses/course-analytics/analytics'), {
    headers: userHeaders('admin-1'),
  });
  assert.equal(response.status, 200);
  const result = await response.json();

  assert.deepEqual(result.summary, {
    learnerCount: 2,
    disabledLearnerCount: 1,
    startedLearnerCount: 2,
    completedLearnerCount: 1,
    completionRate: 50,
    averageProgress: 50,
    lessonCount: 1,
    quizCount: 1,
    lessonCompletions: 1,
    quizAttempts: 3,
  });
  assert.deepEqual(result.lessonMetrics, [{
    id: 'lesson-analytics',
    title: 'Analytics lesson',
    moduleTitle: 'Analytics module',
    completedCount: 1,
    completionRate: 50,
  }]);
  assert.deepEqual(result.quizMetrics, [{
    id: 'quiz-analytics',
    title: 'Analytics quiz',
    moduleTitle: 'Analytics module',
    passMark: 70,
    attempts: 3,
    learnersAttempted: 2,
    learnersPassed: 1,
    participationRate: 100,
    passRate: 50,
    averageScore: 70,
  }]);

  const active = result.learners.find((learner) => learner.id === 'learner-active');
  assert.equal(active.progress, 100);
  assert.equal(active.completed, true);
  assert.equal(active.lessonProgress[0].completedAt, '2026-10-01 10:00:00');
  assert.equal(active.quizProgress[0].attempts, 2);
  assert.equal(active.quizProgress[0].highestScore, 100);
  assert.equal(active.quizProgress[0].latestScore, 100);
  assert.equal(active.lastActivityAt, '2026-10-02 12:00:00');

  const disabled = result.learners.find((learner) => learner.id === 'learner-disabled');
  assert.equal(disabled.disabled, true);
  assert.equal(disabled.progress, 0);
  assert.equal(disabled.started, true);
  assert.equal(disabled.quizProgress[0].passed, false);
  assert.equal(disabled.lastActivityAt, '2026-10-03 12:00:00');
  assert.equal(result.learners.some((learner) => learner.id === 'learner-unassigned'), false);
});

test('analytics use null rates for a course with no eligible learners or activities', async () => {
  const response = await fetch(apiUrl('/manage/courses/course-empty/analytics'), {
    headers: userHeaders('admin-1'),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.summary.learnerCount, 0);
  assert.equal(result.summary.completionRate, null);
  assert.equal(result.summary.averageProgress, null);
  assert.deepEqual(result.lessonMetrics, []);
  assert.deepEqual(result.quizMetrics, []);
});

test('course analytics remain restricted to staff', async () => {
  const response = await fetch(apiUrl('/manage/courses/course-analytics/analytics'), {
    headers: userHeaders('learner-active'),
  });
  assert.equal(response.status, 403);
});

test('course access learner search matches email and remains limited to learners', async () => {
  const response = await fetch(apiUrl(`/manage/courses/course-analytics/access?q=${encodeURIComponent('UNASSIGNED@EXAMPLE.INVALID')}`), {
    headers: userHeaders('admin-1'),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.total, 1);
  assert.deepEqual(result.users.map((learner) => learner.id), ['learner-unassigned']);
  assert.equal(result.users[0].granted, false);
});

test('module creation rolls back when its audit entry cannot be saved', async () => {
  const initialModuleCount = database.prepare("SELECT COUNT(*) AS count FROM course_modules WHERE course_id = 'course-empty'").get().count;
  const initialAuditCount = database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.module_created'").get().count;
  database.exec(`CREATE TRIGGER reject_module_created_audit BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'course.module_created' BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END`);

  try {
    const failedResponse = await fetch(apiUrl('/manage/courses/course-empty/modules'), {
      method: 'POST',
      headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Unaudited module' }),
    });
    assert.equal(failedResponse.status, 500);
    assert.equal((await failedResponse.json()).code, 'audit_unavailable');
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM course_modules WHERE course_id = 'course-empty'").get().count, initialModuleCount);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.module_created'").get().count, initialAuditCount);
  } finally {
    database.exec('DROP TRIGGER IF EXISTS reject_module_created_audit');
  }

  const retryResponse = await fetch(apiUrl('/manage/courses/course-empty/modules'), {
    method: 'POST',
    headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Audited module' }),
  });
  assert.equal(retryResponse.status, 201);
  const { module } = await retryResponse.json();
  assert.equal(module.title, 'Audited module');
  assert.equal(module.position, initialModuleCount);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.module_created' AND entity_id = ?").get(module.id).count, 1);
});

test('lesson creation rolls back when its audit entry cannot be saved', async () => {
  const initialLessonCount = database.prepare("SELECT COUNT(*) AS count FROM lessons WHERE module_id = 'module-analytics'").get().count;
  const initialAuditCount = database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.lesson_created'").get().count;
  database.exec(`CREATE TRIGGER reject_lesson_created_audit BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'course.lesson_created' BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END`);

  try {
    const failedResponse = await fetch(apiUrl('/manage/modules/module-analytics/lessons'), {
      method: 'POST',
      headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Unaudited lesson' }),
    });
    assert.equal(failedResponse.status, 500);
    assert.equal((await failedResponse.json()).code, 'audit_unavailable');
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM lessons WHERE module_id = 'module-analytics'").get().count, initialLessonCount);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.lesson_created'").get().count, initialAuditCount);
  } finally {
    database.exec('DROP TRIGGER IF EXISTS reject_lesson_created_audit');
  }

  const retryResponse = await fetch(apiUrl('/manage/modules/module-analytics/lessons'), {
    method: 'POST',
    headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Audited lesson' }),
  });
  assert.equal(retryResponse.status, 201);
  const { lesson } = await retryResponse.json();
  assert.equal(lesson.title, 'Audited lesson');
  assert.equal(lesson.position, initialLessonCount);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.lesson_created' AND entity_id = ?").get(lesson.id).count, 1);
});

test('lesson edits roll back when their audit entry cannot be saved', async () => {
  const original = database.prepare("SELECT title FROM lessons WHERE id = 'lesson-analytics'").get().title;
  const initialAuditCount = database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.lesson_updated'").get().count;
  database.exec(`CREATE TRIGGER reject_lesson_updated_audit BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'course.lesson_updated' BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END`);

  try {
    const failedResponse = await fetch(apiUrl('/manage/lessons/lesson-analytics'), {
      method: 'PATCH',
      headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Unaudited lesson edit' }),
    });
    assert.equal(failedResponse.status, 500);
    assert.equal((await failedResponse.json()).code, 'audit_unavailable');
    assert.equal(database.prepare("SELECT title FROM lessons WHERE id = 'lesson-analytics'").get().title, original);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.lesson_updated'").get().count, initialAuditCount);
  } finally {
    database.exec('DROP TRIGGER IF EXISTS reject_lesson_updated_audit');
  }

  const retryResponse = await fetch(apiUrl('/manage/lessons/lesson-analytics'), {
    method: 'PATCH',
    headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Audited lesson edit' }),
  });
  assert.equal(retryResponse.status, 200);
  assert.equal(database.prepare("SELECT title FROM lessons WHERE id = 'lesson-analytics'").get().title, 'Audited lesson edit');
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.lesson_updated' AND entity_id = 'lesson-analytics'").get().count, 1);
});

test('quiz saves roll back when their audit entry cannot be saved', async () => {
  const originalQuiz = database.prepare("SELECT id, title, pass_mark FROM quizzes WHERE module_id = 'module-analytics'").get();
  const initialQuestionCount = database.prepare('SELECT COUNT(*) AS count FROM quiz_questions WHERE quiz_id = ?').get(originalQuiz.id).count;
  const initialAuditCount = database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.quiz_saved'").get().count;
  const quizPayload = {
    title: 'Audited knowledge check',
    passMark: 80,
    questions: [{
      prompt: 'Which answer is correct?',
      explanation: 'The first answer is correct.',
      choices: [{ text: 'Correct', isCorrect: true }, { text: 'Incorrect', isCorrect: false }],
    }],
  };
  database.exec(`CREATE TRIGGER reject_quiz_saved_audit BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'course.quiz_saved' BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END`);

  try {
    const failedResponse = await fetch(apiUrl('/manage/modules/module-analytics/quiz'), {
      method: 'PUT',
      headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
      body: JSON.stringify(quizPayload),
    });
    assert.equal(failedResponse.status, 500);
    assert.equal((await failedResponse.json()).code, 'audit_unavailable');
    assert.deepEqual(database.prepare("SELECT id, title, pass_mark FROM quizzes WHERE module_id = 'module-analytics'").get(), originalQuiz);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM quiz_questions WHERE quiz_id = ?').get(originalQuiz.id).count, initialQuestionCount);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.quiz_saved'").get().count, initialAuditCount);
  } finally {
    database.exec('DROP TRIGGER IF EXISTS reject_quiz_saved_audit');
  }

  const retryResponse = await fetch(apiUrl('/manage/modules/module-analytics/quiz'), {
    method: 'PUT',
    headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
    body: JSON.stringify(quizPayload),
  });
  assert.equal(retryResponse.status, 200);
  assert.equal(database.prepare("SELECT title FROM quizzes WHERE module_id = 'module-analytics'").get().title, quizPayload.title);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM quiz_questions WHERE quiz_id = ?').get(originalQuiz.id).count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.quiz_saved' AND entity_id = ?").get(originalQuiz.id).count, 1);
});

test('quiz deletion rolls back when its audit entry cannot be saved', async () => {
  const quiz = database.prepare("SELECT id FROM quizzes WHERE module_id = 'module-analytics'").get();
  const initialQuestionCount = database.prepare('SELECT COUNT(*) AS count FROM quiz_questions WHERE quiz_id = ?').get(quiz.id).count;
  const initialAuditCount = database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.quiz_deleted'").get().count;
  database.exec(`CREATE TRIGGER reject_quiz_deleted_audit BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'course.quiz_deleted' BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END`);

  try {
    const failedResponse = await fetch(apiUrl('/manage/modules/module-analytics/quiz'), {
      method: 'DELETE',
      headers: userHeaders('admin-1'),
    });
    assert.equal(failedResponse.status, 500);
    assert.equal((await failedResponse.json()).code, 'audit_unavailable');
    assert.equal(database.prepare("SELECT id FROM quizzes WHERE module_id = 'module-analytics'").get().id, quiz.id);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM quiz_questions WHERE quiz_id = ?').get(quiz.id).count, initialQuestionCount);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.quiz_deleted'").get().count, initialAuditCount);
  } finally {
    database.exec('DROP TRIGGER IF EXISTS reject_quiz_deleted_audit');
  }

  const retryResponse = await fetch(apiUrl('/manage/modules/module-analytics/quiz'), {
    method: 'DELETE',
    headers: userHeaders('admin-1'),
  });
  assert.equal(retryResponse.status, 204);
  assert.equal(database.prepare("SELECT id FROM quizzes WHERE module_id = 'module-analytics'").get(), undefined);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM quiz_questions WHERE quiz_id = ?').get(quiz.id).count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.quiz_deleted' AND entity_id = 'module-analytics'").get().count, 1);
});

test('course creation rolls back when its audit entry cannot be saved', async () => {
  const initialCourseCount = database.prepare('SELECT COUNT(*) AS count FROM courses').get().count;
  const initialAuditCount = database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.created'").get().count;
  database.exec(`CREATE TRIGGER reject_course_created_audit BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'course.created' BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END`);

  try {
    const failedResponse = await fetch(apiUrl('/manage/courses'), {
      method: 'POST',
      headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Audit failure course' }),
    });
    assert.equal(failedResponse.status, 500);
    assert.equal((await failedResponse.json()).code, 'audit_unavailable');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM courses').get().count, initialCourseCount);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.created'").get().count, initialAuditCount);
  } finally {
    database.exec('DROP TRIGGER IF EXISTS reject_course_created_audit');
  }

  const retryResponse = await fetch(apiUrl('/manage/courses'), {
    method: 'POST',
    headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Audited course' }),
  });
  assert.equal(retryResponse.status, 201);
  const { course } = await retryResponse.json();
  assert.equal(course.title, 'Audited course');
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.created' AND entity_id = ?").get(course.id).count, 1);
});

test('course updates roll back when their audit entry cannot be saved', async () => {
  database.prepare(`INSERT INTO courses (id, title, status, created_by, updated_by)
    VALUES ('course-update-audit', 'Draft before update', 'draft', 'admin-1', 'admin-1')`).run();
  const original = database.prepare("SELECT title FROM courses WHERE id = 'course-update-audit'").get().title;
  const initialAuditCount = database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.updated'").get().count;
  database.exec(`CREATE TRIGGER reject_course_updated_audit BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'course.updated' BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END`);

  try {
    const failedResponse = await fetch(apiUrl('/manage/courses/course-update-audit'), {
      method: 'PATCH',
      headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Unaudited update' }),
    });
    assert.equal(failedResponse.status, 500);
    assert.equal((await failedResponse.json()).code, 'audit_unavailable');
    assert.equal(database.prepare("SELECT title FROM courses WHERE id = 'course-update-audit'").get().title, original);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.updated'").get().count, initialAuditCount);
  } finally {
    database.exec('DROP TRIGGER IF EXISTS reject_course_updated_audit');
  }

  const retryResponse = await fetch(apiUrl('/manage/courses/course-update-audit'), {
    method: 'PATCH',
    headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Audited update' }),
  });
  assert.equal(retryResponse.status, 200);
  assert.equal((await retryResponse.json()).course.title, 'Audited update');
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.updated' AND entity_id = 'course-update-audit'").get().count, 1);
});

test('course deletion preserves records and media when its audit entry cannot be saved', async () => {
  database.prepare(`INSERT INTO courses (id, title, status, created_by, updated_by)
    VALUES ('course-delete-audit', 'Archived course', 'archived', 'admin-1', 'admin-1')`).run();
  const mediaDirectory = path.join(fixtureDirectory, 'course-media', 'course-delete-audit');
  const mediaPath = path.join(mediaDirectory, 'lesson-video.mp4');
  fs.mkdirSync(mediaDirectory, { recursive: true });
  fs.writeFileSync(mediaPath, 'fixture media');
  const initialAuditCount = database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.deleted'").get().count;
  database.exec(`CREATE TRIGGER reject_course_deleted_audit BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'course.deleted' BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END`);

  try {
    const failedResponse = await fetch(apiUrl('/manage/courses/course-delete-audit'), {
      method: 'DELETE',
      headers: userHeaders('admin-1'),
    });
    assert.equal(failedResponse.status, 500);
    assert.equal((await failedResponse.json()).code, 'audit_unavailable');
    assert.ok(database.prepare("SELECT id FROM courses WHERE id = 'course-delete-audit'").get());
    assert.equal(fs.readFileSync(mediaPath, 'utf8'), 'fixture media');
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.deleted'").get().count, initialAuditCount);
  } finally {
    database.exec('DROP TRIGGER IF EXISTS reject_course_deleted_audit');
  }

  const retryResponse = await fetch(apiUrl('/manage/courses/course-delete-audit'), {
    method: 'DELETE',
    headers: userHeaders('admin-1'),
  });
  assert.equal(retryResponse.status, 204);
  assert.equal(database.prepare("SELECT id FROM courses WHERE id = 'course-delete-audit'").get(), undefined);
  assert.equal(fs.existsSync(mediaDirectory), false);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.deleted' AND entity_id = 'course-delete-audit'").get().count, 1);
});

test('module deletion preserves its content and files when its audit entry cannot be saved', async () => {
  database.exec(`
    INSERT INTO courses (id, title, status, created_by, updated_by)
      VALUES ('course-module-audit', 'Module audit course', 'draft', 'admin-1', 'admin-1');
    INSERT INTO course_modules (id, course_id, title, position)
      VALUES ('module-delete-audit', 'course-module-audit', 'Module with content', 0);
    INSERT INTO media_files (id, course_id, original_name, file_name, mime_type, byte_size, media_kind)
      VALUES ('media-module-audit', 'course-module-audit', 'lesson-video.mp4', 'lesson-video.mp4', 'video/mp4', 13, 'video');
    INSERT INTO lessons (id, module_id, title, media_id, position)
      VALUES ('lesson-module-audit', 'module-delete-audit', 'Lesson with media', 'media-module-audit', 0);
    INSERT INTO lesson_resources (id, lesson_id, resource_type, title, file_name, original_name, mime_type, byte_size, position)
      VALUES ('resource-module-audit', 'lesson-module-audit', 'document', 'Handout', 'handout.pdf', 'handout.pdf', 'application/pdf', 7, 0);
    INSERT INTO lesson_captions (id, lesson_id, language, label, file_name, original_name, byte_size)
      VALUES ('caption-module-audit', 'lesson-module-audit', 'en', 'English', 'lesson.vtt', 'lesson.vtt', 6);
  `);
  const mediaDirectory = path.join(fixtureDirectory, 'course-media', 'course-module-audit');
  fs.mkdirSync(mediaDirectory, { recursive: true });
  for (const fileName of ['lesson-video.mp4', 'handout.pdf', 'lesson.vtt']) {
    fs.writeFileSync(path.join(mediaDirectory, fileName), 'fixture file');
  }
  const initialAuditCount = database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.module_deleted'").get().count;
  database.exec(`CREATE TRIGGER reject_module_deleted_audit BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'course.module_deleted' BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END`);

  try {
    const failedResponse = await fetch(apiUrl('/manage/modules/module-delete-audit'), {
      method: 'DELETE',
      headers: userHeaders('admin-1'),
    });
    assert.equal(failedResponse.status, 500);
    assert.equal((await failedResponse.json()).code, 'audit_unavailable');
    assert.ok(database.prepare("SELECT id FROM course_modules WHERE id = 'module-delete-audit'").get());
    assert.ok(database.prepare("SELECT id FROM lessons WHERE id = 'lesson-module-audit'").get());
    assert.ok(database.prepare("SELECT id FROM media_files WHERE id = 'media-module-audit'").get());
    assert.ok(database.prepare("SELECT id FROM lesson_resources WHERE id = 'resource-module-audit'").get());
    assert.ok(database.prepare("SELECT id FROM lesson_captions WHERE id = 'caption-module-audit'").get());
    for (const fileName of ['lesson-video.mp4', 'handout.pdf', 'lesson.vtt']) {
      assert.equal(fs.readFileSync(path.join(mediaDirectory, fileName), 'utf8'), 'fixture file');
    }
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.module_deleted'").get().count, initialAuditCount);
  } finally {
    database.exec('DROP TRIGGER IF EXISTS reject_module_deleted_audit');
  }

  const retryResponse = await fetch(apiUrl('/manage/modules/module-delete-audit'), {
    method: 'DELETE',
    headers: userHeaders('admin-1'),
  });
  assert.equal(retryResponse.status, 204);
  assert.equal(database.prepare("SELECT id FROM course_modules WHERE id = 'module-delete-audit'").get(), undefined);
  assert.equal(database.prepare("SELECT id FROM lessons WHERE id = 'lesson-module-audit'").get(), undefined);
  assert.equal(database.prepare("SELECT id FROM media_files WHERE id = 'media-module-audit'").get(), undefined);
  assert.equal(database.prepare("SELECT id FROM lesson_resources WHERE id = 'resource-module-audit'").get(), undefined);
  assert.equal(database.prepare("SELECT id FROM lesson_captions WHERE id = 'caption-module-audit'").get(), undefined);
  for (const fileName of ['lesson-video.mp4', 'handout.pdf', 'lesson.vtt']) {
    assert.equal(fs.existsSync(path.join(mediaDirectory, fileName)), false);
  }
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.module_deleted' AND entity_id = 'module-delete-audit'").get().count, 1);
});

test('lesson deletion preserves its content and files when its audit entry cannot be saved', async () => {
  database.exec(`
    INSERT INTO courses (id, title, status, created_by, updated_by)
      VALUES ('course-lesson-delete-audit', 'Lesson audit course', 'draft', 'admin-1', 'admin-1');
    INSERT INTO course_modules (id, course_id, title, position)
      VALUES ('module-lesson-delete-audit', 'course-lesson-delete-audit', 'Lesson module', 0);
    INSERT INTO media_files (id, course_id, original_name, file_name, mime_type, byte_size, media_kind)
      VALUES ('media-lesson-delete-audit', 'course-lesson-delete-audit', 'lesson-video.mp4', 'lesson-video.mp4', 'video/mp4', 13, 'video');
    INSERT INTO lessons (id, module_id, title, media_id, position)
      VALUES ('lesson-delete-audit', 'module-lesson-delete-audit', 'Lesson with attachments', 'media-lesson-delete-audit', 0);
    INSERT INTO lesson_resources (id, lesson_id, resource_type, title, file_name, original_name, mime_type, byte_size, position)
      VALUES ('resource-lesson-delete-audit', 'lesson-delete-audit', 'document', 'Handout', 'handout.pdf', 'handout.pdf', 'application/pdf', 7, 0);
    INSERT INTO lesson_captions (id, lesson_id, language, label, file_name, original_name, byte_size)
      VALUES ('caption-lesson-delete-audit', 'lesson-delete-audit', 'en', 'English', 'lesson.vtt', 'lesson.vtt', 6);
    INSERT INTO lesson_progress (user_id, lesson_id, completed_at)
      VALUES ('learner-active', 'lesson-delete-audit', '2026-10-01 12:00:00');
  `);
  const mediaDirectory = path.join(fixtureDirectory, 'course-media', 'course-lesson-delete-audit');
  fs.mkdirSync(mediaDirectory, { recursive: true });
  for (const fileName of ['lesson-video.mp4', 'handout.pdf', 'lesson.vtt']) {
    fs.writeFileSync(path.join(mediaDirectory, fileName), 'fixture file');
  }
  const initialAuditCount = database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.lesson_deleted'").get().count;
  database.exec(`CREATE TRIGGER reject_lesson_deleted_audit BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'course.lesson_deleted' BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END`);

  try {
    const failedResponse = await fetch(apiUrl('/manage/lessons/lesson-delete-audit'), {
      method: 'DELETE',
      headers: userHeaders('admin-1'),
    });
    assert.equal(failedResponse.status, 500);
    assert.equal((await failedResponse.json()).code, 'audit_unavailable');
    assert.ok(database.prepare("SELECT id FROM lessons WHERE id = 'lesson-delete-audit'").get());
    assert.ok(database.prepare("SELECT user_id FROM lesson_progress WHERE lesson_id = 'lesson-delete-audit'").get());
    assert.ok(database.prepare("SELECT id FROM media_files WHERE id = 'media-lesson-delete-audit'").get());
    assert.ok(database.prepare("SELECT id FROM lesson_resources WHERE id = 'resource-lesson-delete-audit'").get());
    assert.ok(database.prepare("SELECT id FROM lesson_captions WHERE id = 'caption-lesson-delete-audit'").get());
    for (const fileName of ['lesson-video.mp4', 'handout.pdf', 'lesson.vtt']) {
      assert.equal(fs.readFileSync(path.join(mediaDirectory, fileName), 'utf8'), 'fixture file');
    }
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.lesson_deleted'").get().count, initialAuditCount);
  } finally {
    database.exec('DROP TRIGGER IF EXISTS reject_lesson_deleted_audit');
  }

  const retryResponse = await fetch(apiUrl('/manage/lessons/lesson-delete-audit'), {
    method: 'DELETE',
    headers: userHeaders('admin-1'),
  });
  assert.equal(retryResponse.status, 204);
  assert.equal(database.prepare("SELECT id FROM lessons WHERE id = 'lesson-delete-audit'").get(), undefined);
  assert.equal(database.prepare("SELECT user_id FROM lesson_progress WHERE lesson_id = 'lesson-delete-audit'").get(), undefined);
  assert.equal(database.prepare("SELECT id FROM media_files WHERE id = 'media-lesson-delete-audit'").get(), undefined);
  assert.equal(database.prepare("SELECT id FROM lesson_resources WHERE id = 'resource-lesson-delete-audit'").get(), undefined);
  assert.equal(database.prepare("SELECT id FROM lesson_captions WHERE id = 'caption-lesson-delete-audit'").get(), undefined);
  for (const fileName of ['lesson-video.mp4', 'handout.pdf', 'lesson.vtt']) {
    assert.equal(fs.existsSync(path.join(mediaDirectory, fileName)), false);
  }
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.lesson_deleted' AND entity_id = 'lesson-delete-audit'").get().count, 1);
});

test('resource removal preserves its document when its audit entry cannot be saved', async () => {
  database.exec(`
    INSERT INTO courses (id, title, status, created_by, updated_by)
      VALUES ('course-resource-audit', 'Resource audit course', 'draft', 'admin-1', 'admin-1');
    INSERT INTO course_modules (id, course_id, title, position)
      VALUES ('module-resource-audit', 'course-resource-audit', 'Resource module', 0);
    INSERT INTO lessons (id, module_id, title, position)
      VALUES ('lesson-resource-audit', 'module-resource-audit', 'Lesson with handout', 0);
    INSERT INTO lesson_resources (id, lesson_id, resource_type, title, file_name, original_name, mime_type, byte_size, position)
      VALUES ('resource-audit', 'lesson-resource-audit', 'document', 'Handout', 'handout.pdf', 'handout.pdf', 'application/pdf', 7, 0);
  `);
  const mediaDirectory = path.join(fixtureDirectory, 'course-media', 'course-resource-audit');
  const mediaPath = path.join(mediaDirectory, 'handout.pdf');
  fs.mkdirSync(mediaDirectory, { recursive: true });
  fs.writeFileSync(mediaPath, 'fixture handout');
  const initialAuditCount = database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.resource_removed'").get().count;
  database.exec(`CREATE TRIGGER reject_resource_removed_audit BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'course.resource_removed' BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END`);

  try {
    const failedResponse = await fetch(apiUrl('/manage/lessons/lesson-resource-audit/resources/resource-audit'), {
      method: 'DELETE',
      headers: userHeaders('admin-1'),
    });
    assert.equal(failedResponse.status, 500);
    assert.equal((await failedResponse.json()).code, 'audit_unavailable');
    assert.ok(database.prepare("SELECT id FROM lesson_resources WHERE id = 'resource-audit'").get());
    assert.equal(fs.readFileSync(mediaPath, 'utf8'), 'fixture handout');
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.resource_removed'").get().count, initialAuditCount);
  } finally {
    database.exec('DROP TRIGGER IF EXISTS reject_resource_removed_audit');
  }

  const retryResponse = await fetch(apiUrl('/manage/lessons/lesson-resource-audit/resources/resource-audit'), {
    method: 'DELETE',
    headers: userHeaders('admin-1'),
  });
  assert.equal(retryResponse.status, 204);
  assert.equal(database.prepare("SELECT id FROM lesson_resources WHERE id = 'resource-audit'").get(), undefined);
  assert.equal(fs.existsSync(mediaPath), false);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.resource_removed' AND entity_id = 'lesson-resource-audit'").get().count, 1);
});
