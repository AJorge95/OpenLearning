import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const isolatedConfig = {
  NODE_ENV: 'test', DATA_DIR: '', DB_PATH: '', MEDIA_ROOT: '',
  SESSION_SECRET: 'isolated-certificate-tests', TRUST_PROXY: 'false', PORT: '3000',
  MAX_UPLOAD_BYTES: '2147483648', REQUEST_TIMEOUT_MS: '300000',
};
const previousConfig = new Map(Object.keys(isolatedConfig).map((key) => [key, process.env[key]]));
let fixtureDirectory;
let database;
let setSetting;
let certificates;

function createFixtureDirectory() {
  const tempBase = path.resolve(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(tempBase, 'openlearning-certificates-'));
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== tempBase || !path.basename(resolved).startsWith('openlearning-certificates-')) {
    throw new Error('Refusing to use an unexpected temporary directory.');
  }
  return resolved;
}

function removeFixtureDirectory(directory) {
  if (!directory) return;
  const tempBase = path.resolve(os.tmpdir());
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== tempBase || !path.basename(resolved).startsWith('openlearning-certificates-')) {
    throw new Error('Refusing to remove an unexpected temporary directory.');
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

before(async () => {
  fixtureDirectory = createFixtureDirectory();
  Object.assign(process.env, {
    ...isolatedConfig,
    DATA_DIR: fixtureDirectory,
    DB_PATH: path.join(fixtureDirectory, 'openlearning.sqlite'),
    MEDIA_ROOT: path.join(fixtureDirectory, 'course-media'),
  });
  ({ db: database, setSetting } = await import('./db.js'));
  certificates = await import('./certificate-service.js');
  setSetting('platform_name', 'OpenLearning Training');

  database.prepare(`INSERT INTO users (id, username, email, first_name, last_name, password_hash, role)
    VALUES (?, ?, ?, ?, ?, ?, 'learner')`).run('certificate-learner', 'certificate_learner', 'learner@example.invalid', 'Taylor', 'Nguyen', 'not-used');
  database.prepare(`INSERT INTO users (id, username, email, first_name, last_name, password_hash, role)
    VALUES (?, ?, ?, ?, ?, ?, 'learner')`).run('certificate-legacy', 'certificate_legacy', 'legacy@example.invalid', '', '', 'not-used');
  database.prepare(`INSERT INTO courses (id, title, status, created_by, updated_by)
    VALUES ('certificate-course', 'Completing Courses Well', 'published', 'certificate-learner', 'certificate-learner')`).run();
  database.prepare(`INSERT INTO course_modules (id, course_id, title, position)
    VALUES ('certificate-module', 'certificate-course', 'Start here', 0)`).run();
  database.prepare(`INSERT INTO lessons (id, module_id, title, position)
    VALUES ('certificate-lesson', 'certificate-module', 'First lesson', 0)`).run();
  database.prepare(`INSERT INTO course_versions
    (id, course_id, storage_course_id, version_number, published_by, requires_recompletion, change_note)
    VALUES ('certificate-version', 'certificate-course', 'certificate-course', 1, 'certificate-learner', 0, 'Initial publication')`).run();
  const enroll = database.prepare('INSERT INTO enrollments (id, course_id, user_id) VALUES (?, ?, ?)');
  const completeLesson = database.prepare('INSERT INTO lesson_progress (user_id, lesson_id) VALUES (?, ?)');
  for (const userId of ['certificate-learner', 'certificate-legacy']) {
    enroll.run(`enrollment-${userId}`, 'certificate-course', userId);
    completeLesson.run(userId, 'certificate-lesson');
  }
});

after(() => {
  if (database?.open) database.close();
  removeFixtureDirectory(fixtureDirectory);
  for (const [key, value] of previousConfig) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('certificate pages use an index for stable newest-first ordering', () => {
  const plan = database.prepare(`EXPLAIN QUERY PLAN SELECT * FROM course_certificates WHERE user_id = ?
    ORDER BY issued_at DESC, id DESC LIMIT ? OFFSET ?`).all('certificate-learner', 20, 0)
    .map((step) => step.detail).join('\n');

  assert.match(plan, /course_certificates_user_issued/);
  assert.doesNotMatch(plan, /USE TEMP B-TREE FOR/);
});

test('completed courses receive one version-specific certificate with a name and email snapshot', () => {
  const user = { id: 'certificate-learner', role: 'learner' };
  const certificate = certificates.issueCertificateIfComplete('certificate-course', user);
  assert.ok(certificate);
  assert.equal(certificate.recipientName, 'Taylor Nguyen');
  assert.equal(certificate.recipientEmail, 'learner@example.invalid');
  assert.equal(certificate.courseTitle, 'Completing Courses Well');
  assert.equal(certificate.platformName, 'OpenLearning Training');
  assert.equal(certificate.courseVersionId, 'certificate-version');
  assert.match(certificate.certificateCode, /^OL-[A-F0-9]{32}$/);
  assert.deepEqual(certificates.issueCertificateIfComplete('certificate-course', user), certificate);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM course_certificates WHERE user_id = ?').get(user.id).count, 1);
});

test('legacy learners receive a certificate after adding their name to their profile', () => {
  assert.equal(certificates.issueCertificateIfComplete('certificate-course', { id: 'certificate-legacy', role: 'learner' }), null);
  database.prepare("UPDATE users SET first_name = 'Morgan', last_name = 'Reed' WHERE id = 'certificate-legacy'").run();
  const issued = certificates.issueCompletedCertificatesForUser('certificate-legacy');
  assert.equal(issued.length, 1);
  assert.equal(issued[0].recipientName, 'Morgan Reed');
  assert.equal(issued[0].recipientEmail, 'legacy@example.invalid');
  assert.equal(certificates.issueCompletedCertificatesForUser('certificate-legacy').length, 0);
});

test('certificate backfill maps completed version-storage courses to their logical course', () => {
  database.prepare(`INSERT INTO users (id, username, email, first_name, last_name, password_hash, role)
    VALUES ('certificate-versioned-learner', 'certificate_versioned', 'versioned@example.invalid', 'Casey', 'Morgan', 'not-used', 'learner')`).run();
  database.prepare(`INSERT INTO courses (id, title, status, created_by, updated_by)
    VALUES ('certificate-logical-course', 'Versioned course', 'published', 'certificate-learner', 'certificate-learner')`).run();
  database.prepare(`INSERT INTO courses (id, title, status, created_by, updated_by, logical_course_id)
    VALUES ('certificate-storage-course', 'Versioned course', 'published', 'certificate-learner', 'certificate-learner', 'certificate-logical-course')`).run();
  database.prepare(`INSERT INTO course_modules (id, course_id, title, position)
    VALUES ('certificate-storage-module', 'certificate-storage-course', 'Module', 0)`).run();
  database.prepare(`INSERT INTO lessons (id, module_id, title, position, stable_id)
    VALUES ('certificate-storage-lesson', 'certificate-storage-module', 'Lesson', 0, 'certificate-stable-lesson')`).run();
  database.prepare(`INSERT INTO course_versions
    (id, course_id, storage_course_id, version_number, published_by, requires_recompletion, change_note)
    VALUES ('certificate-storage-version', 'certificate-logical-course', 'certificate-storage-course', 1, 'certificate-learner', 0, 'Initial publication')`).run();
  database.prepare('INSERT INTO lesson_progress (user_id, lesson_id) VALUES (?, ?)')
    .run('certificate-versioned-learner', 'certificate-storage-lesson');

  const issued = certificates.issueCompletedCertificatesForUser('certificate-versioned-learner');
  assert.equal(issued.length, 1);
  assert.equal(issued[0].courseId, 'certificate-logical-course');
  assert.equal(issued[0].courseVersionId, 'certificate-storage-version');
  assert.equal(issued[0].recipientName, 'Casey Morgan');
});

test('certificate backfill finds courses completed with a passed quiz', () => {
  database.prepare(`INSERT INTO users (id, username, email, first_name, last_name, password_hash, role)
    VALUES ('certificate-quiz-learner', 'certificate_quiz_learner', 'quiz@example.invalid', 'Jamie', 'Lee', 'not-used', 'learner')`).run();
  database.prepare(`INSERT INTO courses (id, title, status, created_by, updated_by)
    VALUES ('certificate-quiz-course', 'Quiz course', 'published', 'certificate-learner', 'certificate-learner')`).run();
  database.prepare(`INSERT INTO course_modules (id, course_id, title, position)
    VALUES ('certificate-quiz-module', 'certificate-quiz-course', 'Module', 0)`).run();
  database.prepare(`INSERT INTO quizzes (id, module_id, title, pass_mark)
    VALUES ('certificate-quiz', 'certificate-quiz-module', 'Assessment', 70)`).run();
  database.prepare(`INSERT INTO course_versions
    (id, course_id, storage_course_id, version_number, published_by, requires_recompletion, change_note)
    VALUES ('certificate-quiz-version', 'certificate-quiz-course', 'certificate-quiz-course', 1, 'certificate-learner', 0, 'Initial publication')`).run();
  database.prepare(`INSERT INTO quiz_attempts
    (id, quiz_id, user_id, score, passed, answers_json, question_snapshot_json)
    VALUES ('certificate-quiz-attempt', 'certificate-quiz', 'certificate-quiz-learner', 90, 1, '{}', '[]')`).run();

  const issued = certificates.issueCompletedCertificatesForUser('certificate-quiz-learner');
  assert.equal(issued.length, 1);
  assert.equal(issued[0].courseId, 'certificate-quiz-course');
  assert.equal(issued[0].courseVersionId, 'certificate-quiz-version');
});

test('certificate backfill skips inactive catalog courses beyond a batch boundary', () => {
  database.prepare(`INSERT INTO users (id, username, email, first_name, last_name, password_hash, role)
    VALUES ('certificate-query-learner', 'certificate_query', 'query@example.invalid', 'Sam', 'Rivera', 'not-used', 'learner')`).run();

  function addIncompleteCourse(position) {
    const courseId = `certificate-query-course-${position}`;
    const moduleId = `certificate-query-module-${position}`;
    const lessonId = `certificate-query-lesson-${position}`;
    const versionId = `certificate-query-version-${position}`;
    database.prepare(`INSERT INTO courses (id, title, status, created_by, updated_by)
      VALUES (?, ?, 'published', 'certificate-learner', 'certificate-learner')`).run(courseId, `Course ${position}`);
    database.prepare(`INSERT INTO course_modules (id, course_id, title, position)
      VALUES (?, ?, 'Module', 0)`).run(moduleId, courseId);
    database.prepare(`INSERT INTO lessons (id, module_id, title, position)
      VALUES (?, ?, 'Lesson', 0)`).run(lessonId, moduleId);
    database.prepare(`INSERT INTO course_versions
      (id, course_id, storage_course_id, version_number, published_by, requires_recompletion, change_note)
      VALUES (?, ?, ?, 1, 'certificate-learner', 0, 'Initial publication')`).run(versionId, courseId, courseId);
  }

  function countBackfillQueries() {
    const originalPrepare = database.prepare;
    let queryCount = 0;
    database.prepare = (sql) => {
      queryCount += 1;
      return originalPrepare.call(database, sql);
    };
    try {
      assert.deepEqual(certificates.issueCompletedCertificatesForUser('certificate-query-learner'), []);
      return queryCount;
    } finally { delete database.prepare; }
  }

  addIncompleteCourse(1);
  const queryPlan = database.prepare(`EXPLAIN QUERY PLAN SELECT * FROM courses c
    WHERE c.status = 'published' AND c.logical_course_id IS NULL AND c.id IN (
      SELECT COALESCE(storage.logical_course_id, storage.id)
      FROM lesson_progress p JOIN lessons l ON l.id = p.lesson_id
      JOIN course_modules m ON m.id = l.module_id JOIN courses storage ON storage.id = m.course_id
      WHERE p.user_id = ?
      UNION
      SELECT COALESCE(storage.logical_course_id, storage.id)
      FROM quiz_attempts a JOIN quizzes q ON q.id = a.quiz_id
      JOIN course_modules m ON m.id = q.module_id JOIN courses storage ON storage.id = m.course_id
      WHERE a.user_id = ? AND a.passed = 1
    ) ORDER BY c.id`).all('certificate-query-learner', 'certificate-query-learner')
    .map((step) => step.detail).join('\n');
  assert.match(queryPlan, /SEARCH p USING.*user_id=\?/);
  assert.match(queryPlan, /SEARCH a USING.*user_id=\?/);

  const oneAdditionalCourse = countBackfillQueries();
  for (let position = 2; position <= 205; position += 1) addIncompleteCourse(position);
  const manyAdditionalCourses = countBackfillQueries();
  assert.equal(manyAdditionalCourses, oneAdditionalCourse,
    `Expected courses without learner activity to be skipped, got ${oneAdditionalCourse} then ${manyAdditionalCourses} prepared statements.`);
});
