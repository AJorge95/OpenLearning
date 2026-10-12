import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import express from 'express';
import { after, before, test } from 'node:test';
import { MAX_LEARNING_PATH_COURSES } from '../../shared/learning-path-limits.js';
import { COMPETENCY_PROGRESS_PAGE_SIZE } from '../../shared/competency-progress.js';

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
let summarizeCourses;
let editableCourse;
let readCurrentPublishedCourse;
let isLessonUnlocked;
let syncPathStates;
let hasCourseGrant;
let createCourseAccessChecker;
let canViewCourse;
let readCourseById;
let requireCourseManagerForTests;
let logicalCourseId;
let publishedVersionForLogicalCourse;

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

  ({ db: database } = await import('../../server/db.js'));
  const [{ courseRouter }, { programsRouter, syncUnlockedPathStates }, { errorHandler, hasCourseGrant: checkCourseGrant, createCourseAccessChecker: makeCourseAccessChecker, canViewCourse: checkCourseVisibility, courseById: readCourseByIdForTests, requireCourseManager: checkRequireCourseManager }, { courseSummaries, isLessonUnlocked: checkLessonUnlocked }, { editableCourse: createEditableCourse, currentPublishedCourse: currentPublishedCourseForTests, logicalCourseId: resolveLogicalCourseId, publishedVersionForLogicalCourse: readPublishedVersionForLogicalCourse }] = await Promise.all([
    import('../../server/routes-courses.js'),
    import('../../server/routes-programs.js'),
    import('../../server/http.js'),
    import('../../server/course-service.js'),
    import('../../server/course-versioning.js'),
  ]);
  summarizeCourses = courseSummaries;
  isLessonUnlocked = checkLessonUnlocked;
  syncPathStates = syncUnlockedPathStates;
  editableCourse = createEditableCourse;
  readCurrentPublishedCourse = currentPublishedCourseForTests;
  hasCourseGrant = checkCourseGrant;
  createCourseAccessChecker = makeCourseAccessChecker;
  canViewCourse = checkCourseVisibility;
  readCourseById = readCourseByIdForTests;
  requireCourseManagerForTests = checkRequireCourseManager;
  logicalCourseId = resolveLogicalCourseId;
  publishedVersionForLogicalCourse = readPublishedVersionForLogicalCourse;
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
  app.use('/api', programsRouter);
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

function insertCourseVersionHistory(courseId, versionCount) {
  const insertHistory = database.transaction(() => {
    database.prepare(`INSERT INTO courses (id, title, status, created_by, updated_by)
      VALUES (?, ?, 'published', 'admin-1', 'admin-1')`).run(courseId, 'Version history pagination');
    const addStorageCourse = database.prepare(`INSERT INTO courses (id, title, status, created_by, updated_by, logical_course_id)
      VALUES (?, ?, 'published', 'admin-1', 'admin-1', ?)`);
    const addVersion = database.prepare(`INSERT INTO course_versions (id, course_id, storage_course_id, version_number, published_by)
      VALUES (?, ?, ?, ?, 'admin-1')`);
    for (let versionNumber = 1; versionNumber <= versionCount; versionNumber += 1) {
      const storageCourseId = versionNumber === 1 ? courseId : `${courseId}-storage-${versionNumber}`;
      if (versionNumber > 1) addStorageCourse.run(storageCourseId, `Version ${versionNumber}`, courseId);
      addVersion.run(`${courseId}-version-${versionNumber}`, courseId, storageCourseId, versionNumber);
    }
  });
  insertHistory();
}

test('course version history pages are bounded, newest first, and clamp stale page requests', async () => {
  const courseId = 'course-version-history-pagination';

  try {
    insertCourseVersionHistory(courseId, 42);
    const fetchPage = async (page) => {
      const response = await fetch(apiUrl(`/manage/courses/${courseId}/versions?page=${page}`), {
        headers: userHeaders('admin-1'),
      });
      assert.equal(response.status, 200);
      return response.json();
    };

    const firstPage = await fetchPage(1);
    assert.equal(firstPage.total, 41);
    assert.equal(firstPage.pageSize, 20);
    assert.equal(firstPage.page, 1);
    assert.equal(firstPage.currentVersion.version_number, 42);
    assert.equal(firstPage.hasMore, true);
    assert.deepEqual(firstPage.versions.map((version) => version.version_number), Array.from({ length: 20 }, (_, index) => 41 - index));

    const secondPage = await fetchPage(2);
    assert.equal(secondPage.page, 2);
    assert.equal(secondPage.currentVersion.version_number, 42);
    assert.equal(secondPage.hasMore, true);
    assert.deepEqual(secondPage.versions.map((version) => version.version_number), Array.from({ length: 20 }, (_, index) => 21 - index));

    const lastPage = await fetchPage(99);
    assert.equal(lastPage.page, 3);
    assert.equal(lastPage.hasMore, false);
    assert.equal(lastPage.currentVersion.version_number, 42);
    assert.deepEqual(lastPage.versions.map((version) => version.version_number), [1]);

    const plan = database.prepare(`EXPLAIN QUERY PLAN SELECT v.*, u.username AS publisher, c.title
      FROM course_versions v LEFT JOIN users u ON u.id = v.published_by
      JOIN courses c ON c.id = v.storage_course_id
      WHERE v.course_id = ? ORDER BY v.version_number DESC LIMIT ? OFFSET ?`).all(courseId, 20, 20);
    assert.ok(plan.some((entry) => entry.detail.includes('course_versions_course_order')), JSON.stringify(plan));
    assert.ok(plan.every((entry) => !entry.detail.includes('USE TEMP B-TREE')), JSON.stringify(plan));
  } finally {
    database.prepare('DELETE FROM courses WHERE id = ?').run(courseId);
  }
});

test('course version history keeps twenty prior versions on a single page', async () => {
  const courseId = 'course-version-history-page-boundary';
  try {
    insertCourseVersionHistory(courseId, 21);
    const fetchPage = async (page) => {
      const response = await fetch(apiUrl(`/manage/courses/${courseId}/versions?page=${page}`), {
        headers: userHeaders('admin-1'),
      });
      assert.equal(response.status, 200);
      return response.json();
    };

    const firstPage = await fetchPage(1);
    assert.equal(firstPage.total, 20);
    assert.equal(firstPage.currentVersion.version_number, 21);
    assert.equal(firstPage.pageSize, 20);
    assert.equal(firstPage.page, 1);
    assert.equal(firstPage.hasMore, false);
    assert.deepEqual(firstPage.versions.map((version) => version.version_number), Array.from({ length: 20 }, (_, index) => 20 - index));

    const stalePage = await fetchPage(2);
    assert.equal(stalePage.page, 1);
    assert.equal(stalePage.total, 20);
    assert.equal(stalePage.hasMore, false);
    assert.deepEqual(stalePage.versions.map((version) => version.version_number), Array.from({ length: 20 }, (_, index) => 20 - index));
  } finally {
    database.prepare('DELETE FROM courses WHERE id = ?').run(courseId);
  }
});

test('editing a versioned course clones caption references to shared media files', () => {
  const courseId = 'course-caption-version';
  try {
    database.exec(`
      INSERT INTO courses (id, title, status, created_by, updated_by)
        VALUES ('course-caption-version', 'Caption version course', 'published', 'admin-1', 'admin-1');
      INSERT INTO course_modules (id, course_id, title, position, stable_id)
        VALUES ('module-caption-version', 'course-caption-version', 'Module', 0, 'module-caption-version-stable');
      INSERT INTO lessons (id, module_id, title, position, stable_id)
        VALUES ('lesson-caption-version', 'module-caption-version', 'Lesson', 0, 'lesson-caption-version-stable');
      INSERT INTO lesson_captions (id, lesson_id, language, label, file_name, original_name, byte_size)
        VALUES ('caption-version-source', 'lesson-caption-version', 'en', 'English', 'shared-caption.vtt', 'captions.vtt', 20);
      INSERT INTO course_versions (id, course_id, storage_course_id, version_number, published_by)
        VALUES ('version-caption-source', 'course-caption-version', 'course-caption-version', 1, 'admin-1');
    `);

    const revision = editableCourse(courseId, { id: 'admin-1' });
    assert.ok(revision?.id);
    assert.notEqual(revision.id, courseId);

    const clonedCaption = database.prepare(`SELECT lc.id, lc.language, lc.file_name FROM lesson_captions lc
      JOIN lessons l ON l.id = lc.lesson_id JOIN course_modules m ON m.id = l.module_id WHERE m.course_id = ?`).get(revision.id);
    assert.ok(clonedCaption?.id);
    assert.equal(clonedCaption.language, 'en');
    assert.equal(clonedCaption.file_name, 'shared-caption.vtt');
    assert.notEqual(clonedCaption.id, 'caption-version-source');
    assert.ok(database.prepare('SELECT 1 FROM course_revisions WHERE course_id = ? AND revision_course_id = ?').get(courseId, revision.id));
  } finally {
    database.prepare('DELETE FROM courses WHERE id = ?').run(courseId);
  }
});

test('concurrent versioned course editors reuse the revision created while they waited', () => {
  const courseId = 'course-concurrent-editor';
  database.exec(`
    INSERT INTO courses (id, title, status, created_by, updated_by)
      VALUES ('course-concurrent-editor', 'Concurrent editor course', 'published', 'admin-1', 'admin-1');
    INSERT INTO course_versions (id, course_id, storage_course_id, version_number, published_by)
      VALUES ('version-concurrent-editor', 'course-concurrent-editor', 'course-concurrent-editor', 1, 'admin-1');
  `);

  const originalTransaction = database.transaction;
  let competingRevision;
  let transactionRequests = 0;
  const interceptedTransaction = (callback) => {
    const transaction = originalTransaction.call(database, callback);
    return {
      immediate(...args) {
        transactionRequests += 1;
        if (transactionRequests === 1) {
          database.transaction = originalTransaction;
          try {
            competingRevision = editableCourse(courseId, { id: 'admin-1' });
          } finally {
            database.transaction = interceptedTransaction;
          }
        }
        return transaction.immediate(...args);
      },
    };
  };

  database.transaction = interceptedTransaction;
  try {
    const revision = editableCourse(courseId, { id: 'admin-1' });
    assert.ok(competingRevision?.id);
    assert.equal(revision?.id, competingRevision.id);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM course_revisions WHERE course_id = ?').get(courseId).count, 1);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM courses WHERE logical_course_id = ?').get(courseId).count, 1);
  } finally {
    database.transaction = originalTransaction;
    database.prepare('DELETE FROM courses WHERE id = ?').run(courseId);
  }
});

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

test('learner-only analytics pages skip course-wide aggregate queries', async () => {
  const fullResponse = await fetch(apiUrl('/manage/courses/course-analytics/analytics?page=1'), {
    headers: userHeaders('admin-1'),
  });
  assert.equal(fullResponse.status, 200);
  const fullPage = await fullResponse.json();

  let aggregateQueryCount = 0;
  const originalPrepare = database.prepare;
  database.prepare = (sql) => {
    if (sql.includes('learner_progress AS (')
      || sql.includes('COUNT(lp.user_id) AS completed_count')
      || sql.includes('learner_quiz AS (')) aggregateQueryCount += 1;
    return originalPrepare.call(database, sql);
  };
  let response;
  try {
    response = await fetch(apiUrl('/manage/courses/course-analytics/analytics?page=1&learnersOnly=1'), {
      headers: userHeaders('admin-1'),
    });
  } finally {
    database.prepare = originalPrepare;
  }

  assert.equal(response.status, 200);
  const learnerPage = await response.json();
  assert.deepEqual(learnerPage.learners, fullPage.learners);
  assert.equal(learnerPage.page, fullPage.page);
  assert.equal(learnerPage.pageSize, fullPage.pageSize);
  assert.equal(learnerPage.learnerCount, fullPage.summary.learnerCount);
  assert.equal(learnerPage.disabledLearnerCount, fullPage.summary.disabledLearnerCount);
  assert.equal('summary' in learnerPage, false);
  assert.equal('lessonMetrics' in learnerPage, false);
  assert.equal('quizMetrics' in learnerPage, false);
  assert.equal(aggregateQueryCount, 0);

  const invalidModeResponse = await fetch(apiUrl('/manage/courses/course-analytics/analytics?learnersOnly=true'), {
    headers: userHeaders('admin-1'),
  });
  assert.equal(invalidModeResponse.status, 400);
  assert.equal((await invalidModeResponse.json()).code, 'validation_error');
});

test('lesson order is enforced for learners while course managers can preview later lessons', () => {
  database.prepare(`INSERT INTO lessons (id, module_id, title, position)
    VALUES ('lesson-analytics-following', 'module-analytics', 'Following lesson', 1)`).run();
  database.prepare(`INSERT INTO users (id, username, email, password_hash, role, disabled)
    VALUES ('learner-preview-check', 'learner_preview_check', 'preview-check@example.invalid', 'not-used', 'learner', 0)`).run();

  try {
    assert.equal(isLessonUnlocked('lesson-analytics-following', {
      id: 'learner-preview-check', role: 'learner',
    }), false);
    assert.equal(isLessonUnlocked('lesson-analytics-following', { id: 'admin-1', role: 'admin' }), true);
  } finally {
    database.prepare('DELETE FROM users WHERE id = ?').run('learner-preview-check');
    database.prepare('DELETE FROM lessons WHERE id = ?').run('lesson-analytics-following');
  }
});

test('course managers must verify video watch before completing lessons in the player', async () => {
  database.prepare(`INSERT INTO media_files
    (id, course_id, original_name, file_name, mime_type, byte_size, media_kind)
    VALUES ('media-admin-watch-check', 'course-analytics', 'lesson.mp4', 'lesson.mp4', 'video/mp4', 16, 'video')`).run();
  database.prepare('UPDATE lessons SET media_id = ? WHERE id = ?').run('media-admin-watch-check', 'lesson-analytics');

  try {
    const response = await fetch(apiUrl('/lessons/lesson-analytics/completion'), {
      method: 'PUT', headers: userHeaders('admin-1'),
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'video_watch_required');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM lesson_progress WHERE user_id = ? AND lesson_id = ?')
      .get('admin-1', 'lesson-analytics').count, 0);

    const log = database.prepare(`SELECT details_json FROM system_logs
      WHERE source = 'lesson-watch' AND message = 'Rejected lesson completion before verified video watch'
      ORDER BY id DESC LIMIT 1`).get();
    assert.equal(JSON.parse(log.details_json).role, 'admin');
  } finally {
    database.prepare('DELETE FROM lesson_progress WHERE user_id = ? AND lesson_id = ?').run('admin-1', 'lesson-analytics');
    database.prepare('DELETE FROM system_logs WHERE source = ? AND message = ?')
      .run('lesson-watch', 'Rejected lesson completion before verified video watch');
    database.prepare('UPDATE lessons SET media_id = NULL WHERE id = ?').run('lesson-analytics');
    database.prepare('DELETE FROM media_files WHERE id = ?').run('media-admin-watch-check');
  }
});

test('course analytics use published version content without creating an edit revision', async () => {
  const courseId = 'course-analytics-current-version';
  const storageCourseId = 'course-analytics-current-storage';
  try {
    database.prepare(`INSERT INTO courses (id, title, category, visibility, status, created_by, updated_by)
      VALUES (?, 'Versioned analytics course', 'Analytics', 'public', 'published', 'admin-1', 'admin-1')`).run(courseId);
    database.prepare(`INSERT INTO courses (id, title, category, visibility, status, created_by, updated_by, logical_course_id)
      VALUES (?, 'Versioned analytics course', 'Analytics', 'public', 'published', 'admin-1', 'admin-1', ?)`)
      .run(storageCourseId, courseId);
    database.prepare(`INSERT INTO course_modules (id, course_id, title, position)
      VALUES ('module-analytics-current-version', ?, 'Published module', 0)`).run(storageCourseId);
    database.prepare(`INSERT INTO lessons (id, module_id, title, position)
      VALUES ('lesson-analytics-current-version', 'module-analytics-current-version', 'Published lesson', 0)`).run();
    database.prepare(`INSERT INTO course_versions (id, course_id, storage_course_id, version_number, published_by)
      VALUES ('version-analytics-current-version', ?, ?, 1, 'admin-1')`).run(courseId, storageCourseId);

    const response = await fetch(apiUrl(`/manage/courses/${courseId}/analytics`), { headers: userHeaders('admin-1') });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.course.id, courseId);
    assert.equal(result.course.title, 'Versioned analytics course');
    assert.deepEqual(result.lessonMetrics.map((lesson) => lesson.id), ['lesson-analytics-current-version']);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM course_revisions WHERE course_id = ?').get(courseId).count, 0);
  } finally {
    database.prepare('DELETE FROM courses WHERE id = ?').run(courseId);
  }
});

test('current published course loads the latest storage course and falls back to the root course', () => {
  const courseId = 'course-current-published-lookup';
  const unversionedCourseId = `${courseId}-unversioned`;
  const previousStorageId = `${courseId}-v1`;
  const currentStorageId = `${courseId}-v2`;
  database.exec(`
    INSERT INTO courses (id, title, status, created_by, updated_by) VALUES
      ('${courseId}', 'Canonical course', 'published', 'admin-1', 'admin-1'),
      ('${unversionedCourseId}', 'Unversioned course', 'published', 'admin-1', 'admin-1');
    INSERT INTO courses (id, title, status, created_by, updated_by, logical_course_id) VALUES
      ('${previousStorageId}', 'Previous title', 'published', 'admin-1', 'admin-1', '${courseId}'),
      ('${currentStorageId}', 'Current title', 'published', 'admin-1', 'admin-1', '${courseId}');
  `);
  database.prepare(`INSERT INTO course_versions (id, course_id, storage_course_id, version_number, published_by)
    VALUES ('${courseId}-version-1', ?, ?, 1, 'admin-1'), ('${courseId}-version-2', ?, ?, 2, 'admin-1')`)
    .run(courseId, previousStorageId, courseId, currentStorageId);

  const originalPrepare = database.prepare;
  let preparedStatementCount = 0;
  try {
    database.prepare = (sql) => {
      preparedStatementCount += 1;
      return originalPrepare.call(database, sql);
    };

    const course = readCurrentPublishedCourse(courseId);
    assert.equal(course?.id, currentStorageId);
    assert.equal(course?.title, 'Current title');
    assert.equal(preparedStatementCount, 1, 'expected only the combined current-course lookup to be prepared per call');

    preparedStatementCount = 0;
    const unversionedCourse = readCurrentPublishedCourse(unversionedCourseId);
    assert.equal(unversionedCourse?.id, unversionedCourseId);
    assert.equal(unversionedCourse?.title, 'Unversioned course');
    assert.equal(preparedStatementCount, 1, 'expected only the current-course lookup to be prepared per call');
  } finally {
    database.prepare = originalPrepare;
    database.prepare('DELETE FROM courses WHERE id IN (?, ?)').run(courseId, unversionedCourseId);
  }
});

test('course detail reuses its published version in the progress summary', async () => {
  const courseId = 'course-detail-version-reuse';
  const storageCourseId = `${courseId}-v1`;
  database.exec(`
    INSERT INTO courses (id, title, visibility, status, created_by, updated_by)
      VALUES ('${courseId}', 'Version reuse course', 'public', 'published', 'admin-1', 'admin-1');
    INSERT INTO courses (id, title, visibility, status, created_by, updated_by, logical_course_id)
      VALUES ('${storageCourseId}', 'Version reuse course', 'public', 'published', 'admin-1', 'admin-1', '${courseId}');
    INSERT INTO course_modules (id, course_id, title, position)
      VALUES ('${courseId}-module', '${storageCourseId}', 'Module', 0);
    INSERT INTO lessons (id, module_id, title, position)
      VALUES ('${courseId}-lesson', '${courseId}-module', 'Lesson', 0);
    INSERT INTO course_versions (id, course_id, storage_course_id, version_number, published_by)
      VALUES ('${courseId}-version', '${courseId}', '${storageCourseId}', 1, 'admin-1');
    INSERT INTO lesson_progress (user_id, lesson_id, completed_at)
      VALUES ('learner-active', '${courseId}-lesson', '2026-10-10 12:00:00');
  `);

  const originalPrepare = database.prepare;
  let summaryVersionQueryCount = 0;
  const preparedSql = [];
  try {
    database.prepare = (sql) => {
      const normalizedSql = sql.replace(/\s+/g, ' ').trim();
      preparedSql.push(normalizedSql);
      if (normalizedSql.includes('SELECT v.course_id, v.id, v.storage_course_id, v.version_number')) summaryVersionQueryCount += 1;
      return originalPrepare.call(database, sql);
    };

    const response = await fetch(apiUrl(`/courses/${courseId}`), { headers: userHeaders('learner-active') });
    assert.equal(response.status, 200);
    const { course } = await response.json();
    assert.equal(course.versionNumber, 1);
    assert.equal(course.completedLessons, 1);
    assert.equal(course.progress, 100);
    assert.equal(course.modules[0].lessons[0].id, `${courseId}-lesson`);
    assert.equal(course.modules[0].lessons[0].completed, true);
    assert.equal(summaryVersionQueryCount, 0, 'expected the preloaded version to serve the progress summary');
    assert.equal(preparedSql.filter((sql) => sql.startsWith('SELECT id, logical_course_id FROM courses WHERE id = ?')).length, 0,
      'expected course access to use the loaded root row without resolving its logical ID again');
    assert.equal(preparedSql.some((sql) => sql.startsWith('SELECT * FROM courses WHERE id = COALESCE(')), false,
      'expected the course row lookup to reuse the preloaded storage course ID');
    assert.equal(preparedSql.filter((sql) => sql === 'SELECT * FROM courses WHERE id = ?').length, 1,
      'expected the preprepared course lookup and only the separate storage-row lookup for the request');
    assert.equal(preparedSql.some((sql) => sql.startsWith('SELECT * FROM courses WHERE id IN (')), false,
      'expected the preloaded published row to serve the course summary');
    const duplicateProgressQueries = preparedSql.filter((sql) => [
      'SELECT l.id, COALESCE(l.stable_id, l.id) AS stable_id FROM lessons l JOIN course_modules m ON m.id = l.module_id WHERE m.course_id = ?',
      'SELECT q.id, COALESCE(q.stable_id, q.id) AS stable_id FROM quizzes q JOIN course_modules m ON m.id = q.module_id WHERE m.course_id = ?',
      'SELECT target_version_id FROM course_learning_state WHERE user_id = ? AND course_id = ?',
      'SELECT l.id, COALESCE(l.stable_id, l.id) AS stable_id FROM lesson_progress p',
      'SELECT DISTINCT q.id, COALESCE(q.stable_id, q.id) AS stable_id FROM quiz_attempts a',
    ].some((prefix) => sql.startsWith(prefix)));
    assert.deepEqual(duplicateProgressQueries, [], 'expected the summary progress reads to be reused for course detail state');
  } finally {
    database.prepare = originalPrepare;
    database.prepare('DELETE FROM lesson_progress WHERE lesson_id = ?').run(`${courseId}-lesson`);
    database.prepare('DELETE FROM courses WHERE id = ?').run(courseId);
  }
});

test('course list exposes the current review status for unpublished revisions', async () => {
  const courseId = 'course-review-list';
  try {
    database.prepare(`INSERT INTO courses (id, title, status, created_by, updated_by)
      VALUES (?, 'Review list course', 'published', 'admin-1', 'admin-1')`).run(courseId);
    database.prepare(`INSERT INTO course_versions (id, course_id, storage_course_id, version_number, published_by)
      VALUES ('version-review-list', ?, ?, 1, 'admin-1')`).run(courseId, courseId);
    assert.ok(editableCourse(courseId, { id: 'admin-1' }));

    for (const reviewStatus of ['draft', 'in_review', 'changes_requested']) {
      database.prepare('UPDATE course_revisions SET review_status = ? WHERE course_id = ?').run(reviewStatus, courseId);
      const response = await fetch(apiUrl('/manage/courses?status=all'), { headers: userHeaders('admin-1') });
      assert.equal(response.status, 200);
      const result = await response.json();
      const course = result.courses.find((item) => item.id === courseId);
      assert.equal(course?.hasUnpublishedChanges, true);
      assert.equal(course?.reviewStatus, reviewStatus);
    }
  } finally {
    database.prepare('DELETE FROM courses WHERE id = ?').run(courseId);
  }
});

test('published course management list returns later pages for learning-path options', async () => {
  const titlePrefix = 'Path option pagination fixture';
  const courseIds = Array.from({ length: 51 }, (_, index) => `path-options-pagination-${index + 1}`);
  const insertCourse = database.prepare(`INSERT INTO courses (id, title, status, created_by, updated_by)
    VALUES (?, ?, 'published', 'admin-1', 'admin-1')`);
  try {
    courseIds.forEach((courseId, index) => insertCourse.run(courseId, `${titlePrefix} ${index + 1}`));

    const pageOneResponse = await fetch(apiUrl(`/manage/courses?status=published&q=${encodeURIComponent(titlePrefix)}&page=1`), {
      headers: userHeaders('admin-1'),
    });
    assert.equal(pageOneResponse.status, 200);
    const pageOne = await pageOneResponse.json();
    assert.equal(pageOne.total, courseIds.length);
    assert.equal(pageOne.page, 1);
    assert.equal(pageOne.pageSize, 50);
    assert.equal(pageOne.courses.length, 50);

    const pageTwoResponse = await fetch(apiUrl(`/manage/courses?status=published&q=${encodeURIComponent(titlePrefix)}&page=2`), {
      headers: userHeaders('admin-1'),
    });
    assert.equal(pageTwoResponse.status, 200);
    const pageTwo = await pageTwoResponse.json();
    assert.equal(pageTwo.total, courseIds.length);
    assert.equal(pageTwo.page, 2);
    assert.equal(pageTwo.courses.length, 1);

    const returnedIds = [...pageOne.courses, ...pageTwo.courses].map((course) => course.id);
    assert.equal(new Set(returnedIds).size, courseIds.length);
    assert.deepEqual(returnedIds.slice().sort(), courseIds.slice().sort());
  } finally {
    database.prepare('DELETE FROM courses WHERE id LIKE ?').run('path-options-pagination-%');
  }
});

test('learner catalog hides version snapshots from results and categories', async () => {
  const courseId = 'course-catalog-root';
  try {
    database.prepare(`INSERT INTO courses (id, title, category, visibility, status, created_by, updated_by)
      VALUES (?, 'Version snapshot catalog course', 'Canonical Catalog', 'public', 'published', 'admin-1', 'admin-1')`).run(courseId);
    database.prepare(`INSERT INTO courses (id, title, category, visibility, status, created_by, updated_by, logical_course_id)
      VALUES ('course-catalog-snapshot', 'Version snapshot catalog course', 'Snapshot only', 'public', 'published', 'admin-1', 'admin-1', ?)`)
      .run(courseId);

    const response = await fetch(apiUrl('/courses?q=Version%20snapshot%20catalog'), { headers: userHeaders('learner-active') });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.total, 1);
    assert.deepEqual(result.courses.map((course) => course.id), [courseId]);
    assert.ok(result.categories.includes('Canonical Catalog'));
    assert.equal(result.categories.includes('Snapshot only'), false);
  } finally {
    database.prepare('DELETE FROM courses WHERE id = ?').run(courseId);
  }
});

test('learner catalog can filter a real category named All courses', async () => {
  const matchingCourseId = 'course-catalog-all-courses-category';
  const otherCourseId = 'course-catalog-other-category';
  const addCourse = database.prepare(`INSERT INTO courses (id, title, category, visibility, status, created_by, updated_by)
    VALUES (?, 'All courses category regression', ?, 'public', 'published', 'admin-1', 'admin-1')`);
  try {
    addCourse.run(matchingCourseId, 'All courses');
    addCourse.run(otherCourseId, 'Special topics');

    const params = new URLSearchParams({ q: 'All courses category regression', category: 'All courses' });
    const response = await fetch(apiUrl(`/courses?${params}`), { headers: userHeaders('learner-active') });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.total, 1);
    assert.deepEqual(result.courses.map((course) => course.id), [matchingCourseId]);
    assert.ok(result.categories.includes('All courses'));
  } finally {
    database.prepare('DELETE FROM courses WHERE id IN (?, ?)').run(matchingCourseId, otherCourseId);
  }
});

test('later learner catalog pages skip the category query while preserving the default response', async () => {
  const prefix = 'course-catalog-category-pages-';
  const category = 'Page request category';
  const addCourse = database.prepare(`INSERT INTO courses (id, title, category, visibility, status, created_by, updated_by)
    VALUES (?, ?, ?, 'public', 'published', 'admin-1', 'admin-1')`);
  const courseIds = Array.from({ length: 25 }, (_, index) => `${prefix}${index + 1}`);
  for (const [index, id] of courseIds.entries()) addCourse.run(id, `${prefix} title ${index + 1}`, category);

  const originalPrepare = database.prepare;
  let categoryQueryCount = 0;
  try {
    database.prepare = (sql) => {
      if (sql.includes('SELECT DISTINCT c.category')) categoryQueryCount += 1;
      return originalPrepare.call(database, sql);
    };

    const firstParams = new URLSearchParams({ q: prefix });
    const firstResponse = await fetch(apiUrl(`/courses?${firstParams}`), { headers: userHeaders('learner-active') });
    assert.equal(firstResponse.status, 200);
    const firstPage = await firstResponse.json();
    assert.ok(firstPage.categories.includes(category));
    assert.equal(firstPage.page, 1);
    assert.equal(categoryQueryCount, 1);

    const nextParams = new URLSearchParams({ q: prefix, page: '2', includeCategories: '0' });
    const nextResponse = await fetch(apiUrl(`/courses?${nextParams}`), { headers: userHeaders('learner-active') });
    assert.equal(nextResponse.status, 200);
    const nextPage = await nextResponse.json();
    assert.equal(nextPage.page, 2);
    assert.equal(Object.hasOwn(nextPage, 'categories'), false);
    assert.equal(categoryQueryCount, 1);

    const invalidParams = new URLSearchParams({ q: prefix, includeCategories: 'false' });
    const invalidResponse = await fetch(apiUrl(`/courses?${invalidParams}`), { headers: userHeaders('learner-active') });
    assert.equal(invalidResponse.status, 400);
    assert.equal(categoryQueryCount, 1);
  } finally {
    database.prepare = originalPrepare;
    database.prepare('DELETE FROM courses WHERE id LIKE ?').run(`${prefix}%`);
  }
});

test('course analytics eligibility reads course memberships before learner accounts', () => {
  const plan = database.prepare(`EXPLAIN QUERY PLAN SELECT u.id, u.username, u.disabled FROM (
    SELECT user_id AS id FROM enrollments WHERE course_id = ?
    UNION SELECT user_id FROM course_grants WHERE course_id = ?
  ) member CROSS JOIN users u ON u.id = member.id WHERE u.role = 'learner'`)
    .all('course-analytics', 'course-analytics').map((row) => row.detail).join('\n');
  assert.match(plan, /SEARCH enrollments USING COVERING INDEX .* \(course_id=\?\)/);
  assert.match(plan, /SEARCH course_grants USING COVERING INDEX .* \(course_id=\?\)/);
  assert.match(plan, /SEARCH u USING INDEX sqlite_autoindex_users_1 \(id=\?\)/);
  assert.doesNotMatch(plan, /SCAN users|SCAN u/);
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

test('course details resolve learner progress before version history exists', async () => {
  const response = await fetch(apiUrl('/courses/course-analytics'), {
    headers: userHeaders('learner-active'),
  });
  assert.equal(response.status, 200);
  const { course } = await response.json();
  assert.equal(course.id, 'course-analytics');
  assert.equal(course.versionNumber, null);
  assert.equal(course.progress, 100);
  assert.equal(course.completed, true);
  assert.equal(course.modules[0].lessons[0].completed, true);
  assert.equal(course.modules[0].quiz.passed, true);
});

test('first version requiring recompletion resets legacy progress without deleting its history', async () => {
  const courseId = 'course-first-version-recompletion';
  const lessonId = 'course-first-version-recompletion-lesson';
  database.exec(`
    INSERT INTO courses (id, title, status, visibility, created_by, updated_by)
      VALUES ('${courseId}', 'Legacy published course', 'published', 'public', 'admin-1', 'admin-1');
    INSERT INTO course_modules (id, course_id, title, position)
      VALUES ('${courseId}-module', '${courseId}', 'Legacy module', 0);
    INSERT INTO media_files (id, course_id, original_name, file_name, mime_type, byte_size, media_kind)
      VALUES ('${courseId}-media', '${courseId}', 'legacy.mp4', 'legacy.mp4', 'video/mp4', 1, 'video');
    INSERT INTO lessons (id, module_id, title, position, media_id)
      VALUES ('${lessonId}', '${courseId}-module', 'Legacy lesson', 0, '${courseId}-media');
    INSERT INTO enrollments (id, course_id, user_id, enrolled_at)
      VALUES ('${courseId}-enrollment', '${courseId}', 'learner-active', '2026-10-01 09:00:00');
    INSERT INTO lesson_progress (user_id, lesson_id, completed_at)
      VALUES ('learner-active', '${lessonId}', '2026-10-01 10:00:00');
  `);

  try {
    const beforeResponse = await fetch(apiUrl(`/courses/${courseId}`), { headers: userHeaders('learner-active') });
    assert.equal(beforeResponse.status, 200);
    assert.equal((await beforeResponse.json()).course.completed, true);

    const publishResponse = await fetch(apiUrl(`/manage/courses/${courseId}`), {
      method: 'PATCH',
      headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'published', requiresRecompletion: true }),
    });
    assert.equal(publishResponse.status, 200);

    const afterResponse = await fetch(apiUrl(`/courses/${courseId}`), { headers: userHeaders('learner-active') });
    assert.equal(afterResponse.status, 200);
    const { course } = await afterResponse.json();
    assert.equal(course.versionNumber, 1);
    assert.equal(course.progress, 0);
    assert.equal(course.completed, false);
    assert.notEqual(course.modules[0].lessons[0].id, lessonId);
    assert.equal(course.modules[0].lessons[0].completed, false);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM lesson_progress WHERE user_id = ? AND lesson_id = ?')
      .get('learner-active', lessonId).count, 1);
  } finally {
    database.prepare('DELETE FROM courses WHERE id = ?').run(courseId);
  }
});

test('course details preserve a prior quiz pass without presenting it as a current-version attempt', async () => {
  const courseId = 'course-carried-quiz-pass';
  const versionCourseId = `${courseId}-v2`;
  database.exec(`
    INSERT INTO courses (id, title, status, visibility, created_by, updated_by, logical_course_id) VALUES
      ('${courseId}', 'Carried quiz pass', 'published', 'public', 'admin-1', 'admin-1', NULL),
      ('${versionCourseId}', 'Carried quiz pass', 'published', 'public', 'admin-1', 'admin-1', '${courseId}');
    INSERT INTO course_modules (id, course_id, title, position, stable_id) VALUES
      ('${courseId}-module', '${courseId}', 'Module', 0, 'carried-quiz-pass-module'),
      ('${versionCourseId}-module', '${versionCourseId}', 'Module', 0, 'carried-quiz-pass-module');
    INSERT INTO quizzes (id, module_id, title, pass_mark, stable_id) VALUES
      ('${courseId}-quiz', '${courseId}-module', 'Quiz', 70, 'carried-quiz-pass-stable'),
      ('${versionCourseId}-quiz', '${versionCourseId}-module', 'Quiz', 70, 'carried-quiz-pass-stable');
    INSERT INTO quiz_questions (id, quiz_id, prompt, position) VALUES
      ('${courseId}-question', '${courseId}-quiz', 'Earlier question?', 0),
      ('${versionCourseId}-question', '${versionCourseId}-quiz', 'Current question?', 0);
    INSERT INTO quiz_choices (id, question_id, choice_text, is_correct, position) VALUES
      ('${courseId}-choice-1', '${courseId}-question', 'Earlier correct answer', 1, 0),
      ('${courseId}-choice-2', '${courseId}-question', 'Earlier other answer', 0, 1),
      ('${versionCourseId}-choice-1', '${versionCourseId}-question', 'Current correct answer', 1, 0),
      ('${versionCourseId}-choice-2', '${versionCourseId}-question', 'Current other answer', 0, 1);
    INSERT INTO course_versions (id, course_id, storage_course_id, version_number, published_by, requires_recompletion) VALUES
      ('${courseId}-version-1', '${courseId}', '${courseId}', 1, 'admin-1', 0),
      ('${courseId}-version-2', '${courseId}', '${versionCourseId}', 2, 'admin-1', 0);
    INSERT INTO enrollments (id, course_id, user_id)
      VALUES ('${courseId}-enrollment', '${courseId}', 'learner-active');
    INSERT INTO quiz_attempts (id, quiz_id, user_id, score, passed, answers_json, question_snapshot_json, submitted_at)
      VALUES ('${courseId}-attempt', '${courseId}-quiz', 'learner-active', 100, 1, '{}', '[]', '2026-10-01 12:00:00');
  `);

  try {
    const response = await fetch(apiUrl(`/courses/${courseId}`), { headers: userHeaders('learner-active') });
    assert.equal(response.status, 200);
    const { course } = await response.json();
    assert.equal(course.versionNumber, 2);
    assert.equal(course.modules[0].quiz.id, `${versionCourseId}-quiz`);
    assert.equal(course.modules[0].quiz.passed, true);
    assert.equal(course.modules[0].quiz.latestAttempt, null);
  } finally {
    database.prepare('DELETE FROM courses WHERE id = ?').run(versionCourseId);
    database.prepare('DELETE FROM courses WHERE id = ?').run(courseId);
  }
});

test('course and learning-path detail GETs are read-only while protected actions initialize learner state', async () => {
  database.exec(`
    INSERT INTO courses (id, title, status, created_by, updated_by) VALUES
      ('course-read-only-detail', 'Read-only detail', 'published', 'admin-1', 'admin-1'),
      ('course-path-sync-target', 'Path sync target', 'published', 'admin-1', 'admin-1');
    INSERT INTO users (id, username, email, password_hash, role, disabled)
      VALUES ('learner-read-only-path', 'learner_read_only_path', 'readonly.path@example.invalid', 'not-used', 'learner', 0);
    INSERT INTO learning_paths (id, title, status, self_enrollment, created_by, updated_by)
      VALUES ('path-read-only-detail', 'Read-only path', 'published', 0, 'admin-1', 'admin-1');
    INSERT INTO learning_path_courses (id, path_id, course_id, position, requires_previous)
      VALUES ('path-read-only-course-one', 'path-read-only-detail', 'course-empty', 0, 0);
    INSERT INTO learning_path_enrollments (id, path_id, user_id, enrollment_source)
      VALUES ('path-read-only-enrollment', 'path-read-only-detail', 'learner-read-only-path', 'assigned');
  `);

  try {
    const courseEnrollmentCount = () => database.prepare('SELECT COUNT(*) AS count FROM enrollments WHERE course_id = ? AND user_id = ?')
      .get('course-read-only-detail', 'learner-unassigned').count;
    const courseStateCount = () => database.prepare('SELECT COUNT(*) AS count FROM course_learning_state WHERE course_id = ? AND user_id = ?')
      .get('course-read-only-detail', 'learner-unassigned').count;
    assert.equal(courseEnrollmentCount(), 0);
    assert.equal(courseStateCount(), 0);
    const courseResponse = await fetch(apiUrl('/courses/course-read-only-detail'), { headers: userHeaders('learner-unassigned') });
    assert.equal(courseResponse.status, 200);
    assert.equal(courseEnrollmentCount(), 0);
    assert.equal(courseStateCount(), 0);

    const pathStateCount = (courseId) => database.prepare('SELECT COUNT(*) AS count FROM course_learning_state WHERE course_id = ? AND user_id = ?')
      .get(courseId, 'learner-read-only-path').count;
    assert.equal(pathStateCount('course-empty'), 0);
    const pathResponse = await fetch(apiUrl('/learning-paths/path-read-only-detail'), { headers: userHeaders('learner-read-only-path') });
    assert.equal(pathResponse.status, 200);
    assert.equal(pathStateCount('course-empty'), 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM learning_path_enrollments WHERE path_id = ? AND user_id = ?')
      .get('path-read-only-detail', 'learner-read-only-path').count, 1);

    const patchResponse = await fetch(apiUrl('/manage/learning-paths/path-read-only-detail'), {
      method: 'PATCH',
      headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
      body: JSON.stringify({ courses: [
        { courseId: 'course-empty', requiresPrevious: false },
        { courseId: 'course-path-sync-target', requiresPrevious: false },
      ] }),
    });
    assert.equal(patchResponse.status, 200);
    assert.equal(pathStateCount('course-empty'), 1);
    assert.equal(pathStateCount('course-path-sync-target'), 1);

    const enrollmentResponse = await fetch(apiUrl('/courses/course-read-only-detail/enroll'), {
      method: 'POST',
      headers: userHeaders('learner-unassigned'),
    });
    assert.equal(enrollmentResponse.status, 201);
    assert.equal(courseEnrollmentCount(), 1);
    assert.equal(courseStateCount(), 1);
    database.prepare('DELETE FROM course_learning_state WHERE course_id = ? AND user_id = ?')
      .run('course-read-only-detail', 'learner-unassigned');
    assert.equal(courseStateCount(), 0);

    const retryEnrollmentResponse = await fetch(apiUrl('/courses/course-read-only-detail/enroll'), {
      method: 'POST',
      headers: userHeaders('learner-unassigned'),
    });
    assert.equal(retryEnrollmentResponse.status, 200);
    assert.equal(courseEnrollmentCount(), 1);
    assert.equal(courseStateCount(), 1);
  } finally {
    database.prepare('DELETE FROM learning_paths WHERE id = ?').run('path-read-only-detail');
    database.prepare('DELETE FROM courses WHERE id IN (?, ?)').run('course-read-only-detail', 'course-path-sync-target');
    database.prepare('DELETE FROM users WHERE id = ?').run('learner-read-only-path');
  }
});

test('course enrollment rejects staff roles without creating learner activity', async () => {
  const courseId = 'course-enrollment-staff-boundary';
  database.exec(`
    INSERT INTO courses (id, title, status, created_by, updated_by)
      VALUES ('${courseId}', 'Staff enrollment boundary', 'published', 'admin-1', 'admin-1');
    INSERT INTO users (id, username, email, password_hash, role, disabled)
      VALUES ('moderator-enrollment-boundary', 'moderator_enrollment_boundary', 'moderator-enrollment@example.invalid', 'not-used', 'moderator', 0);
  `);

  const countEnrollment = (userId) => database.prepare('SELECT COUNT(*) AS count FROM enrollments WHERE course_id = ? AND user_id = ?')
    .get(courseId, userId).count;
  const countLearningState = (userId) => database.prepare('SELECT COUNT(*) AS count FROM course_learning_state WHERE course_id = ? AND user_id = ?')
    .get(courseId, userId).count;

  try {
    for (const staffId of ['admin-1', 'moderator-enrollment-boundary']) {
      const response = await fetch(apiUrl(`/courses/${courseId}/enroll`), {
        method: 'POST',
        headers: userHeaders(staffId),
      });

      assert.equal(response.status, 403, staffId);
      assert.deepEqual(await response.json(), {
        error: 'Only learners can enroll in courses.',
        code: 'forbidden',
      });
      assert.equal(countEnrollment(staffId), 0);
      assert.equal(countLearningState(staffId), 0);
    }
  } finally {
    database.prepare('DELETE FROM courses WHERE id = ?').run(courseId);
    database.prepare('DELETE FROM users WHERE id = ?').run('moderator-enrollment-boundary');
  }
});

test('course enrollment rolls back when its learning state cannot be created', async () => {
  const courseId = 'course-enrollment-atomic';
  const originalPrepare = database.prepare;
  const originalConsoleError = console.error;
  let learningStateWriteFailed = false;
  database.prepare(`INSERT INTO courses (id, title, status, created_by, updated_by)
    VALUES (?, 'Enrollment atomicity', 'published', 'admin-1', 'admin-1')`).run(courseId);
  database.prepare = function prepareWithUnavailableLearningState(sql, ...args) {
    if (sql.includes('INSERT OR IGNORE INTO course_learning_state')) {
      learningStateWriteFailed = true;
      throw new Error('course learning state unavailable');
    }
    return originalPrepare.call(this, sql, ...args);
  };
  console.error = () => {};

  try {
    const response = await fetch(apiUrl(`/courses/${courseId}/enroll`), {
      method: 'POST',
      headers: userHeaders('learner-unassigned'),
    });
    assert.equal(response.status, 500);
    assert.equal(learningStateWriteFailed, true);
    assert.equal(originalPrepare.call(database, 'SELECT COUNT(*) AS count FROM enrollments WHERE course_id = ? AND user_id = ?')
      .get(courseId, 'learner-unassigned').count, 0);
    assert.equal(originalPrepare.call(database, 'SELECT COUNT(*) AS count FROM course_learning_state WHERE course_id = ? AND user_id = ?')
      .get(courseId, 'learner-unassigned').count, 0);
  } finally {
    console.error = originalConsoleError;
    database.prepare = originalPrepare;
    originalPrepare.call(database, 'DELETE FROM courses WHERE id = ?').run(courseId);
  }
});

test('course summaries batch database reads and preserve progress across versions', () => {
  database.exec(`
    INSERT INTO courses (id, title, status, created_by, updated_by)
      VALUES ('course-summary-versioned', 'Versioned summary', 'published', 'admin-1', 'admin-1');
    INSERT INTO course_modules (id, course_id, title, position, stable_id)
      VALUES ('module-summary-v1', 'course-summary-versioned', 'Module', 0, 'module-summary');
    INSERT INTO lessons (id, module_id, title, position, stable_id)
      VALUES ('lesson-summary-v1', 'module-summary-v1', 'Lesson', 0, 'lesson-summary');
    INSERT INTO quizzes (id, module_id, title, pass_mark, stable_id)
      VALUES ('quiz-summary-v1', 'module-summary-v1', 'Quiz', 70, 'quiz-summary');
    INSERT INTO courses (id, title, status, created_by, updated_by, logical_course_id)
      VALUES ('course-summary-versioned-v2', 'Versioned summary', 'published', 'admin-1', 'admin-1', 'course-summary-versioned');
    INSERT INTO course_modules (id, course_id, title, position, stable_id)
      VALUES ('module-summary-v2', 'course-summary-versioned-v2', 'Module', 0, 'module-summary');
    INSERT INTO lessons (id, module_id, title, position, stable_id)
      VALUES ('lesson-summary-v2', 'module-summary-v2', 'Lesson', 0, 'lesson-summary');
    INSERT INTO quizzes (id, module_id, title, pass_mark, stable_id)
      VALUES ('quiz-summary-v2', 'module-summary-v2', 'Quiz', 70, 'quiz-summary');
    INSERT INTO course_versions (id, course_id, storage_course_id, version_number, published_by) VALUES
      ('summary-version-1', 'course-summary-versioned', 'course-summary-versioned', 1, 'admin-1'),
      ('summary-version-2', 'course-summary-versioned', 'course-summary-versioned-v2', 2, 'admin-1');
    INSERT INTO lesson_progress (user_id, lesson_id, completed_at)
      VALUES ('learner-active', 'lesson-summary-v1', '2026-10-01 10:00:00');
    INSERT INTO quiz_attempts
      (id, quiz_id, user_id, score, passed, answers_json, question_snapshot_json, submitted_at)
      VALUES ('summary-attempt-v1', 'quiz-summary-v1', 'learner-active', 100, 1, '{}', '[]', '2026-10-02 10:00:00');
    INSERT INTO course_learning_state (user_id, course_id, deadline_at)
      VALUES ('learner-active', 'course-summary-versioned', '2026-11-01 00:00:00');
  `);

  const findCourse = database.prepare('SELECT * FROM courses WHERE id = ?');
  const courses = ['course-summary-versioned', 'course-empty'].map((id) => findCourse.get(id));
  const learner = database.prepare('SELECT id FROM users WHERE id = ?').get('learner-active');
  function measureSummaries(rows) {
    const originalPrepare = database.prepare;
    let queryCount = 0;
    const preparedSql = [];
    database.prepare = (sql) => {
      queryCount += 1;
      preparedSql.push(sql.replace(/\s+/g, ' ').trim());
      return originalPrepare.call(database, sql);
    };
    try { return { summaries: summarizeCourses(rows, learner), queryCount, preparedSql }; }
    finally { delete database.prepare; }
  }

  const oneCourse = measureSummaries(courses.slice(0, 1));
  const twoCourses = measureSummaries(courses);
  const unversionedCourse = measureSummaries(courses.slice(1));
  assert.equal(twoCourses.queryCount, oneCourse.queryCount);
  assert.equal(unversionedCourse.preparedSql.some((sql) => sql.startsWith('SELECT * FROM courses WHERE id IN (')), false,
    'expected a supplied unversioned course row to be reused in its summary');
  const summary = twoCourses.summaries.find((course) => course.id === 'course-summary-versioned');
  assert.equal(summary.versionNumber, 2);
  assert.equal(summary.deadlineAt, '2026-11-01 00:00:00');
  assert.equal(summary.completedLessons, 1);
  assert.equal(summary.progress, 100);
  assert.equal(summary.completed, true);

  database.prepare("UPDATE course_learning_state SET target_version_id = 'summary-version-2' WHERE user_id = 'learner-active' AND course_id = 'course-summary-versioned'").run();
  const resetSummary = summarizeCourses(courses.slice(0, 1), learner)[0];
  assert.equal(resetSummary.progress, 0);
  assert.equal(resetSummary.completed, false);
});

test('learning-path state synchronization reuses completed course summaries for existing states', () => {
  const pathId = 'path-sync-summary-batch';
  const secondPathId = `${pathId}-second`;
  const courseIds = [1, 2, 3].map((number) => `${pathId}-course-${number}`);
  const moduleIds = courseIds.map((courseId) => `${courseId}-module`);
  const lessonIds = courseIds.map((courseId) => `${courseId}-lesson`);
  database.exec(`
    INSERT INTO learning_paths (id, title, status, self_enrollment, created_by, updated_by)
      VALUES ('${pathId}', 'Summary batching', 'published', 0, 'admin-1', 'admin-1'),
      ('${secondPathId}', 'Summary batching shared path', 'published', 0, 'admin-1', 'admin-1');
  `);
  const addCourse = database.prepare(`INSERT INTO courses (id, title, status, created_by, updated_by)
    VALUES (?, ?, 'published', 'admin-1', 'admin-1')`);
  const addModule = database.prepare('INSERT INTO course_modules (id, course_id, title, position) VALUES (?, ?, ?, 0)');
  const addLesson = database.prepare('INSERT INTO lessons (id, module_id, title, position) VALUES (?, ?, ?, 0)');
  const addCompletion = database.prepare('INSERT INTO lesson_progress (user_id, lesson_id, completed_at) VALUES (?, ?, ?)');
  const addState = database.prepare('INSERT INTO course_learning_state (user_id, course_id) VALUES (?, ?)');
  const addPathCourse = database.prepare(`INSERT INTO learning_path_courses
    (id, path_id, course_id, position, requires_previous) VALUES (?, ?, ?, ?, ?)`);
  for (const [index, courseId] of courseIds.entries()) {
    addCourse.run(courseId, `Completed path course ${index + 1}`);
    addModule.run(moduleIds[index], courseId, `Module ${index + 1}`);
    addLesson.run(lessonIds[index], moduleIds[index], `Lesson ${index + 1}`);
    addCompletion.run('learner-active', lessonIds[index], `2026-10-0${index + 1} 10:00:00`);
    addState.run('learner-active', courseId);
    addPathCourse.run(`${pathId}-step-${index + 1}`, pathId, courseId, index, index === 0 ? 0 : 1);
    addPathCourse.run(`${secondPathId}-step-${index + 1}`, secondPathId, courseId, index, index === 0 ? 0 : 1);
  }

  let singleCourseSummaryReads = 0;
  let existingStateJoinQueries = 0;
  let repeatedStateInitializationQueries = 0;
  const repeatedStateInitializationPatterns = [
    'SELECT logical_course_id FROM courses WHERE id = ?',
    'SELECT completion_window_days FROM courses WHERE id = ?',
    'SELECT id, logical_course_id FROM courses WHERE id = ?',
    'FROM course_versions v JOIN courses c ON c.id = v.storage_course_id',
    'INSERT OR IGNORE INTO course_learning_state',
    'SELECT * FROM course_learning_state WHERE user_id = ? AND course_id = ?',
  ];
  const originalPrepare = database.prepare;
  database.prepare = (sql) => {
    if (sql.includes('SELECT * FROM courses WHERE id IN (?)')) singleCourseSummaryReads += 1;
    if (sql.includes('FROM courses c LEFT JOIN course_learning_state s')) existingStateJoinQueries += 1;
    if (repeatedStateInitializationPatterns.some((pattern) => sql.includes(pattern))) repeatedStateInitializationQueries += 1;
    return originalPrepare.call(database, sql);
  };
  try {
    syncPathStates([pathId, secondPathId], 'learner-active');
  } finally {
    delete database.prepare;
    database.prepare('DELETE FROM learning_paths WHERE id IN (?, ?)').run(pathId, secondPathId);
    database.prepare(`DELETE FROM courses WHERE id IN (${courseIds.map(() => '?').join(', ')})`).run(...courseIds);
  }

  assert.equal(singleCourseSummaryReads, 0);
  assert.equal(existingStateJoinQueries, courseIds.length);
  assert.equal(repeatedStateInitializationQueries, 0);
});

test('learning-path synchronization refreshes progress when a new state requires recompletion', () => {
  const pathId = 'path-sync-required-reset';
  const courseId = `${pathId}-course`;
  const versionCourseId = `${courseId}-v2`;
  const nextCourseId = `${pathId}-next-course`;
  const oldLessonId = `${courseId}-lesson-v1`;
  database.exec(`
    INSERT INTO learning_paths (id, title, status, self_enrollment, created_by, updated_by)
      VALUES ('${pathId}', 'Required reset', 'published', 0, 'admin-1', 'admin-1');
    INSERT INTO courses (id, title, status, created_by, updated_by, logical_course_id) VALUES
      ('${courseId}', 'Versioned path course', 'published', 'admin-1', 'admin-1', NULL),
      ('${versionCourseId}', 'Versioned path course', 'published', 'admin-1', 'admin-1', '${courseId}'),
      ('${nextCourseId}', 'Next path course', 'published', 'admin-1', 'admin-1', NULL);
    INSERT INTO course_modules (id, course_id, title, position, stable_id) VALUES
      ('${courseId}-module-v1', '${courseId}', 'Module', 0, 'path-sync-module'),
      ('${courseId}-module-v2', '${versionCourseId}', 'Module', 0, 'path-sync-module'),
      ('${nextCourseId}-module', '${nextCourseId}', 'Module', 0, 'path-sync-next-module');
    INSERT INTO lessons (id, module_id, title, position, stable_id) VALUES
      ('${oldLessonId}', '${courseId}-module-v1', 'Lesson', 0, 'path-sync-lesson'),
      ('${courseId}-lesson-v2', '${courseId}-module-v2', 'Lesson', 0, 'path-sync-lesson'),
      ('${nextCourseId}-lesson', '${nextCourseId}-module', 'Lesson', 0, 'path-sync-next-lesson');
    INSERT INTO course_versions (id, course_id, storage_course_id, version_number, published_by, requires_recompletion) VALUES
      ('${courseId}-version-1', '${courseId}', '${courseId}', 1, 'admin-1', 0),
      ('${courseId}-version-2', '${courseId}', '${versionCourseId}', 2, 'admin-1', 1);
    INSERT INTO lesson_progress (user_id, lesson_id, completed_at)
      VALUES ('learner-active', '${oldLessonId}', '2026-10-01 10:00:00');
    INSERT INTO learning_path_courses (id, path_id, course_id, position, requires_previous) VALUES
      ('${pathId}-step-1', '${pathId}', '${courseId}', 0, 0),
      ('${pathId}-step-2', '${pathId}', '${nextCourseId}', 1, 1);
  `);

  try {
    syncPathStates([pathId], 'learner-active');
    const state = database.prepare('SELECT target_version_id FROM course_learning_state WHERE user_id = ? AND course_id = ?')
      .get('learner-active', courseId);
    assert.equal(state.target_version_id, `${courseId}-version-2`);
    assert.equal(database.prepare('SELECT 1 FROM course_learning_state WHERE user_id = ? AND course_id = ?')
      .get('learner-active', nextCourseId), undefined);
  } finally {
    database.prepare('DELETE FROM learning_paths WHERE id = ?').run(pathId);
    database.prepare('DELETE FROM courses WHERE id IN (?, ?, ?)').run(courseId, versionCourseId, nextCourseId);
  }
});

test('private path course access follows the current step prerequisite setting', async () => {
  database.exec(`
    INSERT INTO courses (id, title, visibility, status, created_by, updated_by) VALUES
      ('path-course-first', 'Path course first', 'public', 'published', 'admin-1', 'admin-1'),
      ('path-course-middle', 'Path course middle', 'public', 'published', 'admin-1', 'admin-1'),
      ('path-course-target', 'Path course target', 'private', 'published', 'admin-1', 'admin-1');
    INSERT INTO learning_paths (id, title, status, self_enrollment, created_by, updated_by)
      VALUES ('path-prerequisite-check', 'Prerequisite check', 'published', 0, 'admin-1', 'admin-1');
    INSERT INTO learning_path_courses (id, path_id, course_id, position, requires_previous) VALUES
      ('path-step-first', 'path-prerequisite-check', 'path-course-first', 0, 0),
      ('path-step-middle', 'path-prerequisite-check', 'path-course-middle', 1, 0),
      ('path-step-target', 'path-prerequisite-check', 'path-course-target', 2, 1);
    INSERT INTO learning_path_enrollments (id, path_id, user_id, enrollment_source, assigned_by)
      VALUES ('path-enrollment-active', 'path-prerequisite-check', 'learner-active', 'assigned', 'admin-1');
  `);

  const lockedPathResponse = await fetch(apiUrl('/learning-paths/path-prerequisite-check'), {
    headers: userHeaders('learner-active'),
  });
  assert.equal(lockedPathResponse.status, 200);
  const lockedPath = await lockedPathResponse.json();
  assert.equal(lockedPath.path.courses.find((course) => course.id === 'path-course-target').unlocked, false);

  const deniedCourse = await fetch(apiUrl('/courses/path-course-target'), {
    headers: userHeaders('learner-active'),
  });
  assert.equal(deniedCourse.status, 403);

  database.prepare(`UPDATE learning_path_courses SET requires_previous = 0 WHERE path_id = ? AND course_id = ?`)
    .run('path-prerequisite-check', 'path-course-target');
  const unlockedPathResponse = await fetch(apiUrl('/learning-paths/path-prerequisite-check'), {
    headers: userHeaders('learner-active'),
  });
  assert.equal(unlockedPathResponse.status, 200);
  const unlockedPath = await unlockedPathResponse.json();
  assert.equal(unlockedPath.path.courses.find((course) => course.id === 'path-course-target').unlocked, true);

  const allowedCourse = await fetch(apiUrl('/courses/path-course-target'), {
    headers: userHeaders('learner-active'),
  });
  assert.equal(allowedCourse.status, 200);

  const learningResponse = await fetch(apiUrl('/my-learning'), { headers: userHeaders('learner-active') });
  assert.equal(learningResponse.status, 200);
  assert.ok((await learningResponse.json()).courses.some((course) => course.id === 'path-course-target'));
  database.exec(`CREATE TRIGGER fail_path_assignment_removal_audit
    BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'path.assignment_removed' AND NEW.entity_id = 'path-prerequisite-check'
    BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END`);
  try {
    const failedRemoval = await fetch(apiUrl('/manage/learning-paths/path-prerequisite-check/assignments/learner-active'), {
      method: 'DELETE',
      headers: userHeaders('admin-1'),
    });
    assert.equal(failedRemoval.status, 500);
    assert.equal((await failedRemoval.json()).code, 'audit_unavailable');
    assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM learning_path_enrollments
      WHERE path_id = 'path-prerequisite-check' AND user_id = 'learner-active'`).get().count, 1);
    const stillAllowedCourse = await fetch(apiUrl('/courses/path-course-target'), { headers: userHeaders('learner-active') });
    assert.equal(stillAllowedCourse.status, 200);
  } finally {
    database.exec('DROP TRIGGER fail_path_assignment_removal_audit');
  }
  const removalResponse = await fetch(apiUrl('/manage/learning-paths/path-prerequisite-check/assignments/learner-active'), {
    method: 'DELETE',
    headers: userHeaders('admin-1'),
  });
  assert.equal(removalResponse.status, 204);
  assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM audit_logs
    WHERE action = 'path.assignment_removed' AND entity_id = 'path-prerequisite-check'`).get().count, 1);
  const revokedCourse = await fetch(apiUrl('/courses/path-course-target'), { headers: userHeaders('learner-active') });
  assert.equal(revokedCourse.status, 403);
  const afterRemoval = await fetch(apiUrl('/my-learning'), { headers: userHeaders('learner-active') });
  assert.ok(!(await afterRemoval.json()).courses.some((course) => course.id === 'path-course-target'));
});

test('My learning streams indexed user memberships into bounded stable pages', async () => {
  const userId = 'learner-my-learning-pager';
  const coursePrefix = 'my-learning-pager-course-';
  const pageSize = 24;
  const count = 53;
  const addFixtures = database.transaction(() => {
    database.prepare(`INSERT INTO users (id, username, email, password_hash, role, disabled)
      VALUES (?, 'my_learning_pager', 'my-learning-pager@example.invalid', 'not-used', 'learner', 0)`).run(userId);
    const addCourse = database.prepare(`INSERT INTO courses (id, title, status, visibility, created_by, updated_by)
      VALUES (?, ?, 'published', 'public', 'admin-1', 'admin-1')`);
    const addEnrollment = database.prepare(`INSERT INTO enrollments (id, course_id, user_id, enrolled_at)
      VALUES (?, ?, ?, ?)`);
    const addGrant = database.prepare(`INSERT INTO course_grants (id, course_id, user_id, granted_by, granted_at)
      VALUES (?, ?, ?, 'admin-1', ?)`);
    for (let position = 1; position <= count; position += 1) {
      const courseId = `${coursePrefix}${String(position).padStart(2, '0')}`;
      addCourse.run(courseId, `My learning page course ${position}`);
      addEnrollment.run(`my-learning-pager-enrollment-${position}`, courseId, userId,
        `2026-10-11 00:${String(position).padStart(2, '0')}:00`);
    }
    addGrant.run('my-learning-pager-newer-grant', `${coursePrefix}01`, userId, '2026-10-14 00:00:00');
    database.prepare(`INSERT INTO learning_paths (id, title, status, created_by, updated_by)
      VALUES ('my-learning-pager-path', 'My learning pager path', 'published', 'admin-1', 'admin-1')`).run();
    database.prepare(`INSERT INTO learning_path_enrollments (id, path_id, user_id, enrollment_source, assigned_by, enrolled_at)
      VALUES ('my-learning-pager-path-enrollment', 'my-learning-pager-path', ?, 'assigned', 'admin-1', '2026-10-15 00:00:00')`).run(userId);
    database.prepare(`INSERT INTO learning_path_courses (id, path_id, course_id, position, requires_previous)
      VALUES ('my-learning-pager-path-step', 'my-learning-pager-path', ?, 0, 0)`).run(`${coursePrefix}02`);
  });

  try {
    addFixtures();
    const originalPrepare = database.prepare;
    let candidateSql = '';
    let candidateIterateCount = 0;
    let candidateAllCount = 0;
    database.prepare = (sql) => {
      const statement = originalPrepare.call(database, sql);
      if (!sql.trimStart().startsWith('WITH course_activity(course_id, activity_at, precedence) AS (')) return statement;
      candidateSql = sql;
      return new Proxy(statement, {
        get(target, property) {
          const value = Reflect.get(target, property, target);
          if (property === 'iterate') return (...args) => { candidateIterateCount += 1; return value.apply(target, args); };
          if (property === 'all') return (...args) => { candidateAllCount += 1; return value.apply(target, args); };
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    };

    let firstPage;
    try {
      const response = await fetch(apiUrl('/my-learning?page=1&includeCertificates=0'), {
        headers: userHeaders(userId),
      });
      assert.equal(response.status, 200);
      firstPage = await response.json();
    } finally {
      delete database.prepare;
    }

    assert.equal(firstPage.total, count);
    assert.equal(firstPage.page, 1);
    assert.equal(firstPage.pageSize, pageSize);
    assert.equal(firstPage.hasMore, true);
    assert.deepEqual(firstPage.courses.map((course) => course.id),
      Array.from({ length: pageSize }, (_, index) => `${coursePrefix}${String(count - index).padStart(2, '0')}`));
    assert.equal(candidateIterateCount, 1, 'the membership query should be consumed incrementally');
    assert.equal(candidateAllCount, 0, 'the membership query should not materialize every candidate row');

    const plan = database.prepare(`EXPLAIN QUERY PLAN ${candidateSql}`).all(userId, userId, userId);
    const planDetails = plan.map((entry) => entry.detail).join('\n');
    assert.match(planDetails, /enrollments_user/);
    assert.match(planDetails, /grants_user/);
    assert.match(planDetails, /learning_path_enrollments_user/);
    assert.doesNotMatch(planDetails, /SCAN c\b/, planDetails);

    const secondResponse = await fetch(apiUrl('/my-learning?page=2&includeCertificates=0'), {
      headers: userHeaders(userId),
    });
    assert.equal(secondResponse.status, 200);
    const secondPage = await secondResponse.json();
    assert.equal(secondPage.page, 2);
    assert.equal(secondPage.hasMore, true);
    assert.deepEqual(secondPage.courses.map((course) => course.id),
      Array.from({ length: pageSize }, (_, index) => `${coursePrefix}${String(count - pageSize - index).padStart(2, '0')}`));

    const lastResponse = await fetch(apiUrl('/my-learning?page=99&includeCertificates=0'), {
      headers: userHeaders(userId),
    });
    assert.equal(lastResponse.status, 200);
    const lastPage = await lastResponse.json();
    assert.equal(lastPage.page, 3);
    assert.equal(lastPage.hasMore, false);
    assert.deepEqual(lastPage.courses.map((course) => course.id),
      Array.from({ length: count - pageSize * 2 }, (_, index) => `${coursePrefix}${String(count - pageSize * 2 - index).padStart(2, '0')}`));
  } finally {
    database.prepare('DELETE FROM learning_paths WHERE id = ?').run('my-learning-pager-path');
    database.prepare('DELETE FROM courses WHERE id LIKE ?').run(`${coursePrefix}%`);
    database.prepare('DELETE FROM users WHERE id = ?').run(userId);
  }
});

test('My learning caches prerequisite completion checks as enrolled paths grow', async () => {
  const pathId = 'my-learning-prerequisite-cache';
  database.prepare(`INSERT INTO learning_paths (id, title, status, self_enrollment, created_by, updated_by)
    VALUES (?, 'My learning prerequisite cache', 'published', 0, 'admin-1', 'admin-1')`).run(pathId);
  database.prepare(`INSERT INTO learning_path_enrollments (id, path_id, user_id, enrollment_source, assigned_by)
    VALUES (?, ?, 'learner-active', 'assigned', 'admin-1')`).run('my-learning-cache-enrollment', pathId);

  function addCourse(position) {
    const courseId = `my-learning-cache-course-${position}`;
    const moduleId = `my-learning-cache-module-${position}`;
    const lessonId = `my-learning-cache-lesson-${position}`;
    database.prepare(`INSERT INTO courses (id, title, visibility, status, created_by, updated_by)
      VALUES (?, ?, 'private', 'published', 'admin-1', 'admin-1')`).run(courseId, `Private path course ${position}`);
    database.prepare('INSERT INTO course_modules (id, course_id, title, position) VALUES (?, ?, ?, 0)')
      .run(moduleId, courseId, `Module ${position}`);
    database.prepare('INSERT INTO lessons (id, module_id, title, position) VALUES (?, ?, ?, 0)')
      .run(lessonId, moduleId, `Lesson ${position}`);
    database.prepare('INSERT INTO lesson_progress (user_id, lesson_id) VALUES (?, ?)')
      .run('learner-active', lessonId);
    database.prepare(`INSERT INTO learning_path_courses (id, path_id, course_id, position, requires_previous)
      VALUES (?, ?, ?, ?, ?)`)
      .run(`my-learning-cache-step-${position}`, pathId, courseId, position, position === 0 ? 0 : 1);
  }

  async function measureListQueryCount() {
    const originalPrepare = database.prepare;
    let queryCount = 0;
    database.prepare = (sql) => {
      queryCount += 1;
      return originalPrepare.call(database, sql);
    };
    try {
      const response = await fetch(apiUrl('/my-learning'), { headers: userHeaders('learner-active') });
      assert.equal(response.status, 200);
      return { queryCount, courses: (await response.json()).courses };
    } finally {
      delete database.prepare;
    }
  }

  for (let position = 0; position < 3; position += 1) addCourse(position);
  const threeCourseResult = await measureListQueryCount();
  assert.equal(threeCourseResult.courses.filter((course) => course.id.startsWith('my-learning-cache-course-')).length, 3);

  for (let position = 3; position < 6; position += 1) addCourse(position);
  const sixCourseResult = await measureListQueryCount();
  assert.equal(sixCourseResult.courses.filter((course) => course.id.startsWith('my-learning-cache-course-')).length, 6);
  assert.ok(sixCourseResult.queryCount - threeCourseResult.queryCount <= 40,
    `Expected bounded additional visibility work, got ${threeCourseResult.queryCount} then ${sixCourseResult.queryCount} queries.`);
});

test('prerequisite completion history reads stay bounded as course content grows', async () => {
  database.exec(`
    INSERT INTO courses (id, title, visibility, status, created_by, updated_by) VALUES
      ('path-bulk-prerequisite', 'Bulk prerequisite', 'public', 'published', 'admin-1', 'admin-1'),
      ('path-bulk-target', 'Bulk target', 'private', 'published', 'admin-1', 'admin-1');
    INSERT INTO course_modules (id, course_id, title, position)
      VALUES ('path-bulk-module', 'path-bulk-prerequisite', 'Bulk module', 0);
    INSERT INTO course_modules (id, course_id, title, position)
      VALUES ('path-bulk-module-second', 'path-bulk-prerequisite', 'Second module', 1);
    INSERT INTO quizzes (id, module_id, title, pass_mark)
      VALUES ('path-bulk-quiz', 'path-bulk-module', 'Bulk quiz', 70),
        ('path-bulk-quiz-second', 'path-bulk-module-second', 'Second quiz', 70);
    INSERT INTO quiz_attempts (id, quiz_id, user_id, score, passed, answers_json, question_snapshot_json)
      VALUES ('path-bulk-attempt', 'path-bulk-quiz', 'learner-active', 100, 1, '{}', '[]'),
        ('path-bulk-attempt-second', 'path-bulk-quiz-second', 'learner-active', 60, 0, '{}', '[]');
    INSERT INTO learning_paths (id, title, status, self_enrollment, created_by, updated_by)
      VALUES ('path-bulk-completion', 'Bulk completion', 'published', 0, 'admin-1', 'admin-1');
    INSERT INTO learning_path_courses (id, path_id, course_id, position, requires_previous) VALUES
      ('path-bulk-first', 'path-bulk-completion', 'path-bulk-prerequisite', 0, 0),
      ('path-bulk-second', 'path-bulk-completion', 'path-bulk-target', 1, 1);
    INSERT INTO learning_path_enrollments (id, path_id, user_id, enrollment_source, assigned_by)
      VALUES ('path-bulk-enrollment', 'path-bulk-completion', 'learner-active', 'assigned', 'admin-1');
  `);

  const addLesson = database.prepare(`INSERT INTO lessons (id, module_id, title, position)
    VALUES (?, 'path-bulk-module', ?, ?)`);
  const addProgress = database.prepare('INSERT INTO lesson_progress (user_id, lesson_id) VALUES (?, ?)');
  addLesson.run('path-bulk-lesson-0', 'Bulk lesson 0', 0);
  addProgress.run('learner-active', 'path-bulk-lesson-0');

  async function measureCompletionReads() {
    const originalPrepare = database.prepare;
    let completionReads = 0;
    database.prepare = (sql) => {
      const statement = originalPrepare.call(database, sql);
      if (!sql.includes('lesson_progress') && !sql.includes('quiz_attempts')) return statement;
      return new Proxy(statement, {
        get(target, property) {
          const value = Reflect.get(target, property, target);
          if ((property === 'get' || property === 'all') && typeof value === 'function') {
            return (...args) => {
              completionReads += 1;
              return value.apply(target, args);
            };
          }
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    };
    try {
      const response = await fetch(apiUrl('/learning-paths/path-bulk-completion'), {
        headers: userHeaders('learner-active'),
      });
      assert.equal(response.status, 200);
      const path = (await response.json()).path;
      return {
        completionReads,
        targetUnlocked: path.courses.find((course) => course.id === 'path-bulk-target').unlocked,
      };
    } finally {
      delete database.prepare;
    }
  }

  const oneLesson = await measureCompletionReads();
  assert.equal(oneLesson.targetUnlocked, false);

  for (let position = 1; position < 41; position += 1) {
    const lessonId = `path-bulk-lesson-${position}`;
    addLesson.run(lessonId, `Bulk lesson ${position}`, position);
    if (position < 40) addProgress.run('learner-active', lessonId);
  }

  database.prepare(`INSERT INTO quiz_attempts
    (id, quiz_id, user_id, score, passed, answers_json, question_snapshot_json)
    VALUES ('path-bulk-attempt-second-pass', 'path-bulk-quiz-second', 'learner-active', 100, 1, '{}', '[]')`).run();
  const oneLessonIncomplete = await measureCompletionReads();
  assert.equal(oneLessonIncomplete.targetUnlocked, false);
  assert.equal(oneLessonIncomplete.completionReads, oneLesson.completionReads,
    `Expected bounded history reads, got ${oneLesson.completionReads} then ${oneLessonIncomplete.completionReads}.`);

  addProgress.run('learner-active', 'path-bulk-lesson-40');
  const manyLessons = await measureCompletionReads();
  assert.equal(manyLessons.targetUnlocked, true);

  database.prepare("UPDATE quiz_attempts SET passed = 0 WHERE id = 'path-bulk-attempt-second-pass'").run();
  const failedQuiz = await measureCompletionReads();
  assert.equal(failedQuiz.targetUnlocked, false);
  database.prepare("UPDATE quiz_attempts SET passed = 1 WHERE id = 'path-bulk-attempt-second-pass'").run();
});

test('learning-path completion summaries use a fixed query count as path size grows', async () => {
  database.exec(`
    INSERT INTO courses (id, title, status, created_by, updated_by) VALUES
      ('path-query-first', 'Query count first', 'published', 'admin-1', 'admin-1'),
      ('path-query-second', 'Query count second', 'published', 'admin-1', 'admin-1'),
      ('path-query-third', 'Query count third', 'published', 'admin-1', 'admin-1');
    INSERT INTO learning_paths (id, title, status, self_enrollment, created_by, updated_by) VALUES
      ('path-query-one', 'One course path', 'published', 1, 'admin-1', 'admin-1'),
      ('path-query-three', 'Three course path', 'published', 1, 'admin-1', 'admin-1');
    INSERT INTO learning_path_courses (id, path_id, course_id, position, requires_previous) VALUES
      ('path-query-one-step', 'path-query-one', 'path-query-first', 0, 0),
      ('path-query-three-first', 'path-query-three', 'path-query-first', 0, 0),
      ('path-query-three-second', 'path-query-three', 'path-query-second', 1, 1),
      ('path-query-three-third', 'path-query-three', 'path-query-third', 2, 1);
  `);

  async function measurePath(pathId) {
    const originalPrepare = database.prepare;
    let queryCount = 0;
    database.prepare = (sql) => {
      queryCount += 1;
      return originalPrepare.call(database, sql);
    };
    try {
      const response = await fetch(apiUrl(`/learning-paths/${pathId}`), {
        headers: userHeaders('learner-active'),
      });
      assert.equal(response.status, 200);
      return { queryCount, path: (await response.json()).path };
    } finally {
      delete database.prepare;
    }
  }

  const oneCourse = await measurePath('path-query-one');
  const threeCourses = await measurePath('path-query-three');
  assert.equal(threeCourses.queryCount, oneCourse.queryCount);
  assert.deepEqual(threeCourses.path.courses.map((course) => course.unlocked), [true, false, false]);
});

test('learning-path management list batches payload queries as path count grows', async () => {
  database.exec(`
    INSERT INTO learning_paths (id, title, status, self_enrollment, created_by, updated_by)
      VALUES ('path-list-batch-one', 'One list path', 'draft', 0, 'admin-1', 'admin-1');
    INSERT INTO learning_path_courses (id, path_id, course_id, position, requires_previous)
      VALUES ('path-list-batch-one-course', 'path-list-batch-one', 'course-empty', 0, 0);
  `);

  async function measureList() {
    const originalPrepare = database.prepare;
    let queryCount = 0;
    database.prepare = (sql) => {
      queryCount += 1;
      return originalPrepare.call(database, sql);
    };
    try {
      const response = await fetch(apiUrl('/manage/learning-paths'), { headers: userHeaders('admin-1') });
      assert.equal(response.status, 200);
      return { queryCount, paths: (await response.json()).paths };
    } finally {
      delete database.prepare;
    }
  }

  try {
    const onePathList = await measureList();
    database.exec(`
      INSERT INTO learning_paths (id, title, status, self_enrollment, created_by, updated_by) VALUES
        ('path-list-batch-two', 'Two list path', 'draft', 0, 'admin-1', 'admin-1'),
        ('path-list-batch-three', 'Three list path', 'draft', 0, 'admin-1', 'admin-1');
      INSERT INTO learning_path_courses (id, path_id, course_id, position, requires_previous) VALUES
        ('path-list-batch-two-course', 'path-list-batch-two', 'course-empty', 0, 0),
        ('path-list-batch-three-course', 'path-list-batch-three', 'course-empty', 0, 0);
    `);
    const threePathList = await measureList();
    assert.equal(threePathList.queryCount, onePathList.queryCount);
    assert.equal(threePathList.paths.length, onePathList.paths.length + 2);
    assert.equal(threePathList.paths.find((path) => path.id === 'path-list-batch-three')?.courses[0]?.id, 'course-empty');
  } finally {
    database.prepare("DELETE FROM learning_paths WHERE id LIKE 'path-list-batch-%'").run();
  }
});

test('learner learning-path lists preserve course progress, enrollment, and prerequisite state', async () => {
  database.exec(`
    INSERT INTO learning_paths (id, title, status, self_enrollment, created_by, updated_by) VALUES
      ('path-list-learner-one', 'Completed learner path', 'published', 1, 'admin-1', 'admin-1'),
      ('path-list-learner-two', 'Locked learner path', 'published', 1, 'admin-1', 'admin-1');
    INSERT INTO learning_path_courses (id, path_id, course_id, position, requires_previous) VALUES
      ('path-list-learner-one-course', 'path-list-learner-one', 'course-analytics', 0, 0),
      ('path-list-learner-two-first', 'path-list-learner-two', 'course-empty', 0, 0),
      ('path-list-learner-two-second', 'path-list-learner-two', 'course-analytics', 1, 1);
    INSERT INTO learning_path_enrollments (id, path_id, user_id, enrollment_source)
      VALUES ('path-list-learner-enrollment', 'path-list-learner-one', 'learner-active', 'self');
  `);

  try {
    const response = await fetch(apiUrl('/learning-paths'), { headers: userHeaders('learner-active') });
    assert.equal(response.status, 200);
    const paths = (await response.json()).paths;
    const completedPath = paths.find((path) => path.id === 'path-list-learner-one');
    const lockedPath = paths.find((path) => path.id === 'path-list-learner-two');
    assert.equal(completedPath.enrolled, true);
    assert.equal(completedPath.completedCourses, 1);
    assert.equal(completedPath.courses[0].completed, true);
    assert.equal(completedPath.courses[0].unlocked, true);
    assert.equal(lockedPath.enrolled, false);
    assert.equal(lockedPath.completedCourses, 1);
    assert.deepEqual(lockedPath.courses.map((course) => course.unlocked), [true, false]);
  } finally {
    database.prepare("DELETE FROM learning_paths WHERE id IN ('path-list-learner-one', 'path-list-learner-two')").run();
  }
});

test('learning-path lists paginate staff and learner results with stable boundaries', async () => {
  const pathIds = Array.from({ length: 22 }, (_, index) => `path-pagination-${String(index + 1).padStart(3, '0')}`);
  const staffTotalBefore = database.prepare("SELECT COUNT(*) AS count FROM learning_paths WHERE status != 'archived'").get().count;
  const learnerTotalBefore = database.prepare(`SELECT COUNT(DISTINCT p.id) AS count FROM learning_paths p
    LEFT JOIN learning_path_enrollments e ON e.path_id = p.id AND e.user_id = ?
    WHERE p.status = 'published' AND (p.self_enrollment = 1 OR e.id IS NOT NULL)`).get('learner-active').count;
  const addPath = database.prepare(`INSERT INTO learning_paths (id, title, status, self_enrollment, created_by, updated_by)
    VALUES (?, ?, 'published', 1, 'admin-1', 'admin-1')`);
  const addCourse = database.prepare(`INSERT INTO learning_path_courses (id, path_id, course_id, position, requires_previous)
    VALUES (?, ?, 'course-empty', 0, 0)`);
  for (const [index, pathId] of pathIds.entries()) {
    const number = String(index + 1).padStart(3, '0');
    addPath.run(pathId, `Pagination path ${number}`);
    addCourse.run(`${pathId}-course`, pathId);
  }

  async function collectPages(userId, expectedTotal) {
    const allPaths = [];
    const pageCount = Math.max(1, Math.ceil(expectedTotal / 20));
    for (let page = 1; page <= pageCount; page++) {
      const response = await fetch(apiUrl(`/learning-paths?page=${page}`), { headers: userHeaders(userId) });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.total, expectedTotal);
      assert.equal(result.page, page);
      assert.equal(result.pageSize, 20);
      assert.equal(result.paths.length, Math.min(20, expectedTotal - (page - 1) * 20));
      assert.equal(result.hasMore, page < pageCount);
      allPaths.push(...result.paths);
    }
    assert.equal(new Set(allPaths.map((path) => path.id)).size, expectedTotal);
    return allPaths;
  }

  try {
    const staffPaths = await collectPages('admin-1', staffTotalBefore + pathIds.length);
    const learnerPaths = await collectPages('learner-active', learnerTotalBefore + pathIds.length);
    assert.ok(staffPaths.some((path) => path.id === pathIds[0] && path.courses.length === 1));
    assert.ok(learnerPaths.some((path) => path.id === pathIds[0] && path.selfEnrollment));
  } finally {
    database.prepare(`DELETE FROM learning_paths WHERE id IN (${pathIds.map(() => '?').join(', ')})`).run(...pathIds);
  }
});

test('learning-path search matches titles and descriptions within each role visibility boundary', async () => {
  const paths = [
    { id: 'path-search-title-draft', title: 'Regional support path', description: 'Support curriculum', status: 'draft' },
    { id: 'path-search-description-draft', title: 'Guided sequence', description: 'Regional literacy sequence', status: 'draft' },
    { id: 'path-search-published', title: 'Regional published path', description: '', status: 'published' },
    { id: 'path-search-archived', title: 'Regional archived path', description: '', status: 'archived' },
    { id: 'path-search-percent', title: 'Progress 50% path', description: '', status: 'draft' },
    { id: 'path-search-wildcard-decoy', title: 'Progress 50X path', description: '', status: 'draft' },
  ];
  const insertPath = database.prepare(`INSERT INTO learning_paths (id, title, description, status, self_enrollment, created_by, updated_by)
    VALUES (?, ?, ?, ?, ?, 'admin-1', 'admin-1')`);
  for (const path of paths) insertPath.run(path.id, path.title, path.description, path.status, path.id === 'path-search-published' ? 1 : 0);
  database.prepare(`INSERT INTO learning_path_courses (id, path_id, course_id, position, requires_previous)
    VALUES ('path-search-public-course', 'path-search-published', 'course-empty', 0, 0)`).run();

  const searchPaths = async (params, userId = 'admin-1') => {
    const query = new URLSearchParams(params);
    return fetch(apiUrl(`/learning-paths?${query}`), { headers: userHeaders(userId) });
  };

  try {
    const titleAndStatusResponse = await searchPaths({ q: 'regional', status: 'draft', page: '99' });
    assert.equal(titleAndStatusResponse.status, 200);
    const titleAndStatus = await titleAndStatusResponse.json();
    assert.equal(titleAndStatus.total, 2);
    assert.equal(titleAndStatus.page, 1);
    assert.equal(titleAndStatus.hasMore, false);
    assert.deepEqual(new Set(titleAndStatus.paths.map((path) => path.id)), new Set([
      'path-search-title-draft', 'path-search-description-draft',
    ]));

    const descriptionResponse = await searchPaths({ q: 'literacy', status: 'all' });
    assert.equal(descriptionResponse.status, 200);
    const descriptionMatches = await descriptionResponse.json();
    assert.deepEqual(descriptionMatches.paths.map((path) => path.id), ['path-search-description-draft']);

    const activeStatusResponse = await searchPaths({ q: 'regional', status: 'all' });
    assert.equal(activeStatusResponse.status, 200);
    const activeStatusMatches = await activeStatusResponse.json();
    assert.equal(activeStatusMatches.total, 3);
    assert.equal(activeStatusMatches.paths.some((path) => path.id === 'path-search-archived'), false);

    const wildcardResponse = await searchPaths({ q: '50%', status: 'all' });
    assert.equal(wildcardResponse.status, 200);
    const wildcardMatches = await wildcardResponse.json();
    assert.deepEqual(wildcardMatches.paths.map((path) => path.id), ['path-search-percent']);

    const learnerResponse = await searchPaths({ q: 'regional' }, 'learner-active');
    assert.equal(learnerResponse.status, 200);
    const learnerMatches = await learnerResponse.json();
    assert.deepEqual(learnerMatches.paths.map((path) => path.id), ['path-search-published']);

    const overlongResponse = await searchPaths({ q: 'x'.repeat(121), status: 'all' });
    assert.equal(overlongResponse.status, 400);
    assert.equal((await overlongResponse.json()).code, 'validation_error');
  } finally {
    database.prepare(`DELETE FROM learning_paths WHERE id IN (${paths.map(() => '?').join(', ')})`).run(...paths.map((path) => path.id));
  }
});

test('staff learning-path page queries use indexes for their update ordering', () => {
  function queryPlan(sql, params = []) {
    return database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map((row) => row.detail).join('\n');
  }

  const activePlan = queryPlan(`SELECT * FROM learning_paths WHERE status != 'archived'
    ORDER BY updated_at DESC, id LIMIT ? OFFSET ?`, [20, 0]);
  assert.match(activePlan, /learning_paths_active_updated/);
  assert.doesNotMatch(activePlan, /USE TEMP B-TREE FOR ORDER BY/);

  const searchedActivePlan = queryPlan(`SELECT p.* FROM learning_paths p WHERE status != 'archived'
    AND (p.title LIKE ? ESCAPE '!' OR p.description LIKE ? ESCAPE '!')
    ORDER BY p.updated_at DESC, p.id LIMIT ? OFFSET ?`, ['%path%', '%path%', 20, 0]);
  assert.match(searchedActivePlan, /learning_paths_active_updated/);
  assert.doesNotMatch(searchedActivePlan, /USE TEMP B-TREE FOR ORDER BY/);

  for (const status of ['published', 'archived']) {
    const statusPlan = queryPlan(`SELECT * FROM learning_paths WHERE status = ?
      ORDER BY updated_at DESC, id LIMIT ? OFFSET ?`, [status, 20, 0]);
    assert.match(statusPlan, /learning_paths_status_updated/);
    assert.doesNotMatch(statusPlan, /USE TEMP B-TREE FOR ORDER BY/);
  }
});

test('staff course pages use indexes for their update ordering', () => {
  const courseIds = Array.from({ length: 2000 }, (_, index) => `course-order-plan-${String(index).padStart(4, '0')}`);
  const addCourse = database.prepare(`INSERT INTO courses (id, title, status, created_by, updated_by, updated_at)
    VALUES (?, ?, ?, 'admin-1', 'admin-1', ?)`);
  const addCourses = database.transaction(() => {
    for (const [index, courseId] of courseIds.entries()) {
      const status = ['draft', 'published', 'archived'][index % 3];
      const updatedAt = `2026-10-${String((index % 9) + 1).padStart(2, '0')} 12:00:00`;
      addCourse.run(courseId, `Ordered course ${index}`, status, updatedAt);
    }
  });
  addCourses();

  try {
    database.exec('ANALYZE courses');
    function queryPlan(sql, params = []) {
      return database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map((row) => row.detail).join('\n');
    }
    const fromCourseOwners = 'SELECT c.*, u.username AS owner FROM courses c JOIN users u ON u.id = c.created_by';
    const activePlan = queryPlan(`${fromCourseOwners} ORDER BY c.updated_at DESC, c.id ASC LIMIT ? OFFSET ?`, [50, 0]);
    assert.match(activePlan, /courses_updated_order/);
    assert.doesNotMatch(activePlan, /USE TEMP B-TREE FOR ORDER BY/);

    for (const status of ['published', 'draft', 'archived']) {
      const statusPlan = queryPlan(`${fromCourseOwners} WHERE c.status = ? ORDER BY c.updated_at DESC, c.id ASC LIMIT ? OFFSET ?`, [status, 50, 0]);
      assert.match(statusPlan, /courses_status_updated_order/);
      assert.doesNotMatch(statusPlan, /USE TEMP B-TREE FOR ORDER BY/);
    }

    const catalogTitlePlan = queryPlan(`SELECT c.* FROM courses c WHERE c.status = 'published'
      AND (c.visibility = 'public' OR EXISTS (
        SELECT 1 FROM course_grants g WHERE g.course_id = c.id AND g.user_id = ?
      )) ORDER BY c.title COLLATE NOCASE ASC, c.id ASC LIMIT ? OFFSET ?`, ['learner-order-plan', 50, 0]);
    assert.match(catalogTitlePlan, /courses_status_title_order/);
    assert.doesNotMatch(catalogTitlePlan, /USE TEMP B-TREE FOR ORDER BY/);
  } finally {
    database.prepare(`DELETE FROM courses WHERE id IN (${courseIds.map(() => '?').join(', ')})`).run(...courseIds);
    database.exec('ANALYZE courses');
  }
});

test('course access pages keep assigned learners first and avoid sorting unassigned learners', async () => {
  const courseId = 'course-access-roster-order';
  const learnerIds = Array.from({ length: 125 }, (_, index) => `roster-learner-${String(index).padStart(3, '0')}`);
  database.prepare(`INSERT INTO courses (id, title, status, created_by, updated_by)
    VALUES (?, 'Roster ordering course', 'published', 'admin-1', 'admin-1')`).run(courseId);
  const addLearner = database.prepare(`INSERT INTO users (id, username, email, password_hash, role, disabled)
    VALUES (?, ?, ?, 'not-used', 'learner', ?)`);
  const addGrant = database.prepare(`INSERT INTO course_grants (id, course_id, user_id, granted_by, granted_at)
    VALUES (?, ?, ?, 'admin-1', '2026-10-01 08:00:00')`);
  const addFixtures = database.transaction(() => {
    for (const [index, learnerId] of learnerIds.entries()) {
      const suffix = String(index).padStart(3, '0');
      addLearner.run(learnerId, `roster_${suffix}`, `roster_${suffix}@example.invalid`, index === 52 ? 1 : 0);
      if (index < 55) addGrant.run(`roster-grant-${suffix}`, courseId, learnerId);
    }
  });
  addFixtures();

  try {
    const pageTwoResponse = await fetch(apiUrl(`/manage/courses/${courseId}/access?q=roster&page=2`), { headers: userHeaders('admin-1') });
    assert.equal(pageTwoResponse.status, 200);
    const pageTwo = await pageTwoResponse.json();
    assert.equal(pageTwo.total, 125);
    assert.equal(pageTwo.page, 2);
    assert.deepEqual(pageTwo.users.map((user) => user.username), [
      'roster_050', 'roster_051', 'roster_052', 'roster_053', 'roster_054',
      ...Array.from({ length: 45 }, (_, index) => `roster_${String(index + 55).padStart(3, '0')}`),
    ]);
    assert.deepEqual(pageTwo.users.slice(0, 5).map((user) => user.granted), [true, true, true, true, true]);
    assert.deepEqual(pageTwo.users.slice(5).map((user) => user.granted), Array(45).fill(false));
    assert.equal(pageTwo.users[2].disabled, true);

    const pageThreeResponse = await fetch(apiUrl(`/manage/courses/${courseId}/access?q=roster&page=3`), { headers: userHeaders('admin-1') });
    assert.equal(pageThreeResponse.status, 200);
    const pageThree = await pageThreeResponse.json();
    assert.equal(pageThree.users.length, 25);
    assert.deepEqual(pageThree.users.map((user) => user.username),
      Array.from({ length: 25 }, (_, index) => `roster_${String(index + 100).padStart(3, '0')}`));

    const combinedPlan = database.prepare(`EXPLAIN QUERY PLAN SELECT u.id, u.username FROM users u
      LEFT JOIN course_grants g ON g.user_id = u.id AND g.course_id = ?
      WHERE u.role = 'learner'
      ORDER BY CASE WHEN g.id IS NULL THEN 1 ELSE 0 END, u.username COLLATE NOCASE, u.id ASC LIMIT ? OFFSET ?`)
      .all(courseId, 50, 0).map((row) => row.detail).join('\n');
    assert.match(combinedPlan, /USE TEMP B-TREE FOR ORDER BY/);

    const unassignedPlan = database.prepare(`EXPLAIN QUERY PLAN SELECT u.id, u.username FROM users u
      WHERE u.role = 'learner' AND NOT EXISTS (
        SELECT 1 FROM course_grants g WHERE g.course_id = ? AND g.user_id = u.id
      ) ORDER BY u.username COLLATE NOCASE, u.id ASC LIMIT ? OFFSET ?`)
      .all(courseId, 50, 0).map((row) => row.detail).join('\n');
    assert.match(unassignedPlan, /users_role_username/);
    assert.doesNotMatch(unassignedPlan, /USE TEMP B-TREE FOR ORDER BY/);

    const assignedPlan = database.prepare(`EXPLAIN QUERY PLAN SELECT u.id, u.username FROM course_grants g
      CROSS JOIN users u ON u.id = g.user_id
      WHERE g.course_id = ? AND u.role = 'learner'
      ORDER BY u.username COLLATE NOCASE, u.id ASC LIMIT ? OFFSET ?`)
      .all(courseId, 50, 0).map((row) => row.detail).join('\n');
    assert.match(assignedPlan, /SEARCH g USING COVERING INDEX sqlite_autoindex_course_grants_2 \(course_id=\?\)/);
  } finally {
    database.prepare('DELETE FROM courses WHERE id = ?').run(courseId);
    database.prepare(`DELETE FROM users WHERE id IN (${learnerIds.map(() => '?').join(', ')})`).run(...learnerIds);
  }
});

test('learners cannot discover or open unavailable self-enrollment paths', async () => {
  async function readCatalog() {
    const firstResponse = await fetch(apiUrl('/learning-paths?page=1'), { headers: userHeaders('learner-active') });
    assert.equal(firstResponse.status, 200);
    const firstPage = await firstResponse.json();
    const paths = [...firstPage.paths];
    const pageCount = Math.max(1, Math.ceil(firstPage.total / firstPage.pageSize));
    for (let page = 2; page <= pageCount; page++) {
      const response = await fetch(apiUrl(`/learning-paths?page=${page}`), { headers: userHeaders('learner-active') });
      assert.equal(response.status, 200);
      paths.push(...(await response.json()).paths);
    }
    return { total: firstPage.total, paths };
  }

  const baseline = await readCatalog();
  database.exec(`
    INSERT INTO courses (id, title, status, created_by, updated_by) VALUES
      ('course-path-availability', 'Availability course', 'published', 'admin-1', 'admin-1'),
      ('course-path-unpublished', 'Unpublished path course', 'draft', 'admin-1', 'admin-1');
    INSERT INTO learning_paths (id, title, status, self_enrollment, created_by, updated_by) VALUES
      ('path-availability-private', 'Availability changes path', 'published', 1, 'admin-1', 'admin-1'),
      ('path-availability-unpublished', 'Unpublished course path', 'published', 1, 'admin-1', 'admin-1'),
      ('path-availability-empty', 'Empty legacy path', 'published', 1, 'admin-1', 'admin-1');
    INSERT INTO learning_path_courses (id, path_id, course_id, position, requires_previous) VALUES
      ('path-availability-private-course', 'path-availability-private', 'course-path-availability', 0, 0),
      ('path-availability-unpublished-course', 'path-availability-unpublished', 'course-path-unpublished', 0, 0);
  `);

  const pathIds = ['path-availability-private', 'path-availability-unpublished', 'path-availability-empty'];
  try {
    const availableCatalog = await readCatalog();
    assert.equal(availableCatalog.total, baseline.total + 1);
    assert.ok(availableCatalog.paths.some((path) => path.id === pathIds[0]));
    assert.equal(availableCatalog.paths.some((path) => path.id === pathIds[1] || path.id === pathIds[2]), false);

    const availableDetail = await fetch(apiUrl(`/learning-paths/${pathIds[0]}`), { headers: userHeaders('learner-active') });
    assert.equal(availableDetail.status, 200);
    for (const unavailablePathId of pathIds.slice(1)) {
      const detail = await fetch(apiUrl(`/learning-paths/${unavailablePathId}`), { headers: userHeaders('learner-active') });
      assert.equal(detail.status, 404);
      const enrollment = await fetch(apiUrl(`/learning-paths/${unavailablePathId}/enroll`), {
        method: 'POST', headers: userHeaders('learner-active'),
      });
      assert.equal(enrollment.status, 409);
      assert.equal((await enrollment.json()).code, 'path_unavailable');
    }

    database.prepare("UPDATE courses SET visibility = 'private' WHERE id = 'course-path-availability'").run();
    const unavailableCatalog = await readCatalog();
    assert.equal(unavailableCatalog.total, baseline.total);
    assert.equal(unavailableCatalog.paths.some((path) => path.id === pathIds[0]), false);
    const detail = await fetch(apiUrl(`/learning-paths/${pathIds[0]}`), { headers: userHeaders('learner-active') });
    assert.equal(detail.status, 404);
    const enrollment = await fetch(apiUrl(`/learning-paths/${pathIds[0]}/enroll`), {
      method: 'POST', headers: userHeaders('learner-active'),
    });
    assert.equal(enrollment.status, 409);
    assert.equal((await enrollment.json()).code, 'path_unavailable');
  } finally {
    database.prepare(`DELETE FROM learning_paths WHERE id IN (${pathIds.map(() => '?').join(', ')})`).run(...pathIds);
    database.prepare("DELETE FROM courses WHERE id IN ('course-path-availability', 'course-path-unpublished')").run();
  }
});

test('learning-path saves batch course validation and visibility lookups', async () => {
  database.exec(`
    INSERT INTO courses (id, title, status, created_by, updated_by) VALUES
      ('path-batch-third', 'Batch validation third', 'published', 'admin-1', 'admin-1');
    INSERT INTO learning_paths (id, title, status, self_enrollment, created_by, updated_by) VALUES
      ('path-batch-one', 'One-course path', 'draft', 0, 'admin-1', 'admin-1'),
      ('path-batch-three', 'Three-course path', 'draft', 0, 'admin-1', 'admin-1');
    INSERT INTO learning_path_courses (id, path_id, course_id, position, requires_previous) VALUES
      ('path-batch-one-step', 'path-batch-one', 'course-empty', 0, 0),
      ('path-batch-three-first', 'path-batch-three', 'course-analytics', 0, 0),
      ('path-batch-three-second', 'path-batch-three', 'course-empty', 1, 1),
      ('path-batch-three-third', 'path-batch-three', 'path-batch-third', 2, 1);
  `);

  async function measureRequest(url, init, expectedStatus = 200) {
    const originalPrepare = database.prepare;
    let queryCount = 0;
    database.prepare = (sql) => {
      queryCount += 1;
      return originalPrepare.call(database, sql);
    };
    try {
      const response = await fetch(url, init);
      assert.equal(response.status, expectedStatus);
      return queryCount;
    } finally {
      delete database.prepare;
    }
  }

  const createHeaders = { ...userHeaders('admin-1'), 'content-type': 'application/json' };
  try {
    const oneCourseCreateQueries = await measureRequest(apiUrl('/manage/learning-paths'), {
      method: 'POST', headers: createHeaders,
      body: JSON.stringify({ title: 'One course batch path', courses: [{ courseId: 'course-empty' }] }),
    }, 201);
    const threeCourseCreateQueries = await measureRequest(apiUrl('/manage/learning-paths'), {
      method: 'POST', headers: createHeaders,
      body: JSON.stringify({ title: 'Three course batch path', courses: [
        { courseId: 'course-analytics' }, { courseId: 'course-empty' }, { courseId: 'path-batch-third' },
      ] }),
    }, 201);
    assert.equal(threeCourseCreateQueries, oneCourseCreateQueries);

    const oneCourseUpdateQueries = await measureRequest(apiUrl('/manage/learning-paths/path-batch-one'), {
      method: 'PATCH', headers: createHeaders, body: JSON.stringify({ selfEnrollment: true }),
    });
    const threeCourseUpdateQueries = await measureRequest(apiUrl('/manage/learning-paths/path-batch-three'), {
      method: 'PATCH', headers: createHeaders, body: JSON.stringify({ selfEnrollment: true }),
    });
    assert.equal(threeCourseUpdateQueries, oneCourseUpdateQueries);
  } finally {
    database.prepare("DELETE FROM learning_paths WHERE id IN ('path-batch-one', 'path-batch-three')").run();
    database.prepare("DELETE FROM learning_paths WHERE title IN ('One course batch path', 'Three course batch path')").run();
    database.prepare("DELETE FROM courses WHERE id = 'path-batch-third'").run();
  }
});

test('competency catalog batches mapped-course completion summaries', async () => {
  database.exec(`
    INSERT INTO competencies (id, title, description, active, created_by) VALUES
      ('competency-query-one', 'One competency', '', 1, 'admin-1');
    INSERT INTO courses (id, title, status, created_by, updated_by) VALUES
      ('competency-query-second-course', 'Second competency course', 'published', 'admin-1', 'admin-1'),
      ('competency-query-third-course', 'Third competency course', 'published', 'admin-1', 'admin-1');
    INSERT INTO course_competencies (course_id, competency_id, created_by) VALUES
      ('course-analytics', 'competency-query-one', 'admin-1');
  `);

  async function measureCatalog() {
    const originalPrepare = database.prepare;
    let queryCount = 0;
    database.prepare = (sql) => {
      queryCount += 1;
      return originalPrepare.call(database, sql);
    };
    try {
      const response = await fetch(apiUrl('/competencies'), {
        headers: userHeaders('learner-active'),
      });
      assert.equal(response.status, 200);
      return { queryCount, competencies: (await response.json()).competencies };
    } finally {
      delete database.prepare;
    }
  }

  const oneCompetency = await measureCatalog();
  assert.equal(oneCompetency.competencies[0].achieved, true);
  assert.equal(oneCompetency.competencies[0].completedCourses, 1);

  database.exec(`
    INSERT INTO competencies (id, title, description, active, created_by) VALUES
      ('competency-query-two', 'Two competency', '', 1, 'admin-1'),
      ('competency-query-three', 'Three competency', '', 1, 'admin-1');
    INSERT INTO course_competencies (course_id, competency_id, created_by) VALUES
      ('competency-query-second-course', 'competency-query-two', 'admin-1'),
      ('competency-query-third-course', 'competency-query-three', 'admin-1');
  `);

  const threeCompetencies = await measureCatalog();
  assert.equal(threeCompetencies.queryCount, oneCompetency.queryCount);
  assert.deepEqual(threeCompetencies.competencies.map((item) => item.achieved), [true, false, false]);
  assert.deepEqual(threeCompetencies.competencies.map((item) => item.courseCount), [1, 1, 1]);
});

test('competency progress pages course details while retaining an overall achieved count', async () => {
  const baseResponse = await fetch(apiUrl('/competencies?page=1'), { headers: userHeaders('learner-active') });
  assert.equal(baseResponse.status, 200);
  const baseline = await baseResponse.json();
  const ids = Array.from({ length: COMPETENCY_PROGRESS_PAGE_SIZE + 2 }, (_, index) => `competency-page-${String(index).padStart(2, '0')}`);
  const insertCompetency = database.prepare(`INSERT INTO competencies (id, title, description, active, created_by)
    VALUES (?, ?, '', 1, 'admin-1')`);
  ids.forEach((id, index) => insertCompetency.run(id, `Progress page competency ${String(index).padStart(2, '0')}`));
  database.exec(`
    INSERT INTO courses (id, title, status, created_by, updated_by)
      VALUES ('competency-partial-course', 'Partial competency course', 'published', 'admin-1', 'admin-1');
    INSERT INTO course_modules (id, course_id, title, position)
      VALUES ('competency-partial-module', 'competency-partial-course', 'Module', 0);
    INSERT INTO lessons (id, module_id, title, position) VALUES
      ('competency-partial-lesson-one', 'competency-partial-module', 'Lesson one', 0),
      ('competency-partial-lesson-two', 'competency-partial-module', 'Lesson two', 1);
    INSERT INTO lesson_progress (user_id, lesson_id) VALUES ('learner-active', 'competency-partial-lesson-one');
  `);
  const insertMapping = database.prepare('INSERT INTO course_competencies (course_id, competency_id, created_by) VALUES (?, ?, ?)');
  insertMapping.run('course-analytics', ids[COMPETENCY_PROGRESS_PAGE_SIZE], 'admin-1');
  insertMapping.run('competency-partial-course', ids[COMPETENCY_PROGRESS_PAGE_SIZE + 1], 'admin-1');

  try {
    let firstPageMappingQuery = '';
    let achievementCandidateQuery = '';
    const originalPrepare = database.prepare;
    database.prepare = (sql) => {
      if (sql.includes('FROM course_competencies cc')) {
        if (sql.includes('cc.competency_id IN')) firstPageMappingQuery = sql;
        if (sql.includes('lesson_progress') && sql.includes('quiz_attempts')) achievementCandidateQuery = sql;
      }
      return originalPrepare.call(database, sql);
    };
    let firstResponse;
    try {
      firstResponse = await fetch(apiUrl('/competencies?page=1'), { headers: userHeaders('learner-active') });
    } finally {
      database.prepare = originalPrepare;
    }
    assert.equal(firstResponse.status, 200);
    assert.match(firstPageMappingQuery, /cc\.competency_id IN \(/);
    assert.match(achievementCandidateQuery, /EXISTS[\s\S]*lesson_progress[\s\S]*quiz_attempts/);
    const firstPage = await firstResponse.json();
    assert.equal(firstPage.pageSize, COMPETENCY_PROGRESS_PAGE_SIZE);
    assert.equal(firstPage.total, baseline.total + ids.length);
    assert.equal(firstPage.achievedTotal, baseline.achievedTotal + 1);
    assert.equal(firstPage.competencies.length, COMPETENCY_PROGRESS_PAGE_SIZE);
    assert.equal(firstPage.hasMore, true);

    const collected = [...firstPage.competencies];
    let nextPage = 2;
    let secondMappingQuery = '';
    while (firstPage.hasMore && nextPage <= Math.ceil(firstPage.total / firstPage.pageSize)) {
      const originalPrepare = database.prepare;
      if (nextPage === 2) {
        database.prepare = (sql) => {
          if (sql.includes('FROM course_competencies cc')) secondMappingQuery = sql;
          return originalPrepare.call(database, sql);
        };
      }
      let pageResponse;
      try {
        pageResponse = await fetch(apiUrl(`/competencies?page=${nextPage}`), { headers: userHeaders('learner-active') });
      } finally {
        if (nextPage === 2) database.prepare = originalPrepare;
      }
      assert.equal(pageResponse.status, 200);
      const pageResult = await pageResponse.json();
      assert.equal(pageResult.page, nextPage);
      assert.equal(pageResult.total, firstPage.total);
      assert.equal(pageResult.hasMore, nextPage * pageResult.pageSize < firstPage.total);
      assert.equal('achievedTotal' in pageResult, false);
      assert.ok(pageResult.competencies.length <= firstPage.pageSize);
      collected.push(...pageResult.competencies);
      if (nextPage === 2) assert.match(secondMappingQuery, /cc\.competency_id IN \(/);
      nextPage += 1;
    }

    assert.equal(collected.length, firstPage.total);
    assert.equal(new Set(collected.map((item) => item.id)).size, firstPage.total);
    assert.deepEqual(collected.filter((item) => ids.includes(item.id)).map((item) => item.id), ids);
    const completed = collected.find((item) => item.id === ids[COMPETENCY_PROGRESS_PAGE_SIZE]);
    assert.equal(completed.achieved, true);
    assert.deepEqual(completed.courses, [{ id: 'course-analytics', title: 'Analytics course', completed: true }]);
    const partial = collected.find((item) => item.id === ids[COMPETENCY_PROGRESS_PAGE_SIZE + 1]);
    assert.equal(partial.achieved, false);
    assert.deepEqual(partial.courses.map((course) => course.completed), [false]);
  } finally {
    database.prepare('DELETE FROM course_competencies WHERE competency_id IN (' + ids.map(() => '?').join(', ') + ')').run(...ids);
    database.prepare('DELETE FROM competencies WHERE id IN (' + ids.map(() => '?').join(', ') + ')').run(...ids);
    database.prepare("DELETE FROM courses WHERE id = 'competency-partial-course'").run();
  }
});

test('competency course lists order duplicate course titles by course ID', async () => {
  database.exec(`
    INSERT INTO competencies (id, title, description, active, created_by)
      VALUES ('competency-course-title-order', 'Duplicate course titles', '', 1, 'admin-1');
    INSERT INTO courses (id, title, status, created_by, updated_by) VALUES
      ('course-title-order-z', 'Same mapped course title', 'published', 'admin-1', 'admin-1'),
      ('course-title-order-a', 'Same mapped course title', 'published', 'admin-1', 'admin-1');
    INSERT INTO course_competencies (course_id, competency_id, created_by) VALUES
      ('course-title-order-z', 'competency-course-title-order', 'admin-1'),
      ('course-title-order-a', 'competency-course-title-order', 'admin-1');
  `);

  let response;
  database.exec('PRAGMA reverse_unordered_selects = ON');
  try {
    response = await fetch(apiUrl('/competencies'), { headers: userHeaders('learner-active') });
  } finally {
    database.exec('PRAGMA reverse_unordered_selects = OFF');
  }

  assert.equal(response.status, 200);
  const competency = (await response.json()).competencies.find((item) => item.id === 'competency-course-title-order');
  assert.deepEqual(competency.courses.map((course) => course.id), ['course-title-order-a', 'course-title-order-z']);
});

test('admin competency creation returns a useful conflict for case-insensitive duplicate titles', async () => {
  database.prepare(`INSERT INTO competencies (id, title, description, active, created_by)
    VALUES (?, ?, '', 1, 'admin-1')`).run('competency-duplicate-title', 'Existing competency');
  const auditCount = () => database.prepare(`SELECT COUNT(*) AS count FROM audit_logs
    WHERE action = 'competency.created'`).get().count;
  const beforeDuplicate = auditCount();
  let createdId;

  try {
    const duplicateResponse = await fetch(apiUrl('/admin/competencies'), {
      method: 'POST',
      headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'EXISTING COMPETENCY', description: '' }),
    });
    assert.equal(duplicateResponse.status, 409);
    assert.deepEqual(await duplicateResponse.json(), {
      error: 'A competency with this name already exists.',
      code: 'duplicate_competency',
    });
    assert.equal(auditCount(), beforeDuplicate);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM competencies WHERE title = ?').get('existing competency').count, 1);

    const createResponse = await fetch(apiUrl('/admin/competencies'), {
      method: 'POST',
      headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'A distinct competency', description: 'Created after the duplicate check.' }),
    });
    assert.equal(createResponse.status, 201);
    const { competency } = await createResponse.json();
    createdId = competency.id;
    assert.equal(competency.title, 'A distinct competency');
    assert.equal(auditCount(), beforeDuplicate + 1);
  } finally {
    if (createdId) {
      database.prepare("DELETE FROM audit_logs WHERE action = 'competency.created' AND entity_id = ?").run(createdId);
      database.prepare('DELETE FROM competencies WHERE id = ?').run(createdId);
    }
    database.prepare('DELETE FROM competencies WHERE id = ?').run('competency-duplicate-title');
  }
});

test('admin competency pages are bounded, stable, clamped, and include the created item page', async () => {
  const pageSize = 25;
  const fixtureIds = Array.from({ length: 52 }, (_, index) => `competency-page-${String(index).padStart(2, '0')}`);
  const insert = database.prepare(`INSERT INTO competencies (id, title, description, active, created_by)
    VALUES (?, ?, '', ?, 'admin-1')`);
  let createdId;
  try {
    database.transaction(() => {
      fixtureIds.forEach((id, index) => insert.run(id, `Pagination competency ${String(index).padStart(2, '0')}`, index % 2));
    }).immediate();

    const secondPageResponse = await fetch(apiUrl('/admin/competencies?page=2'), { headers: userHeaders('admin-1') });
    assert.equal(secondPageResponse.status, 200);
    const secondPage = await secondPageResponse.json();
    const orderedRows = database.prepare(`SELECT id FROM competencies
      ORDER BY active DESC, title COLLATE NOCASE, id`).all();
    const pageQueryPlan = database.prepare(`EXPLAIN QUERY PLAN SELECT * FROM competencies
      ORDER BY active DESC, title COLLATE NOCASE, id LIMIT ? OFFSET ?`).all(pageSize, pageSize);
    assert.ok(pageQueryPlan.some((row) => row.detail.includes('competencies_admin_order')), JSON.stringify(pageQueryPlan));
    assert.ok(!pageQueryPlan.some((row) => row.detail.includes('TEMP B-TREE')), JSON.stringify(pageQueryPlan));
    assert.equal(secondPage.total, orderedRows.length);
    assert.equal(secondPage.page, 2);
    assert.equal(secondPage.pageSize, pageSize);
    assert.equal(secondPage.hasMore, true);
    assert.deepEqual(secondPage.competencies.map((item) => item.id), orderedRows.slice(pageSize, pageSize * 2).map((item) => item.id));

    const toggledId = fixtureIds[0];
    const toggleResponse = await fetch(apiUrl(`/admin/competencies/${toggledId}`), {
      method: 'PATCH',
      headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
      body: JSON.stringify({ active: true }),
    });
    assert.equal(toggleResponse.status, 200);
    const toggled = await toggleResponse.json();
    const movedPageResponse = await fetch(apiUrl(`/admin/competencies?page=${toggled.page}`), { headers: userHeaders('admin-1') });
    const movedPage = await movedPageResponse.json();
    assert.equal(movedPage.page, toggled.page);
    assert.ok(movedPage.competencies.some((item) => item.id === toggledId));

    const createResponse = await fetch(apiUrl('/admin/competencies'), {
      method: 'POST',
      headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Zulu pagination placement', description: '' }),
    });
    assert.equal(createResponse.status, 201);
    const created = await createResponse.json();
    createdId = created.competency.id;
    const placementPage = await fetch(apiUrl(`/admin/competencies?page=${created.page}`), { headers: userHeaders('admin-1') });
    const placedItems = await placementPage.json();
    assert.equal(placedItems.page, created.page);
    assert.ok(placedItems.competencies.some((item) => item.id === createdId));

    const lastPageNumber = Math.ceil(placedItems.total / pageSize);
    const clampedResponse = await fetch(apiUrl('/admin/competencies?page=999999'), { headers: userHeaders('admin-1') });
    const clamped = await clampedResponse.json();
    assert.equal(clamped.page, lastPageNumber);
    assert.equal(clamped.hasMore, false);
    assert.ok(clamped.competencies.length <= pageSize);
  } finally {
    if (createdId) database.prepare("DELETE FROM audit_logs WHERE action = 'competency.created' AND entity_id = ?").run(createdId);
    database.prepare(`DELETE FROM audit_logs WHERE action = 'competency.updated' AND entity_id IN (${fixtureIds.map(() => '?').join(', ')})`).run(...fixtureIds);
    database.prepare(`DELETE FROM competencies WHERE id IN (${fixtureIds.map(() => '?').join(', ')})`).run(...fixtureIds);
    if (createdId) database.prepare('DELETE FROM competencies WHERE id = ?').run(createdId);
  }
});

test('admin competency search filters titles and descriptions before pagination', async () => {
  const pageSize = 25;
  const cohortIds = Array.from({ length: pageSize + 2 }, (_, index) => `competency-search-${String(index).padStart(2, '0')}`);
  const extraIds = ['competency-search-description', 'competency-search-literal', 'competency-search-near'];
  const fixtureIds = [...cohortIds, ...extraIds];
  const insert = database.prepare(`INSERT INTO competencies (id, title, description, active, created_by)
    VALUES (?, ?, ?, ?, 'admin-1')`);
  try {
    database.transaction(() => {
      cohortIds.forEach((id, index) => insert.run(id, `Search cohort ${String(index).padStart(2, '0')}`, 'Large skill catalog', index % 2));
      insert.run(extraIds[0], 'Accessibility standards', 'Compliance matrix for learning', 1);
      insert.run(extraIds[1], 'Literal %_! marker', '', 1);
      insert.run(extraIds[2], 'Literal xx! marker', '', 1);
    }).immediate();

    const searchUrl = (query, page = 1) => {
      const params = new URLSearchParams({ q: query, page: String(page) });
      return apiUrl(`/admin/competencies?${params}`);
    };
    const firstPageResponse = await fetch(searchUrl('SEARCH COHORT'), { headers: userHeaders('admin-1') });
    assert.equal(firstPageResponse.status, 200);
    const firstPage = await firstPageResponse.json();
    assert.equal(firstPage.total, cohortIds.length);
    assert.equal(firstPage.page, 1);
    assert.equal(firstPage.competencies.length, pageSize);
    assert.equal(firstPage.hasMore, true);
    assert.ok(firstPage.competencies.every((competency) => competency.title.startsWith('Search cohort')));

    const secondPageResponse = await fetch(searchUrl('SEARCH COHORT', 2), { headers: userHeaders('admin-1') });
    const secondPage = await secondPageResponse.json();
    assert.equal(secondPage.total, cohortIds.length);
    assert.equal(secondPage.page, 2);
    assert.equal(secondPage.competencies.length, 2);
    assert.equal(secondPage.hasMore, false);

    const toggleResponse = await fetch(apiUrl(`/admin/competencies/${cohortIds[24]}?q=SEARCH%20COHORT`), {
      method: 'PATCH',
      headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
      body: JSON.stringify({ active: true }),
    });
    assert.equal(toggleResponse.status, 200);
    const toggleResult = await toggleResponse.json();
    assert.equal(toggleResult.page, 1, 'the returned page should account for the filtered rank after activation');
    const afterToggleResponse = await fetch(searchUrl('SEARCH COHORT', toggleResult.page), { headers: userHeaders('admin-1') });
    const afterTogglePage = await afterToggleResponse.json();
    assert.equal(afterTogglePage.total, cohortIds.length);
    assert.equal(afterTogglePage.page, 1);
    assert.ok(afterTogglePage.competencies.some((competency) => competency.id === cohortIds[24]));

    const descriptionResponse = await fetch(searchUrl('COMPLIANCE MATRIX'), { headers: userHeaders('admin-1') });
    const descriptionResults = await descriptionResponse.json();
    assert.equal(descriptionResults.total, 1);
    assert.equal(descriptionResults.competencies[0].id, extraIds[0]);

    const literalResponse = await fetch(searchUrl('%_!'), { headers: userHeaders('admin-1') });
    const literalResults = await literalResponse.json();
    assert.equal(literalResults.total, 1);
    assert.equal(literalResults.competencies[0].id, extraIds[1]);

    const repeatedQueryResponse = await fetch(`${apiUrl('/admin/competencies')}?q=first&q=second`, { headers: userHeaders('admin-1') });
    assert.equal(repeatedQueryResponse.status, 400);
    assert.equal((await repeatedQueryResponse.json()).code, 'validation_error');
  } finally {
    database.prepare(`DELETE FROM audit_logs WHERE action = 'competency.updated' AND entity_id IN (${fixtureIds.map(() => '?').join(', ')})`).run(...fixtureIds);
    database.prepare(`DELETE FROM competencies WHERE id IN (${fixtureIds.map(() => '?').join(', ')})`).run(...fixtureIds);
  }
});

test('admin competency updates reject duplicate titles without changing or auditing the record', async () => {
  database.prepare(`INSERT INTO competencies (id, title, description, active, created_by) VALUES
    ('competency-update-existing', 'Existing competency', 'Original description', 1, 'admin-1'),
    ('competency-update-target', 'Target competency', 'Keep this description', 1, 'admin-1')`).run();
  const auditCount = () => database.prepare(`SELECT COUNT(*) AS count FROM audit_logs
    WHERE action = 'competency.updated' AND entity_id = 'competency-update-target'`).get().count;
  const beforeUpdate = auditCount();

  try {
    const response = await fetch(apiUrl('/admin/competencies/competency-update-target'), {
      method: 'PATCH',
      headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'EXISTING COMPETENCY' }),
    });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: 'A competency with this name already exists.',
      code: 'duplicate_competency',
    });
    assert.deepEqual(database.prepare('SELECT title, description, active FROM competencies WHERE id = ?')
      .get('competency-update-target'), {
      title: 'Target competency',
      description: 'Keep this description',
      active: 1,
    });
    assert.equal(auditCount(), beforeUpdate);
  } finally {
    database.prepare("DELETE FROM audit_logs WHERE action = 'competency.updated' AND entity_id = 'competency-update-target'").run();
    database.prepare("DELETE FROM competencies WHERE id IN ('competency-update-existing', 'competency-update-target')").run();
  }
});

test('admin competency updates reject non-object bodies and keep empty patches unaudited', async () => {
  const competencyId = 'competency-update-body-shape';
  database.prepare(`INSERT INTO competencies (id, title, description, active, created_by, updated_at)
    VALUES (?, 'Body shape target', 'Original description', 1, 'admin-1', '2000-01-01 00:00:00')`).run(competencyId);
  const auditCount = () => database.prepare(`SELECT COUNT(*) AS count FROM audit_logs
    WHERE action = 'competency.updated' AND entity_id = ?`).get(competencyId).count;
  const original = database.prepare('SELECT title, description, active, updated_at FROM competencies WHERE id = ?').get(competencyId);

  try {
    for (const body of ['[]']) {
      const response = await fetch(apiUrl(`/admin/competencies/${competencyId}`), {
        method: 'PATCH',
        headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
        body,
      });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), {
        error: 'Competency changes must be an object.',
        code: 'validation_error',
      });
      assert.deepEqual(database.prepare('SELECT title, description, active, updated_at FROM competencies WHERE id = ?').get(competencyId), original);
      assert.equal(auditCount(), 0);
    }

    const emptyPatch = await fetch(apiUrl(`/admin/competencies/${competencyId}`), {
      method: 'PATCH',
      headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(emptyPatch.status, 200);
    assert.deepEqual((await emptyPatch.json()).competency, database.prepare('SELECT * FROM competencies WHERE id = ?').get(competencyId));
    assert.deepEqual(database.prepare('SELECT title, description, active, updated_at FROM competencies WHERE id = ?').get(competencyId), original);
    assert.equal(auditCount(), 0);

    const realChange = await fetch(apiUrl(`/admin/competencies/${competencyId}`), {
      method: 'PATCH',
      headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'Updated description' }),
    });
    assert.equal(realChange.status, 200);
    assert.equal((await realChange.json()).competency.description, 'Updated description');
    assert.equal(auditCount(), 1);
  } finally {
    database.prepare('DELETE FROM audit_logs WHERE action = ? AND entity_id = ?').run('competency.updated', competencyId);
    database.prepare('DELETE FROM competencies WHERE id = ?').run(competencyId);
  }
});

test('competency catalog hides mapped private courses without current access', async () => {
  const courseId = 'course-private-competency';
  const competencyId = 'competency-private-course';
  database.exec(`
    INSERT INTO competencies (id, title, description, active, created_by)
      VALUES ('${competencyId}', 'Private course skill', '', 1, 'admin-1');
    INSERT INTO courses (id, title, visibility, status, created_by, updated_by)
      VALUES ('${courseId}', 'Restricted course title', 'private', 'published', 'admin-1', 'admin-1');
    INSERT INTO course_modules (id, course_id, title, position)
      VALUES ('module-private-competency', '${courseId}', 'Module', 0);
    INSERT INTO lessons (id, module_id, title, position)
      VALUES ('lesson-private-competency', 'module-private-competency', 'Lesson', 0);
    INSERT INTO lesson_progress (user_id, lesson_id, completed_at)
      VALUES ('learner-active', 'lesson-private-competency', CURRENT_TIMESTAMP);
    INSERT INTO course_competencies (course_id, competency_id, created_by)
      VALUES ('${courseId}', '${competencyId}', 'admin-1');
  `);

  async function getCompetency() {
    const response = await fetch(apiUrl('/competencies'), { headers: userHeaders('learner-active') });
    assert.equal(response.status, 200);
    return (await response.json()).competencies.find((item) => item.id === competencyId);
  }

  try {
    const hidden = await getCompetency();
    assert.deepEqual(hidden.courses, []);
    assert.equal(hidden.courseCount, 0);
    assert.equal(hidden.completedCourses, 0);
    assert.equal(hidden.achieved, false);

    database.prepare(`INSERT INTO course_grants (id, course_id, user_id, granted_by)
      VALUES ('grant-private-competency', ?, 'learner-active', 'admin-1')`).run(courseId);
    const granted = await getCompetency();
    assert.deepEqual(granted.courses, [{ id: courseId, title: 'Restricted course title', completed: true }]);
    assert.equal(granted.courseCount, 1);
    assert.equal(granted.completedCourses, 1);
    assert.equal(granted.achieved, true);

    database.prepare('DELETE FROM course_grants WHERE id = ?').run('grant-private-competency');
    const revoked = await getCompetency();
    assert.deepEqual(revoked.courses, []);
    assert.equal(revoked.achieved, false);
  } finally {
    database.prepare('DELETE FROM course_grants WHERE id = ?').run('grant-private-competency');
    database.prepare('DELETE FROM competencies WHERE id = ?').run(competencyId);
    database.prepare('DELETE FROM courses WHERE id = ?').run(courseId);
  }
});

test('course competency mappings can remove legacy inactive competencies', async () => {
  database.exec(`
    INSERT INTO courses (id, title, status, created_by, updated_by)
      VALUES ('course-competency-mapping', 'Competency mapping', 'published', 'admin-1', 'admin-1');
    INSERT INTO competencies (id, title, description, active, created_by) VALUES
      ('competency-mapping-active', 'Active mapping option', '', 1, 'admin-1'),
      ('competency-mapping-inactive', 'Inactive mapped option', '', 0, 'admin-1');
    INSERT INTO course_competencies (course_id, competency_id, created_by)
      VALUES ('course-competency-mapping', 'competency-mapping-inactive', 'admin-1');
  `);

  const listResponse = await fetch(apiUrl('/manage/courses/course-competency-mapping/competencies'), {
    headers: userHeaders('admin-1'),
  });
  assert.equal(listResponse.status, 200);
  const mapping = await listResponse.json();
  assert.ok(mapping.competencies.some((item) => item.id === 'competency-mapping-active' && item.active));
  assert.ok(mapping.competencies.some((item) => item.id === 'competency-mapping-inactive' && !item.active));
  assert.deepEqual(mapping.selected, ['competency-mapping-inactive']);
  assert.equal(mapping.selectionLimit, 200);

  function mappingAuditCount() {
    return database.prepare(`SELECT COUNT(*) AS count FROM audit_logs
      WHERE action = 'competency.course_mapping_changed' AND entity_id = 'course-competency-mapping'`).get().count;
  }
  const initialAuditCount = mappingAuditCount();
  const unchangedResponse = await fetch(apiUrl('/manage/courses/course-competency-mapping/competencies'), {
    method: 'PUT',
    headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
    body: JSON.stringify({ competencyIds: ['competency-mapping-inactive'] }),
  });
  assert.equal(unchangedResponse.status, 200);
  assert.equal(mappingAuditCount(), initialAuditCount);

  const removeResponse = await fetch(apiUrl('/manage/courses/course-competency-mapping/competencies'), {
    method: 'PUT',
    headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
    body: JSON.stringify({ competencyIds: [] }),
  });
  assert.equal(removeResponse.status, 200);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM course_competencies WHERE course_id = ?').get('course-competency-mapping').count, 0);
  assert.equal(mappingAuditCount(), initialAuditCount + 1);

  const readdResponse = await fetch(apiUrl('/manage/courses/course-competency-mapping/competencies'), {
    method: 'PUT',
    headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
    body: JSON.stringify({ competencyIds: ['competency-mapping-inactive'] }),
  });
  assert.equal(readdResponse.status, 400);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM course_competencies WHERE course_id = ?').get('course-competency-mapping').count, 0);

  const overLimitResponse = await fetch(apiUrl('/manage/courses/course-competency-mapping/competencies'), {
    method: 'PUT',
    headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
    body: JSON.stringify({ competencyIds: Array.from({ length: 201 }, (_, index) => `nonexistent-competency-${index}`) }),
  });
  assert.equal(overLimitResponse.status, 400);
  assert.equal((await overLimitResponse.json()).code, 'validation_error');
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM course_competencies WHERE course_id = ?').get('course-competency-mapping').count, 0);
});

test('learning-path course selection rejects requests over the shared limit', async () => {
  const title = 'Over-limit path regression';
  const response = await fetch(apiUrl('/manage/learning-paths'), {
    method: 'POST',
    headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
    body: JSON.stringify({
      title,
      courses: Array.from({ length: MAX_LEARNING_PATH_COURSES + 1 }, (_, index) => ({ courseId: `missing-course-${index}` })),
    }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: `Provide an ordered list of up to ${MAX_LEARNING_PATH_COURSES} courses.`,
    code: 'validation_error',
  });
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM learning_paths WHERE title = ?').get(title).count, 0);
});

test('learning-path creation rejects falsey non-array course lists', async () => {
  const invalidCourseLists = [null, false, 0, ''];

  for (const [index, courses] of invalidCourseLists.entries()) {
    const title = `Invalid course list ${index}`;
    const response = await fetch(apiUrl('/manage/learning-paths'), {
      method: 'POST',
      headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
      body: JSON.stringify({ title, courses }),
    });

    assert.equal(response.status, 400, `courses=${JSON.stringify(courses)}`);
    assert.deepEqual(await response.json(), {
      error: `Provide an ordered list of up to ${MAX_LEARNING_PATH_COURSES} courses.`,
      code: 'validation_error',
    });
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM learning_paths WHERE title = ?').get(title).count, 0);
  }

  const omittedResponse = await fetch(apiUrl('/manage/learning-paths'), {
    method: 'POST',
    headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Omitted course list remains a draft' }),
  });
  assert.equal(omittedResponse.status, 201);
  assert.equal((await omittedResponse.json()).path.courseCount, 0);
});

test('learning-path creation rechecks course availability in its write transaction', async () => {
  const courseId = 'path-create-availability-race';
  const title = 'Course archived before path creation';
  database.prepare(`INSERT INTO courses (id, title, status, created_by, updated_by)
    VALUES (?, ?, 'published', 'admin-1', 'admin-1')`).run(courseId, title);

  const originalTransaction = database.transaction;
  let archivedBeforeTransaction = false;
  database.transaction = function interceptPathCreation(callback, ...options) {
    if (!archivedBeforeTransaction) {
      archivedBeforeTransaction = true;
      database.prepare("UPDATE courses SET status = 'archived' WHERE id = ?").run(courseId);
    }
    return originalTransaction.call(this, callback, ...options);
  };

  try {
    const response = await fetch(apiUrl('/manage/learning-paths'), {
      method: 'POST',
      headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
      body: JSON.stringify({ title, courses: [{ courseId }] }),
    });

    assert.equal(archivedBeforeTransaction, true);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'invalid_path_course');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM learning_paths WHERE title = ?').get(title).count, 0);
    assert.equal(database.prepare('SELECT status FROM courses WHERE id = ?').get(courseId).status, 'archived');
  } finally {
    database.transaction = originalTransaction;
    database.prepare('DELETE FROM courses WHERE id = ?').run(courseId);
  }
});

test('learning-path creation rolls back when the response cannot be read', async () => {
  const title = 'Path response read transaction rollback';
  const auditSummary = `Created learning path: ${title}`;
  const originalPrepare = database.prepare;
  let payloadReadFailed = false;

  database.prepare = (sql) => {
    if (sql.replace(/\s+/g, ' ').trim() === 'SELECT pc.id AS path_course_id, pc.path_id, pc.course_id, pc.position, pc.requires_previous, c.* FROM learning_path_courses pc JOIN courses c ON c.id = pc.course_id WHERE pc.path_id IN (?) ORDER BY pc.path_id, pc.position') {
      payloadReadFailed = true;
      throw new Error('Injected learning-path creation payload read failure');
    }
    return originalPrepare.call(database, sql);
  };

  try {
    // Fail after the path and its audit entry are written to verify both roll back together.
    const response = await fetch(apiUrl('/manage/learning-paths'), {
      method: 'POST',
      headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
      body: JSON.stringify({ title, courses: [] }),
    });

    assert.equal(payloadReadFailed, true);
    assert.equal(response.status, 500);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM learning_paths WHERE title = ?').get(title).count, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM audit_logs WHERE action = ? AND summary = ?')
      .get('path.created', auditSummary).count, 0);
  } finally {
    database.prepare = originalPrepare;
    database.prepare('DELETE FROM audit_logs WHERE action = ? AND summary = ?').run('path.created', auditSummary);
    database.prepare('DELETE FROM learning_paths WHERE title = ?').run(title);
  }
});

test('program boolean request fields reject strings without changing access settings', async () => {
  const invalidCreate = await fetch(apiUrl('/manage/learning-paths'), {
    method: 'POST',
    headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Invalid self-enrollment flag', selfEnrollment: 'false', courses: [] }),
  });
  assert.equal(invalidCreate.status, 400);
  assert.equal((await invalidCreate.json()).code, 'validation_error');
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM learning_paths WHERE title = 'Invalid self-enrollment flag'").get().count, 0);

  const createResponse = await fetch(apiUrl('/manage/learning-paths'), {
    method: 'POST',
    headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Valid enrollment option', selfEnrollment: false, courses: [] }),
  });
  assert.equal(createResponse.status, 201);
  const { path } = await createResponse.json();
  assert.equal(path.selfEnrollment, false);

  const invalidUpdate = await fetch(apiUrl(`/manage/learning-paths/${path.id}`), {
    method: 'PATCH',
    headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
    body: JSON.stringify({ selfEnrollment: 'false' }),
  });
  assert.equal(invalidUpdate.status, 400);
  assert.equal((await invalidUpdate.json()).code, 'validation_error');
  assert.equal(database.prepare('SELECT self_enrollment FROM learning_paths WHERE id = ?').get(path.id).self_enrollment, 0);
});

test('learning-path patches reject arrays and skip no-op writes and audit events', async () => {
  database.prepare(`INSERT INTO learning_paths (id, title, description, status, self_enrollment, created_by, updated_by, updated_at)
    VALUES ('path-patch-noop-regression', 'No-op learning path', 'Description', 'draft', 0, 'admin-1', 'learner-active', '2000-01-01 00:00:00')`).run();
  database.prepare(`INSERT INTO learning_path_courses (id, path_id, course_id, position, requires_previous)
    VALUES ('path-patch-noop-course', 'path-patch-noop-regression', 'course-empty', 0, 0)`).run();
  const request = async (body) => fetch(apiUrl('/manage/learning-paths/path-patch-noop-regression'), {
    method: 'PATCH',
    headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const savedPath = () => database.prepare('SELECT title, description, self_enrollment, status, updated_by, updated_at FROM learning_paths WHERE id = ?')
    .get('path-patch-noop-regression');
  const auditCount = () => database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'path.updated' AND entity_id = ?")
    .get('path-patch-noop-regression').count;

  try {
    const initial = savedPath();
    const invalidArray = await request([]);
    assert.equal(invalidArray.status, 400);
    assert.equal((await invalidArray.json()).code, 'validation_error');
    assert.deepEqual(savedPath(), initial);
    assert.equal(auditCount(), 0);

    const emptyPatch = await request({});
    assert.equal(emptyPatch.status, 200);
    assert.equal((await emptyPatch.json()).path.id, 'path-patch-noop-regression');
    const identicalPatch = await request({
      title: 'No-op learning path', description: 'Description', status: 'draft', selfEnrollment: false,
      courses: [{ courseId: 'course-empty', requiresPrevious: false }],
    });
    assert.equal(identicalPatch.status, 200);
    assert.deepEqual(savedPath(), initial);
    assert.equal(database.prepare('SELECT id FROM learning_path_courses WHERE path_id = ?').get('path-patch-noop-regression').id, 'path-patch-noop-course');
    assert.equal(auditCount(), 0);

    const realChange = await request({ description: 'Updated description' });
    assert.equal(realChange.status, 200);
    assert.equal(savedPath().description, 'Updated description');
    assert.notEqual(savedPath().updated_at, initial.updated_at);
    assert.equal(auditCount(), 1);
  } finally {
    database.prepare('DELETE FROM learning_paths WHERE id = ?').run('path-patch-noop-regression');
  }
});

test('learning-path updates roll back when the response cannot be read', async () => {
  const pathId = 'path-update-payload-read';
  const originalDescription = 'Before response failure';
  database.prepare(`INSERT INTO learning_paths (id, title, description, status, self_enrollment, created_by, updated_by)
    VALUES (?, 'Path response read fixture', ?, 'draft', 0, 'admin-1', 'admin-1')`).run(pathId, originalDescription);
  const initialAuditCount = database.prepare('SELECT COUNT(*) AS count FROM audit_logs WHERE action = ? AND entity_id = ?')
    .get('path.updated', pathId).count;
  const originalPrepare = database.prepare;
  let payloadReadFailed = false;

  database.prepare = (sql) => {
    if (sql.replace(/\s+/g, ' ').trim() === 'SELECT pc.id AS path_course_id, pc.path_id, pc.course_id, pc.position, pc.requires_previous, c.* FROM learning_path_courses pc JOIN courses c ON c.id = pc.course_id WHERE pc.path_id IN (?) ORDER BY pc.path_id, pc.position') {
      payloadReadFailed = true;
      throw new Error('Injected learning-path update payload read failure');
    }
    return originalPrepare.call(database, sql);
  };

  try {
    // The course summary read follows the path update and audit write, so its failure must roll both back.
    const response = await fetch(apiUrl(`/manage/learning-paths/${pathId}`), {
      method: 'PATCH',
      headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'Updated despite payload failure' }),
    });

    assert.equal(payloadReadFailed, true);
    assert.equal(response.status, 500);
    assert.equal(database.prepare('SELECT description FROM learning_paths WHERE id = ?').get(pathId).description, originalDescription);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM audit_logs WHERE action = ? AND entity_id = ?')
      .get('path.updated', pathId).count, initialAuditCount);
  } finally {
    database.prepare = originalPrepare;
    database.prepare('DELETE FROM audit_logs WHERE action = ? AND entity_id = ?').run('path.updated', pathId);
    database.prepare('DELETE FROM learning_paths WHERE id = ?').run(pathId);
  }
});

test('archiving a self-enrollment path preserves enrollments after a course becomes private', async () => {
  database.exec(`
    INSERT INTO courses (id, title, visibility, status, created_by, updated_by)
      VALUES ('course-archive-regression', 'Archive regression course', 'public', 'published', 'admin-1', 'admin-1');
    INSERT INTO learning_paths (id, title, status, self_enrollment, created_by, updated_by)
      VALUES ('path-archive-regression', 'Archive regression path', 'published', 1, 'admin-1', 'admin-1');
    INSERT INTO learning_path_courses (id, path_id, course_id, position, requires_previous)
      VALUES ('path-archive-regression-course', 'path-archive-regression', 'course-archive-regression', 0, 0);
    INSERT INTO learning_path_enrollments (id, path_id, user_id, enrollment_source, assigned_by)
      VALUES ('path-archive-regression-enrollment', 'path-archive-regression', 'learner-active', 'self', NULL);
    UPDATE courses SET visibility = 'private' WHERE id = 'course-archive-regression';
  `);

  const response = await fetch(apiUrl('/manage/learning-paths/path-archive-regression'), {
    method: 'PATCH',
    headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'archived' }),
  });

  assert.equal(response.status, 200);
  assert.equal((await response.json()).path.status, 'archived');
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM learning_path_courses WHERE path_id = ?').get('path-archive-regression').count, 1);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM learning_path_enrollments WHERE path_id = ? AND user_id = ?').get('path-archive-regression', 'learner-active').count, 1);
  const audit = database.prepare("SELECT action, entity_id, details_json FROM audit_logs WHERE action = 'path.updated' AND entity_id = ?").get('path-archive-regression');
  assert.equal(audit.action, 'path.updated');
  assert.equal(JSON.parse(audit.details_json).status, 'archived');

  for (const endpoint of ['/learning-paths?status=archived', '/manage/learning-paths?status=archived']) {
    const archivedList = await fetch(apiUrl(endpoint), { headers: userHeaders('admin-1') });
    assert.equal(archivedList.status, 200);
    assert.ok((await archivedList.json()).paths.some((path) => path.id === 'path-archive-regression'));
  }
  const activeList = await fetch(apiUrl('/learning-paths'), { headers: userHeaders('admin-1') });
  assert.equal(activeList.status, 200);
  assert.ok(!(await activeList.json()).paths.some((path) => path.id === 'path-archive-regression'));

  const restore = await fetch(apiUrl('/manage/learning-paths/path-archive-regression'), {
    method: 'PATCH',
    headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'draft', selfEnrollment: false }),
  });
  assert.equal(restore.status, 200);
  assert.equal((await restore.json()).path.status, 'draft');
  assert.equal(database.prepare('SELECT self_enrollment FROM learning_paths WHERE id = ?').get('path-archive-regression').self_enrollment, 0);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM learning_path_enrollments WHERE path_id = ? AND user_id = ?').get('path-archive-regression', 'learner-active').count, 1);
  const restoredList = await fetch(apiUrl('/learning-paths'), { headers: userHeaders('admin-1') });
  assert.equal(restoredList.status, 200);
  assert.ok((await restoredList.json()).paths.some((path) => path.id === 'path-archive-regression'));
});

test('calendar date ranges reject impossible and overwide dates while accepting supported boundaries', async () => {
  const invalidDate = await fetch(apiUrl('/calendar?from=2026-02-31&to=2026-03-01'), {
    headers: userHeaders('learner-active'),
  });
  assert.equal(invalidDate.status, 400);
  assert.equal((await invalidDate.json()).code, 'validation_error');

  const invalidLeapDay = await fetch(apiUrl('/calendar?from=2025-02-29&to=2025-03-01'), {
    headers: userHeaders('learner-active'),
  });
  assert.equal(invalidLeapDay.status, 400);

  const overwideRange = await fetch(apiUrl('/calendar?from=2026-01-01&to=2026-03-04'), {
    headers: userHeaders('learner-active'),
  });
  assert.equal(overwideRange.status, 400);
  assert.deepEqual(await overwideRange.json(), {
    error: 'Calendar date range must be 62 days or fewer.',
    code: 'validation_error',
  });

  const maximumRange = await fetch(apiUrl('/calendar?from=2026-01-01&to=2026-03-03'), {
    headers: userHeaders('learner-active'),
  });
  assert.equal(maximumRange.status, 200);

  const validLeapDay = await fetch(apiUrl('/calendar?from=2024-02-29&to=2024-02-29'), {
    headers: userHeaders('learner-active'),
  });
  assert.equal(validLeapDay.status, 200);
  assert.deepEqual((await validLeapDay.json()).items, []);
});

test('calendar treats SQLite space-separated deadlines as UTC', async () => {
  const previousTimezone = process.env.TZ;
  const courseId = 'calendar-space-timestamp';
  const expectedDeadline = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const storedDeadline = expectedDeadline.slice(0, 19).replace('T', ' ');
  const deadlineDate = storedDeadline.slice(0, 10);
  database.prepare(`INSERT INTO courses (id, title, visibility, status, created_by, updated_by)
    VALUES (?, 'SQLite timestamp deadline', 'public', 'published', 'admin-1', 'admin-1')`).run(courseId);
  database.prepare('INSERT INTO course_learning_state (user_id, course_id, deadline_at) VALUES (?, ?, ?)')
    .run('learner-active', courseId, storedDeadline);

  try {
    process.env.TZ = 'Pacific/Kiritimati';
    const response = await fetch(apiUrl(`/calendar?from=${deadlineDate}&to=${deadlineDate}`), {
      headers: userHeaders('learner-active'),
    });

    assert.equal(response.status, 200);
    const item = (await response.json()).items.find((deadline) => deadline.courseId === courseId);
    assert.ok(item, 'the deadline should be included in its stored UTC date range');
    assert.equal(item.dueAt, `${storedDeadline.replace(' ', 'T')}.000Z`);
    assert.equal(item.status, 'upcoming');
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
    database.prepare('DELETE FROM course_learning_state WHERE user_id = ? AND course_id = ?').run('learner-active', courseId);
    database.prepare('DELETE FROM courses WHERE id = ?').run(courseId);
  }
});

test('calendar deadline results use version-aware course completion and batched summaries', async () => {
  database.prepare(`INSERT INTO course_learning_state (user_id, course_id, deadline_at, started_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, course_id) DO UPDATE SET deadline_at = excluded.deadline_at`)
    .run('learner-active', 'course-analytics', '2099-01-01T00:00:00.000Z');

  async function measureCalendar() {
    const originalPrepare = database.prepare;
    let queryCount = 0;
    database.prepare = (sql) => {
      queryCount += 1;
      return originalPrepare.call(database, sql);
    };
    try {
      const response = await fetch(apiUrl('/calendar?from=2099-01-01&to=2099-01-01'), {
        headers: userHeaders('learner-active'),
      });
      assert.equal(response.status, 200);
      return { queryCount, items: (await response.json()).items };
    } finally {
      delete database.prepare;
    }
  }

  const oneDeadline = await measureCalendar();
  assert.deepEqual(oneDeadline.items.map((item) => [item.courseId, item.status, item.completed]), [
    ['course-analytics', 'completed', true],
  ]);

  database.exec(`
    INSERT INTO courses (id, title, status, created_by, updated_by)
      VALUES ('calendar-incomplete', 'Calendar incomplete course', 'published', 'admin-1', 'admin-1');
    INSERT INTO course_learning_state (user_id, course_id, deadline_at, started_at)
      VALUES ('learner-active', 'calendar-incomplete', '2099-01-01T00:00:00.000Z', CURRENT_TIMESTAMP);
  `);

  const twoDeadlines = await measureCalendar();
  assert.equal(twoDeadlines.queryCount, oneDeadline.queryCount);
  assert.deepEqual(twoDeadlines.items.map((item) => [item.courseId, item.status, item.completed]), [
    ['course-analytics', 'completed', true],
    ['calendar-incomplete', 'upcoming', false],
  ]);
});

test('calendar items use course ID as a stable tie-breaker for duplicate titles and deadlines', async () => {
  database.prepare(`INSERT INTO courses (id, title, status, created_by, updated_by)
    VALUES (?, 'Calendar tie-breaker course', 'published', 'admin-1', 'admin-1')`)
    .run('calendar-tie-z');
  database.prepare(`INSERT INTO courses (id, title, status, created_by, updated_by)
    VALUES (?, 'Calendar tie-breaker course', 'published', 'admin-1', 'admin-1')`)
    .run('calendar-tie-a');
  const insertDeadline = database.prepare(`INSERT INTO course_learning_state (user_id, course_id, deadline_at)
    VALUES ('learner-active', ?, '2099-01-05T00:00:00.000Z')`);
  insertDeadline.run('calendar-tie-z');
  insertDeadline.run('calendar-tie-a');

  const response = await fetch(apiUrl('/calendar?from=2099-01-05&to=2099-01-05'), {
    headers: userHeaders('learner-active'),
  });

  assert.equal(response.status, 200);
  const items = (await response.json()).items;
  assert.deepEqual(items.map((item) => item.courseId), ['calendar-tie-a', 'calendar-tie-z']);
});

test('calendar deadline date bounds include the final day and use the deadline index', async () => {
  const learnerId = 'learner-calendar-index';
  database.prepare(`INSERT INTO users (id, username, email, password_hash, role, disabled)
    VALUES (?, 'calendar_index', 'calendar-index@example.invalid', 'not-used', 'learner', 0)`).run(learnerId);
  const insertCourse = database.prepare(`INSERT INTO courses (id, title, status, visibility, created_by, updated_by)
    VALUES (?, ?, 'published', 'public', 'admin-1', 'admin-1')`);
  const insertDeadline = database.prepare('INSERT INTO course_learning_state (user_id, course_id, deadline_at) VALUES (?, ?, ?)');
  insertCourse.run('calendar-index-before', 'Before range');
  insertCourse.run('calendar-index-final', 'On final day');
  insertCourse.run('calendar-index-after', 'After range');
  insertDeadline.run(learnerId, 'calendar-index-before', '2098-12-31T23:59:59.999Z');
  insertDeadline.run(learnerId, 'calendar-index-final', '2099-01-01 23:59:59');
  insertDeadline.run(learnerId, 'calendar-index-after', '2099-01-02T00:00:00.000Z');

  let calendarQuery = '';
  const originalPrepare = database.prepare;
  database.prepare = (sql) => {
    if (sql.includes('FROM course_learning_state s')) calendarQuery = sql;
    return originalPrepare.call(database, sql);
  };
  let response;
  try {
    response = await fetch(apiUrl('/calendar?from=2099-01-01&to=2099-01-01'), {
      headers: userHeaders(learnerId),
    });
  } finally {
    delete database.prepare;
  }

  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).items.map((item) => item.courseId), ['calendar-index-final']);
  assert.ok(calendarQuery.includes('s.deadline_at >= ? AND s.deadline_at < ?'));
  const plan = originalPrepare.call(database, `EXPLAIN QUERY PLAN ${calendarQuery}`)
    .all(learnerId, '2099-01-01', '2099-01-01Z');
  assert.ok(plan.some((entry) => entry.detail.includes('course_learning_deadline')), JSON.stringify(plan));
});

test('calendar hides private course deadlines after access is revoked', async () => {
  database.prepare(`INSERT INTO users (id, username, email, password_hash, role, disabled)
    VALUES ('learner-calendar', 'calendar_learner', 'calendar@example.invalid', 'not-used', 'learner', 0)`).run();
  database.exec(`
    INSERT INTO courses (id, title, visibility, status, created_by, updated_by)
      VALUES ('calendar-private', 'Private calendar course', 'private', 'published', 'admin-1', 'admin-1');
    INSERT INTO course_learning_state (user_id, course_id, deadline_at, started_at)
      VALUES ('learner-calendar', 'calendar-private', '2099-01-01T00:00:00.000Z', CURRENT_TIMESTAMP);
  `);

  async function calendarItems() {
    const originalPrepare = database.prepare;
    let logicalCoursePreparations = 0;
    let canonicalCoursePreparations = 0;
    database.prepare = (sql) => {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized === 'SELECT id, logical_course_id FROM courses WHERE id = ?') logicalCoursePreparations += 1;
      if (normalized === 'SELECT * FROM courses WHERE id = ? AND logical_course_id IS NULL') canonicalCoursePreparations += 1;
      return originalPrepare.call(database, sql);
    };

    try {
      const response = await fetch(apiUrl('/calendar?from=2099-01-01&to=2099-01-01'), {
        headers: userHeaders('learner-calendar'),
      });
      assert.equal(response.status, 200);
      assert.equal(logicalCoursePreparations, 0);
      assert.equal(canonicalCoursePreparations, 0);
      return (await response.json()).items;
    } finally {
      database.prepare = originalPrepare;
    }
  }

  assert.deepEqual(await calendarItems(), []);
  database.prepare(`INSERT INTO course_grants (id, course_id, user_id, granted_by, granted_at)
    VALUES ('calendar-private-grant', 'calendar-private', 'learner-calendar', 'admin-1', CURRENT_TIMESTAMP)`).run();
  assert.deepEqual((await calendarItems()).map((item) => item.courseId), ['calendar-private']);

  database.prepare('DELETE FROM course_grants WHERE id = ?').run('calendar-private-grant');
  assert.deepEqual(await calendarItems(), []);
});

test('calendar path access caches completion checks shared by private deadlines', async () => {
  const learnerId = 'learner-calendar-path-cache';
  const courseIds = ['calendar-path-prerequisite', 'calendar-path-target-one', 'calendar-path-target-two'];
  database.prepare(`INSERT INTO users (id, username, email, password_hash, role, disabled)
    VALUES (?, 'calendar_path_cache', 'calendar-path-cache@example.invalid', 'not-used', 'learner', 0)`).run(learnerId);

  const insertCourse = database.prepare(`INSERT INTO courses (id, title, visibility, status, created_by, updated_by)
    VALUES (?, ?, ?, 'published', 'admin-1', 'admin-1')`);
  const insertModule = database.prepare('INSERT INTO course_modules (id, course_id, title, position) VALUES (?, ?, ?, 0)');
  const insertLesson = database.prepare('INSERT INTO lessons (id, module_id, title, position) VALUES (?, ?, ?, 0)');
  const insertProgress = database.prepare('INSERT INTO lesson_progress (user_id, lesson_id, completed_at) VALUES (?, ?, CURRENT_TIMESTAMP)');
  courseIds.forEach((courseId, index) => {
    insertCourse.run(courseId, `Calendar path course ${index}`, index === 0 ? 'public' : 'private');
    const moduleId = `${courseId}-module`;
    const lessonId = `${courseId}-lesson`;
    insertModule.run(moduleId, courseId, `Module ${index}`);
    insertLesson.run(lessonId, moduleId, `Lesson ${index}`);
    insertProgress.run(learnerId, lessonId);
  });

  database.exec(`
    INSERT INTO learning_paths (id, title, status, self_enrollment, created_by, updated_by)
      VALUES ('calendar-path-cache', 'Calendar path cache', 'published', 0, 'admin-1', 'admin-1');
    INSERT INTO learning_path_courses (id, path_id, course_id, position, requires_previous) VALUES
      ('calendar-path-cache-step-one', 'calendar-path-cache', 'calendar-path-prerequisite', 0, 0),
      ('calendar-path-cache-step-two', 'calendar-path-cache', 'calendar-path-target-one', 1, 1),
      ('calendar-path-cache-step-three', 'calendar-path-cache', 'calendar-path-target-two', 2, 1);
    INSERT INTO learning_path_enrollments (id, path_id, user_id, enrollment_source, assigned_by)
      VALUES ('calendar-path-cache-enrollment', 'calendar-path-cache', 'learner-calendar-path-cache', 'assigned', 'admin-1');
    INSERT INTO course_learning_state (user_id, course_id, deadline_at, started_at) VALUES
      ('learner-calendar-path-cache', 'calendar-path-target-one', '2099-01-01T00:00:00.000Z', CURRENT_TIMESTAMP),
      ('learner-calendar-path-cache', 'calendar-path-target-two', '2099-01-01T00:00:00.000Z', CURRENT_TIMESTAMP);
  `);

  const originalPrepare = database.prepare;
  let prerequisiteHistoryReads = 0;
  database.prepare = (sql) => {
    if (sql.includes('FROM lesson_progress p') && sql.includes('c.id = ? OR c.logical_course_id = ?')) {
      const statement = originalPrepare.call(database, sql);
      return new Proxy(statement, {
        get(target, property) {
          if (property === 'all') return (...parameters) => {
            prerequisiteHistoryReads += 1;
            return target.all(...parameters);
          };
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    }
    return originalPrepare.call(database, sql);
  };
  let response;
  try {
    response = await fetch(apiUrl('/calendar?from=2099-01-01&to=2099-01-01'), {
      headers: userHeaders(learnerId),
    });
  } finally {
    delete database.prepare;
  }

  try {
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).items.map((item) => item.courseId), courseIds.slice(1));
    assert.equal(prerequisiteHistoryReads, 2,
      `Expected shared path completion history to be read once per prerequisite course, got ${prerequisiteHistoryReads} reads.`);
  } finally {
    database.prepare('DELETE FROM learning_paths WHERE id = ?').run('calendar-path-cache');
    database.prepare('DELETE FROM courses WHERE id IN (?, ?, ?)').run(...courseIds);
    database.prepare('DELETE FROM users WHERE id = ?').run(learnerId);
  }
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

test('private course grants and revocations roll back when audit persistence fails', async () => {
  const courseId = 'course-access-audit';
  const learnerId = 'learner-unassigned';
  database.prepare('INSERT INTO courses (id, title, visibility, status, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(courseId, 'Access audit course', 'private', 'published', 'admin-1', 'admin-1');
  const grantAuditCount = database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.access_granted' AND entity_id = ?").get(courseId).count;
  const revokeAuditCount = database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.access_revoked' AND entity_id = ?").get(courseId).count;

  database.exec(`CREATE TRIGGER reject_access_granted_audit BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'course.access_granted' BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END`);
  try {
    const failedGrant = await fetch(apiUrl(`/manage/courses/${courseId}/access/${learnerId}`), {
      method: 'PUT',
      headers: userHeaders('admin-1'),
    });
    assert.equal(failedGrant.status, 500);
    assert.equal((await failedGrant.json()).code, 'audit_unavailable');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM course_grants WHERE course_id = ? AND user_id = ?').get(courseId, learnerId).count, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM enrollments WHERE course_id = ? AND user_id = ?').get(courseId, learnerId).count, 0);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.access_granted' AND entity_id = ?").get(courseId).count, grantAuditCount);
  } finally {
    database.exec('DROP TRIGGER IF EXISTS reject_access_granted_audit');
  }

  const retryGrant = await fetch(apiUrl(`/manage/courses/${courseId}/access/${learnerId}`), {
    method: 'PUT',
    headers: userHeaders('admin-1'),
  });
  assert.equal(retryGrant.status, 204);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM course_grants WHERE course_id = ? AND user_id = ?').get(courseId, learnerId).count, 1);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM enrollments WHERE course_id = ? AND user_id = ?').get(courseId, learnerId).count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.access_granted' AND entity_id = ?").get(courseId).count, grantAuditCount + 1);

  const duplicateGrant = await fetch(apiUrl(`/manage/courses/${courseId}/access/${learnerId}`), {
    method: 'PUT',
    headers: userHeaders('admin-1'),
  });
  assert.equal(duplicateGrant.status, 204);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.access_granted' AND entity_id = ?").get(courseId).count, grantAuditCount + 1);

  database.exec(`CREATE TRIGGER reject_access_revoked_audit BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'course.access_revoked' BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END`);
  try {
    const failedRevoke = await fetch(apiUrl(`/manage/courses/${courseId}/access/${learnerId}`), {
      method: 'DELETE',
      headers: userHeaders('admin-1'),
    });
    assert.equal(failedRevoke.status, 500);
    assert.equal((await failedRevoke.json()).code, 'audit_unavailable');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM course_grants WHERE course_id = ? AND user_id = ?').get(courseId, learnerId).count, 1);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM enrollments WHERE course_id = ? AND user_id = ?').get(courseId, learnerId).count, 1);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.access_revoked' AND entity_id = ?").get(courseId).count, revokeAuditCount);
  } finally {
    database.exec('DROP TRIGGER IF EXISTS reject_access_revoked_audit');
  }

  const retryRevoke = await fetch(apiUrl(`/manage/courses/${courseId}/access/${learnerId}`), {
    method: 'DELETE',
    headers: userHeaders('admin-1'),
  });
  assert.equal(retryRevoke.status, 204);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM course_grants WHERE course_id = ? AND user_id = ?').get(courseId, learnerId).count, 0);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM enrollments WHERE course_id = ? AND user_id = ?').get(courseId, learnerId).count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.access_revoked' AND entity_id = ?").get(courseId).count, revokeAuditCount + 1);
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

test('module renames roll back when their audit entry cannot be saved and skip audit for unchanged titles', async () => {
  const originalModule = database.prepare("SELECT title FROM course_modules WHERE id = 'module-analytics'").get();
  const originalCourseTimestamp = database.prepare("SELECT updated_at FROM courses WHERE id = 'course-analytics'").get().updated_at;
  const initialAuditCount = database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.module_updated' AND entity_id = 'module-analytics'").get().count;
  database.exec(`CREATE TRIGGER reject_module_updated_audit BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'course.module_updated' BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END`);

  try {
    const failedResponse = await fetch(apiUrl('/manage/modules/module-analytics'), {
      method: 'PATCH',
      headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Unaudited module rename' }),
    });
    assert.equal(failedResponse.status, 500);
    assert.equal((await failedResponse.json()).code, 'audit_unavailable');
    assert.deepEqual(database.prepare("SELECT title FROM course_modules WHERE id = 'module-analytics'").get(), originalModule);
    assert.equal(database.prepare("SELECT updated_at FROM courses WHERE id = 'course-analytics'").get().updated_at, originalCourseTimestamp);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.module_updated' AND entity_id = 'module-analytics'").get().count, initialAuditCount);
  } finally {
    database.exec('DROP TRIGGER IF EXISTS reject_module_updated_audit');
  }

  const retryResponse = await fetch(apiUrl('/manage/modules/module-analytics'), {
    method: 'PATCH',
    headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Audited module rename' }),
  });
  assert.equal(retryResponse.status, 200);
  assert.equal(database.prepare("SELECT title FROM course_modules WHERE id = 'module-analytics'").get().title, 'Audited module rename');
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.module_updated' AND entity_id = 'module-analytics'").get().count, initialAuditCount + 1);

  const unchangedResponse = await fetch(apiUrl('/manage/modules/module-analytics'), {
    method: 'PATCH',
    headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Audited module rename' }),
  });
  assert.equal(unchangedResponse.status, 200);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.module_updated' AND entity_id = 'module-analytics'").get().count, initialAuditCount + 1);
});

test('module reordering rolls back when its audit entry cannot be saved and skips audit at the boundary', async () => {
  const moduleId = 'module-reorder-neighbor';
  const courseId = 'course-analytics';
  const originalCourse = database.prepare('SELECT updated_at, updated_by FROM courses WHERE id = ?').get(courseId);
  database.prepare('INSERT INTO course_modules (id, course_id, title, position) VALUES (?, ?, ?, ?)')
    .run(moduleId, courseId, 'Adjacent module', 1);
  const originalPositions = database.prepare('SELECT id, position FROM course_modules WHERE course_id = ? ORDER BY position, id').all(courseId);
  const initialAuditCount = database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.module_reordered' AND entity_id = ?").get(courseId).count;

  try {
    database.exec(`CREATE TRIGGER reject_module_reordered_audit BEFORE INSERT ON audit_logs
      WHEN NEW.action = 'course.module_reordered' BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END`);
    try {
      const failedResponse = await fetch(apiUrl(`/manage/modules/${moduleId}/move`), {
        method: 'POST',
        headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
        body: JSON.stringify({ direction: 'up' }),
      });
      assert.equal(failedResponse.status, 500);
      assert.equal((await failedResponse.json()).code, 'audit_unavailable');
      assert.deepEqual(database.prepare('SELECT id, position FROM course_modules WHERE course_id = ? ORDER BY position, id').all(courseId), originalPositions);
      assert.deepEqual(database.prepare('SELECT updated_at, updated_by FROM courses WHERE id = ?').get(courseId), originalCourse);
      assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.module_reordered' AND entity_id = ?").get(courseId).count, initialAuditCount);
    } finally {
      database.exec('DROP TRIGGER IF EXISTS reject_module_reordered_audit');
    }

    const retryResponse = await fetch(apiUrl(`/manage/modules/${moduleId}/move`), {
      method: 'POST',
      headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
      body: JSON.stringify({ direction: 'up' }),
    });
    assert.equal(retryResponse.status, 200);
    assert.deepEqual(database.prepare('SELECT id, position FROM course_modules WHERE course_id = ? ORDER BY position, id').all(courseId), [
      { id: moduleId, position: 0 },
      { id: 'module-analytics', position: 1 },
    ]);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.module_reordered' AND entity_id = ?").get(courseId).count, initialAuditCount + 1);

    const boundaryResponse = await fetch(apiUrl(`/manage/modules/${moduleId}/move`), {
      method: 'POST',
      headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
      body: JSON.stringify({ direction: 'up' }),
    });
    assert.equal(boundaryResponse.status, 200);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.module_reordered' AND entity_id = ?").get(courseId).count, initialAuditCount + 1);
  } finally {
    database.prepare('DELETE FROM course_modules WHERE id = ?').run(moduleId);
    database.prepare('UPDATE course_modules SET position = 0 WHERE id = ?').run('module-analytics');
    database.prepare('UPDATE courses SET updated_at = ?, updated_by = ? WHERE id = ?')
      .run(originalCourse.updated_at, originalCourse.updated_by, courseId);
  }
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

test('lesson reordering rolls back when its audit entry cannot be saved and skips audit at the boundary', async () => {
  const lessonId = 'lesson-reorder-neighbor';
  const firstLessonId = 'lesson-reorder-first';
  const moduleId = 'module-lesson-reorder';
  const courseId = 'course-analytics';
  const originalCourse = database.prepare('SELECT updated_at, updated_by FROM courses WHERE id = ?').get(courseId);
  const modulePosition = database.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM course_modules WHERE course_id = ?').get(courseId).next;
  database.prepare('INSERT INTO course_modules (id, course_id, title, position) VALUES (?, ?, ?, ?)')
    .run(moduleId, courseId, 'Ordering fixture', modulePosition);
  database.prepare('INSERT INTO lessons (id, module_id, title, position) VALUES (?, ?, ?, ?)')
    .run(firstLessonId, moduleId, 'First lesson', 0);
  database.prepare('INSERT INTO lessons (id, module_id, title, position) VALUES (?, ?, ?, ?)')
    .run(lessonId, moduleId, 'Adjacent lesson', 1);
  const originalPositions = database.prepare('SELECT id, position FROM lessons WHERE module_id = ? ORDER BY position, id').all(moduleId);
  const initialAuditCount = database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.lesson_reordered' AND entity_id = ?").get(lessonId).count;

  try {
    database.exec(`CREATE TRIGGER reject_lesson_reordered_audit BEFORE INSERT ON audit_logs
      WHEN NEW.action = 'course.lesson_reordered' BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END`);
    try {
      const failedResponse = await fetch(apiUrl(`/manage/lessons/${lessonId}/move`), {
        method: 'POST',
        headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
        body: JSON.stringify({ direction: 'up' }),
      });
      assert.equal(failedResponse.status, 500);
      assert.equal((await failedResponse.json()).code, 'audit_unavailable');
      assert.deepEqual(database.prepare('SELECT id, position FROM lessons WHERE module_id = ? ORDER BY position, id').all(moduleId), originalPositions);
      assert.deepEqual(database.prepare('SELECT updated_at, updated_by FROM courses WHERE id = ?').get(courseId), originalCourse);
      assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.lesson_reordered' AND entity_id = ?").get(lessonId).count, initialAuditCount);
    } finally {
      database.exec('DROP TRIGGER IF EXISTS reject_lesson_reordered_audit');
    }

    const retryResponse = await fetch(apiUrl(`/manage/lessons/${lessonId}/move`), {
      method: 'POST',
      headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
      body: JSON.stringify({ direction: 'up' }),
    });
    assert.equal(retryResponse.status, 200);
    assert.deepEqual(database.prepare('SELECT id, position FROM lessons WHERE module_id = ? ORDER BY position, id').all(moduleId), [
      { id: lessonId, position: 0 },
      { id: firstLessonId, position: 1 },
    ]);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.lesson_reordered' AND entity_id = ?").get(lessonId).count, initialAuditCount + 1);

    const boundaryResponse = await fetch(apiUrl(`/manage/lessons/${lessonId}/move`), {
      method: 'POST',
      headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
      body: JSON.stringify({ direction: 'up' }),
    });
    assert.equal(boundaryResponse.status, 200);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.lesson_reordered' AND entity_id = ?").get(lessonId).count, initialAuditCount + 1);
  } finally {
    database.prepare('DELETE FROM lessons WHERE module_id = ?').run(moduleId);
    database.prepare('DELETE FROM course_modules WHERE id = ?').run(moduleId);
    database.prepare('UPDATE courses SET updated_at = ?, updated_by = ? WHERE id = ?')
      .run(originalCourse.updated_at, originalCourse.updated_by, courseId);
  }
});

test('quiz-save validation rejects malformed questions without replacing saved quiz content', async () => {
  const courseId = 'course-quiz-validation';
  const moduleId = 'module-quiz-validation';
  const quizId = 'quiz-validation';
  const questionId = 'question-validation';
  const insertFixture = database.transaction(() => {
    database.prepare(`INSERT INTO courses (id, title, status, created_by, updated_by)
      VALUES (?, 'Quiz validation fixture', 'draft', 'admin-1', 'admin-1')`).run(courseId);
    database.prepare('INSERT INTO course_modules (id, course_id, title, position) VALUES (?, ?, ?, 0)')
      .run(moduleId, courseId, 'Validation module');
    database.prepare('INSERT INTO quizzes (id, module_id, title, pass_mark) VALUES (?, ?, ?, 70)')
      .run(quizId, moduleId, 'Saved quiz');
    database.prepare(`INSERT INTO quiz_questions (id, quiz_id, prompt, explanation, position)
      VALUES (?, ?, 'Saved question', 'Saved explanation', 0)`).run(questionId, quizId);
    database.prepare(`INSERT INTO quiz_choices (id, question_id, choice_text, is_correct, position)
      VALUES ('choice-validation-correct', ?, 'Correct', 1, 0), ('choice-validation-wrong', ?, 'Wrong', 0, 1)`)
      .run(questionId, questionId);
  });
  insertFixture();

  const validQuestion = {
    prompt: 'A valid question?',
    explanation: 'A valid explanation.',
    choices: [{ text: 'Correct', isCorrect: true }, { text: 'Wrong', isCorrect: false }],
  };
  const basePayload = { title: 'Replacement quiz', passMark: 80, questions: [validQuestion] };
  const invalidPayloads = [
    ['missing question list', { ...basePayload, questions: undefined }],
    ['non-array question list', { ...basePayload, questions: null }],
    ['non-object question', { ...basePayload, questions: [null] }],
    ['missing choice list', { ...basePayload, questions: [{ prompt: 'Question', choices: null }] }],
    ['too few choices', { ...basePayload, questions: [{ ...validQuestion, choices: [validQuestion.choices[0]] }] }],
    ['too many choices', { ...basePayload, questions: [{ ...validQuestion, choices: Array.from({ length: 7 }, (_, index) => ({ text: `Choice ${index + 1}`, isCorrect: index === 0 })) }] }],
    ['no correct answer', { ...basePayload, questions: [{ ...validQuestion, choices: validQuestion.choices.map((choice) => ({ ...choice, isCorrect: false })) }] }],
    ['multiple correct answers', { ...basePayload, questions: [{ ...validQuestion, choices: validQuestion.choices.map((choice) => ({ ...choice, isCorrect: true })) }] }],
    ['non-boolean correctness flag', { ...basePayload, questions: [{ ...validQuestion, choices: [{ text: 'Correct', isCorrect: 'true' }, validQuestion.choices[1]] }] }],
    ['blank question text', { ...basePayload, questions: [{ ...validQuestion, prompt: '   ' }] }],
    ['blank answer text', { ...basePayload, questions: [{ ...validQuestion, choices: [{ text: '  ', isCorrect: true }, validQuestion.choices[1]] }] }],
    ['oversized question text', { ...basePayload, questions: [{ ...validQuestion, prompt: 'x'.repeat(1001) }] }],
    ['fractional pass mark', { ...basePayload, passMark: 70.5 }],
    ['out-of-range pass mark', { ...basePayload, passMark: 101 }],
  ];
  const originalQuiz = database.prepare('SELECT id, title, pass_mark FROM quizzes WHERE id = ?').get(quizId);
  const originalQuestions = database.prepare('SELECT id, quiz_id, prompt, explanation, position FROM quiz_questions WHERE quiz_id = ? ORDER BY position, id').all(quizId);
  const originalChoices = database.prepare(`SELECT c.id, c.question_id, c.choice_text, c.is_correct, c.position
    FROM quiz_choices c JOIN quiz_questions q ON q.id = c.question_id
    WHERE q.quiz_id = ? ORDER BY q.position, c.position, c.id`).all(quizId);

  try {
    for (const [label, payload] of invalidPayloads) {
      const response = await fetch(apiUrl(`/manage/modules/${moduleId}/quiz`), {
        method: 'PUT',
        headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      assert.equal(response.status, 400, `${label} should be rejected`);
      assert.equal((await response.json()).code, 'validation_error', `${label} should use the validation error contract`);
      assert.deepEqual(database.prepare('SELECT id, title, pass_mark FROM quizzes WHERE id = ?').get(quizId), originalQuiz, `${label} must preserve the quiz`);
      assert.deepEqual(database.prepare('SELECT id, quiz_id, prompt, explanation, position FROM quiz_questions WHERE quiz_id = ? ORDER BY position, id').all(quizId), originalQuestions, `${label} must preserve questions`);
      assert.deepEqual(database.prepare(`SELECT c.id, c.question_id, c.choice_text, c.is_correct, c.position
        FROM quiz_choices c JOIN quiz_questions q ON q.id = c.question_id
        WHERE q.quiz_id = ? ORDER BY q.position, c.position, c.id`).all(quizId), originalChoices, `${label} must preserve choices`);
    }
  } finally {
    database.prepare('DELETE FROM courses WHERE id = ?').run(courseId);
  }
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

test('quiz saves roll back when the course editor response cannot be read', async () => {
  const courseId = 'course-quiz-payload-read';
  const moduleId = 'module-quiz-payload-read';
  const auditSummary = 'Saved quiz for Payload transaction quiz module';
  database.prepare(`INSERT INTO courses (id, title, status, created_by, updated_by)
    VALUES (?, 'Quiz payload response fixture', 'draft', 'admin-1', 'admin-1')`).run(courseId);
  database.prepare(`INSERT INTO course_modules (id, course_id, title, position)
    VALUES (?, ?, 'Payload transaction quiz module', 0)`).run(moduleId, courseId);
  const initialAuditCount = database.prepare('SELECT COUNT(*) AS count FROM audit_logs WHERE action = ? AND summary = ?')
    .get('course.quiz_saved', auditSummary).count;
  const originalPrepare = database.prepare;
  let payloadReadFailed = false;

  database.prepare = (sql) => {
    if (sql.replace(/\s+/g, ' ').trim() === 'SELECT * FROM course_modules WHERE course_id = ? ORDER BY position, id') {
      payloadReadFailed = true;
      throw new Error('Injected quiz response payload read failure');
    }
    return originalPrepare.call(database, sql);
  };

  try {
    // The module read follows quiz replacement and audit logging; its failure must undo both.
    const response = await fetch(apiUrl(`/manage/modules/${moduleId}/quiz`), {
      method: 'PUT',
      headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Quiz saved before payload failure',
        passMark: 75,
        questions: [{
          prompt: 'Which choice is correct?',
          explanation: 'The first choice is correct.',
          choices: [{ text: 'First', isCorrect: true }, { text: 'Second', isCorrect: false }],
        }],
      }),
    });

    assert.equal(payloadReadFailed, true);
    assert.equal(response.status, 500);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM quizzes WHERE module_id = ?').get(moduleId).count, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM audit_logs WHERE action = ? AND summary = ?')
      .get('course.quiz_saved', auditSummary).count, initialAuditCount);
  } finally {
    database.prepare = originalPrepare;
    database.prepare('DELETE FROM audit_logs WHERE action = ? AND summary = ?').run('course.quiz_saved', auditSummary);
    database.prepare('DELETE FROM courses WHERE id = ?').run(courseId);
  }
});

test('unchanged quiz saves still return the editor course from their transaction', async () => {
  const courseId = 'course-quiz-unchanged-payload';
  const moduleId = 'module-quiz-unchanged-payload';
  const quizId = 'quiz-unchanged-payload';
  const questionId = 'question-unchanged-payload';
  const auditSummary = 'Saved quiz for Unchanged payload quiz module';
  database.exec(`
    INSERT INTO courses (id, title, status, created_by, updated_by)
      VALUES ('${courseId}', 'Unchanged quiz payload fixture', 'draft', 'admin-1', 'admin-1');
    INSERT INTO course_modules (id, course_id, title, position)
      VALUES ('${moduleId}', '${courseId}', 'Unchanged payload quiz module', 0);
    INSERT INTO quizzes (id, module_id, title, pass_mark)
      VALUES ('${quizId}', '${moduleId}', 'Stable quiz', 70);
    INSERT INTO quiz_questions (id, quiz_id, prompt, explanation, position)
      VALUES ('${questionId}', '${quizId}', 'Which answer is correct?', 'The first answer is correct.', 0);
    INSERT INTO quiz_choices (id, question_id, choice_text, is_correct, position) VALUES
      ('choice-unchanged-correct', '${questionId}', 'First', 1, 0),
      ('choice-unchanged-wrong', '${questionId}', 'Second', 0, 1);
  `);
  const initialAuditCount = database.prepare('SELECT COUNT(*) AS count FROM audit_logs WHERE action = ? AND summary = ?')
    .get('course.quiz_saved', auditSummary).count;

  try {
    const response = await fetch(apiUrl(`/manage/modules/${moduleId}/quiz`), {
      method: 'PUT',
      headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Stable quiz',
        passMark: 70,
        questions: [{
          prompt: 'Which answer is correct?',
          explanation: 'The first answer is correct.',
          choices: [{ text: 'First', isCorrect: true }, { text: 'Second', isCorrect: false }],
        }],
      }),
    });

    assert.equal(response.status, 200);
    assert.equal((await response.json()).course.id, courseId);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM audit_logs WHERE action = ? AND summary = ?')
      .get('course.quiz_saved', auditSummary).count, initialAuditCount);
  } finally {
    database.prepare('DELETE FROM audit_logs WHERE action = ? AND summary = ?').run('course.quiz_saved', auditSummary);
    database.prepare('DELETE FROM courses WHERE id = ?').run(courseId);
  }
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

test('course creation rolls back when the editor response cannot be read', async () => {
  const title = 'Course response read transaction rollback';
  const summary = `Created course: ${title}`;
  const originalPrepare = database.prepare;
  let payloadReadFailed = false;

  database.prepare = (sql) => {
    if (sql.replace(/\s+/g, ' ').trim() === 'SELECT * FROM course_modules WHERE course_id = ? ORDER BY position, id') {
      payloadReadFailed = true;
      throw new Error('Injected course creation payload read failure');
    }
    return originalPrepare.call(database, sql);
  };

  try {
    // Fail in payload assembly after the insert and audit write to verify both roll back.
    const response = await fetch(apiUrl('/manage/courses'), {
      method: 'POST',
      headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
      body: JSON.stringify({ title }),
    });

    assert.equal(payloadReadFailed, true);
    assert.equal(response.status, 500);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM courses WHERE title = ?').get(title).count, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM audit_logs WHERE action = ? AND summary = ?').get('course.created', summary).count, 0);
  } finally {
    database.prepare = originalPrepare;
    database.prepare('DELETE FROM audit_logs WHERE action = ? AND summary = ?').run('course.created', summary);
    database.prepare('DELETE FROM courses WHERE title = ?').run(title);
  }
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

test('course updates roll back when the saved editor response cannot be read', async () => {
  const courseId = 'course-update-payload-read';
  const originalTitle = 'Draft before response failure';
  database.prepare(`INSERT INTO courses (id, title, status, created_by, updated_by)
    VALUES (?, ?, 'draft', 'admin-1', 'admin-1')`).run(courseId, originalTitle);
  const initialAuditCount = database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.updated' AND entity_id = ?").get(courseId).count;
  const originalPrepare = database.prepare;
  let payloadReadFailed = false;

  database.prepare = (sql) => {
    if (sql.replace(/\s+/g, ' ').trim() === 'SELECT * FROM course_modules WHERE course_id = ? ORDER BY position, id') {
      payloadReadFailed = true;
      throw new Error('Injected course payload read failure');
    }
    return originalPrepare.call(database, sql);
  };

  try {
    // This read happens after the update and audit insert, so its failure must roll them back together.
    const response = await fetch(apiUrl(`/manage/courses/${courseId}`), {
      method: 'PATCH',
      headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Updated despite payload failure' }),
    });

    assert.equal(payloadReadFailed, true);
    assert.equal(response.status, 500);
    assert.equal(database.prepare('SELECT title FROM courses WHERE id = ?').get(courseId).title, originalTitle);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.updated' AND entity_id = ?").get(courseId).count, initialAuditCount);
  } finally {
    database.prepare = originalPrepare;
    database.prepare('DELETE FROM audit_logs WHERE entity_id = ?').run(courseId);
    database.prepare('DELETE FROM courses WHERE id = ?').run(courseId);
  }
});

test('course publication rolls back when the published editor response cannot be read', async () => {
  const courseId = 'course-publish-payload-read';
  const originalTitle = 'Draft before publication response failure';
  database.prepare(`INSERT INTO courses (id, title, status, created_by, updated_by)
    VALUES (?, ?, 'draft', 'admin-1', 'admin-1')`).run(courseId, originalTitle);
  database.prepare(`INSERT INTO course_modules (id, course_id, title, position)
    VALUES ('module-publish-payload-read', ?, 'Module', 0)`).run(courseId);
  database.prepare(`INSERT INTO media_files (id, course_id, original_name, file_name, mime_type, byte_size, media_kind)
    VALUES ('media-publish-payload-read', ?, 'lesson.mp4', 'lesson.mp4', 'video/mp4', 1, 'video')`).run(courseId);
  database.prepare(`INSERT INTO lessons (id, module_id, title, media_id, position)
    VALUES ('lesson-publish-payload-read', 'module-publish-payload-read', 'Lesson', 'media-publish-payload-read', 0)`).run();
  const initialAuditCount = database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.published' AND entity_id = ?").get(courseId).count;
  const originalPrepare = database.prepare;
  let payloadReadFailed = false;

  database.prepare = (sql) => {
    if (sql.replace(/\s+/g, ' ').trim() === 'SELECT l.*, mf.original_name, mf.mime_type FROM lessons l JOIN course_modules m ON m.id = l.module_id LEFT JOIN media_files mf ON mf.id = l.media_id WHERE m.course_id = ? ORDER BY m.position, m.id, l.position, l.id') {
      payloadReadFailed = true;
      throw new Error('Injected published course payload read failure');
    }
    return originalPrepare.call(database, sql);
  };

  try {
    // Fail after version creation and audit logging to verify the publication transaction rolls back.
    const response = await fetch(apiUrl(`/manage/courses/${courseId}`), {
      method: 'PATCH',
      headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Published despite payload failure', status: 'published' }),
    });

    assert.equal(payloadReadFailed, true);
    assert.equal(response.status, 500);
    assert.deepEqual(database.prepare('SELECT title, status FROM courses WHERE id = ?').get(courseId), { title: originalTitle, status: 'draft' });
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM course_versions WHERE course_id = ?').get(courseId).count, 0);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.published' AND entity_id = ?").get(courseId).count, initialAuditCount);
  } finally {
    database.prepare = originalPrepare;
    database.prepare('DELETE FROM audit_logs WHERE entity_id = ?').run(courseId);
    database.prepare('DELETE FROM courses WHERE id = ?').run(courseId);
  }
});

test('course management keeps draft edits and published versions under one visible course identity', async () => {
  const titlePrefix = 'Identity flow regression';
  let courseId = '';
  try {
    const createResponse = await fetch(apiUrl('/manage/courses'), {
      method: 'POST',
      headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
      body: JSON.stringify({ title: `${titlePrefix} initial`, description: '', category: 'General', visibility: 'public' }),
    });
    assert.equal(createResponse.status, 201);
    courseId = (await createResponse.json()).course.id;

    const firstDraftSave = await fetch(apiUrl(`/manage/courses/${courseId}`), {
      method: 'PATCH',
      headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
      body: JSON.stringify({ title: `${titlePrefix} draft one`, status: 'draft' }),
    });
    assert.equal(firstDraftSave.status, 200);

    database.prepare(`INSERT INTO course_modules (id, course_id, title, position)
      VALUES ('module-identity-flow', ?, 'Identity module', 0)`).run(courseId);
    database.prepare(`INSERT INTO media_files (id, course_id, original_name, file_name, mime_type, byte_size, media_kind)
      VALUES ('media-identity-flow', ?, 'identity.mp4', 'identity.mp4', 'video/mp4', 1, 'video')`).run(courseId);
    database.prepare(`INSERT INTO lessons (id, module_id, title, media_id, position)
      VALUES ('lesson-identity-flow', 'module-identity-flow', 'Identity lesson', 'media-identity-flow', 0)`).run();

    async function fetchManagedCourses(status, query = titlePrefix) {
      const params = new URLSearchParams({ q: query });
      if (status) params.set('status', status);
      const response = await fetch(apiUrl(`/manage/courses?${params}`), { headers: userHeaders('admin-1') });
      assert.equal(response.status, 200);
      return response.json();
    }

    let result = await fetchManagedCourses('draft');
    assert.equal(result.total, 1);
    assert.deepEqual(result.courses.map((course) => course.id), [courseId]);
    assert.equal(result.courses[0].hasUnpublishedChanges, false);

    const firstPublish = await fetch(apiUrl(`/manage/courses/${courseId}`), {
      method: 'PATCH',
      headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
      body: JSON.stringify({ title: `${titlePrefix} published one`, status: 'published' }),
    });
    assert.equal(firstPublish.status, 200);
    assert.equal((await firstPublish.json()).course.id, courseId);
    const firstVersion = database.prepare('SELECT id FROM course_versions WHERE course_id = ? AND version_number = 1').get(courseId);
    assert.ok(firstVersion?.id);

    let allCourses = await fetchManagedCourses('all');
    assert.equal(allCourses.total, 1);
    assert.deepEqual(allCourses.courses.map((course) => course.id), [courseId]);

    const editorLoad = await fetch(apiUrl(`/manage/courses/${courseId}`), { headers: userHeaders('admin-1') });
    assert.equal(editorLoad.status, 200);
    assert.equal((await editorLoad.json()).course.id, courseId);
    const secondDraftSave = await fetch(apiUrl(`/manage/courses/${courseId}`), {
      method: 'PATCH',
      headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
      body: JSON.stringify({ title: `${titlePrefix} draft two`, status: 'draft' }),
    });
    assert.equal(secondDraftSave.status, 200);
    assert.equal((await secondDraftSave.json()).course.id, courseId);

    for (const status of ['draft', 'published']) {
      result = await fetchManagedCourses(status);
      assert.equal(result.total, 1);
      assert.deepEqual(result.courses.map((course) => course.id), [courseId]);
      assert.equal(result.courses[0].hasUnpublishedChanges, true);
      assert.equal(result.courses[0].title, `${titlePrefix} draft two`);
    }
    result = await fetchManagedCourses('', `${titlePrefix} draft two`);
    assert.equal(result.total, 1);
    assert.deepEqual(result.courses.map((course) => course.id), [courseId]);
    allCourses = await fetchManagedCourses('all');
    assert.equal(allCourses.total, 1);
    assert.deepEqual(allCourses.courses.map((course) => course.id), [courseId]);

    const secondPublish = await fetch(apiUrl(`/manage/courses/${courseId}`), {
      method: 'PATCH',
      headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
      body: JSON.stringify({ title: `${titlePrefix} published two`, status: 'published' }),
    });
    assert.equal(secondPublish.status, 200);
    assert.equal((await secondPublish.json()).course.id, courseId);
    assert.deepEqual(database.prepare('SELECT version_number, course_id FROM course_versions WHERE course_id = ? ORDER BY version_number').all(courseId), [
      { version_number: 1, course_id: courseId },
      { version_number: 2, course_id: courseId },
    ]);
    result = await fetchManagedCourses('published');
    assert.equal(result.total, 1);
    assert.deepEqual(result.courses.map((course) => course.id), [courseId]);
    assert.equal(result.courses[0].hasUnpublishedChanges, false);
    result = await fetchManagedCourses('draft');
    assert.equal(result.total, 0);

    const originalPrepare = database.prepare;
    let fullHistoryQueryCount = 0;
    let scopedVersionQueryCount = 0;
    database.prepare = (sql) => {
      const normalizedSql = sql.replace(/\s+/g, ' ').trim();
      if (normalizedSql.startsWith('SELECT v.*, u.username AS publisher')) fullHistoryQueryCount += 1;
      if (normalizedSql === 'SELECT id, version_number FROM course_versions WHERE id = ? AND course_id = ?') scopedVersionQueryCount += 1;
      return originalPrepare.call(database, sql);
    };
    let restoreResponse;
    try {
      restoreResponse = await fetch(apiUrl(`/manage/courses/${courseId}/versions/${firstVersion.id}/restore`), {
        method: 'POST',
        headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
    } finally {
      database.prepare = originalPrepare;
    }
    assert.equal(restoreResponse.status, 200);
    assert.equal(fullHistoryQueryCount, 0, 'restoring one version should not load the complete history');
    assert.equal(scopedVersionQueryCount, 1, 'expected one course-scoped version existence and audit lookup');
    const versions = database.prepare('SELECT version_number, course_id FROM course_versions WHERE course_id = ? ORDER BY version_number').all(courseId);
    assert.deepEqual(versions, [
      { version_number: 1, course_id: courseId },
      { version_number: 2, course_id: courseId },
      { version_number: 3, course_id: courseId },
    ]);
    result = await fetchManagedCourses('published');
    assert.equal(result.total, 1);
    assert.deepEqual(result.courses.map((course) => course.id), [courseId]);
  } finally {
    if (courseId) database.prepare('DELETE FROM courses WHERE id = ?').run(courseId);
  }
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

test('course deletion logs media cleanup failures without reporting the committed delete as failed', async () => {
  const courseId = 'course-delete-cleanup-failure';
  database.prepare(`INSERT INTO courses (id, title, status, created_by, updated_by)
    VALUES (?, 'Archived cleanup failure course', 'archived', 'admin-1', 'admin-1')`).run(courseId);
  const originalRemove = fs.promises.rm;
  fs.promises.rm = async (target, options) => {
    if (target === path.join(fixtureDirectory, 'course-media', courseId)) {
      const error = new Error('media directory could not be removed');
      error.code = 'EACCES';
      throw error;
    }
    return originalRemove(target, options);
  };

  try {
    const response = await fetch(apiUrl(`/manage/courses/${courseId}`), {
      method: 'DELETE',
      headers: userHeaders('admin-1'),
    });
    assert.equal(response.status, 204);
    assert.equal(database.prepare('SELECT id FROM courses WHERE id = ?').get(courseId), undefined);
    const log = database.prepare(`SELECT level, source, message, details_json FROM system_logs
      WHERE message = 'Course records were deleted but media cleanup failed' ORDER BY id DESC LIMIT 1`).get();
    assert.equal(log.level, 'error');
    assert.equal(log.source, 'media');
    assert.deepEqual(JSON.parse(log.details_json), { courseId, errorName: 'Error', errorCode: 'EACCES' });
  } finally {
    fs.promises.rm = originalRemove;
  }
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

test('resource links reject malformed, unsafe, and credentialed URLs without writes', async () => {
  database.exec(`
    INSERT INTO courses (id, title, status, created_by, updated_by)
      VALUES ('course-resource-url-validation', 'Resource URL validation', 'draft', 'admin-1', 'admin-1');
    INSERT INTO course_modules (id, course_id, title, position)
      VALUES ('module-resource-url-validation', 'course-resource-url-validation', 'Resource URL module', 0);
    INSERT INTO lessons (id, module_id, title, position)
      VALUES ('lesson-resource-url-validation', 'module-resource-url-validation', 'Resource URL lesson', 0);
  `);
  const urls = [
    ['not a URL', 'Enter a valid link URL.'],
    ['ftp://example.com/resource', 'Links must use HTTP or HTTPS and cannot contain embedded credentials.'],
    ['https://teacher:secret@example.com/resource', 'Links must use HTTP or HTTPS and cannot contain embedded credentials.'],
  ];

  for (const [url, error] of urls) {
    const response = await fetch(apiUrl('/manage/lessons/lesson-resource-url-validation/resources'), {
      method: 'POST',
      headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Reference guide', url }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error, code: 'validation_error' });
  }

  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM lesson_resources WHERE lesson_id = 'lesson-resource-url-validation'").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.resource_link_added' AND entity_id = 'lesson-resource-url-validation'").get().count, 0);
});

test('resource link creation rolls back when its audit entry cannot be saved', async () => {
  database.exec(`
    INSERT INTO courses (id, title, status, created_by, updated_by)
      VALUES ('course-resource-link-audit', 'Resource link audit course', 'draft', 'admin-1', 'admin-1');
    INSERT INTO course_modules (id, course_id, title, position)
      VALUES ('module-resource-link-audit', 'course-resource-link-audit', 'Resource link module', 0);
    INSERT INTO lessons (id, module_id, title, position)
      VALUES ('lesson-resource-link-audit', 'module-resource-link-audit', 'Lesson with link', 0);
  `);
  const originalCourse = database.prepare("SELECT updated_at, updated_by FROM courses WHERE id = 'course-resource-link-audit'").get();
  const initialAuditCount = database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.resource_link_added' AND entity_id = 'lesson-resource-link-audit'").get().count;
  database.exec(`CREATE TRIGGER reject_resource_link_added_audit BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'course.resource_link_added' BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END`);

  try {
    const failedResponse = await fetch(apiUrl('/manage/lessons/lesson-resource-link-audit/resources'), {
      method: 'POST',
      headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Reference guide', url: 'https://example.com/guide' }),
    });
    assert.equal(failedResponse.status, 500);
    assert.equal((await failedResponse.json()).code, 'audit_unavailable');
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM lesson_resources WHERE lesson_id = 'lesson-resource-link-audit'").get().count, 0);
    assert.deepEqual(database.prepare("SELECT updated_at, updated_by FROM courses WHERE id = 'course-resource-link-audit'").get(), originalCourse);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.resource_link_added' AND entity_id = 'lesson-resource-link-audit'").get().count, initialAuditCount);
  } finally {
    database.exec('DROP TRIGGER IF EXISTS reject_resource_link_added_audit');
  }

  const retryResponse = await fetch(apiUrl('/manage/lessons/lesson-resource-link-audit/resources'), {
    method: 'POST',
    headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Reference guide', url: 'https://example.com/guide' }),
  });
  assert.equal(retryResponse.status, 201);
  const { resource } = await retryResponse.json();
  assert.equal(resource.kind, 'link');
  assert.equal(resource.title, 'Reference guide');
  assert.equal(resource.url, 'https://example.com/guide');
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM lesson_resources WHERE lesson_id = 'lesson-resource-link-audit' AND resource_type = 'link'").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.resource_link_added' AND entity_id = 'lesson-resource-link-audit'").get().count, initialAuditCount + 1);
});

test('publication and review notes over their limits are rejected without state changes', async () => {
  const reviewAuditCount = database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.review_changes_requested' AND entity_id = 'course-empty'").get().count;
  const publishResponse = await fetch(apiUrl('/manage/courses/course-empty'), {
    method: 'PATCH',
    headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Should remain unchanged', status: 'published', changeNote: 'n'.repeat(501) }),
  });
  assert.equal(publishResponse.status, 400);
  assert.equal((await publishResponse.json()).error, 'Publication note must be 500 characters or fewer.');
  assert.equal(database.prepare("SELECT title FROM courses WHERE id = 'course-empty'").get().title, 'Empty course');
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM course_versions WHERE course_id = 'course-empty'").get().count, 0);

  database.prepare(`INSERT INTO users (id, username, email, password_hash, role, disabled)
    VALUES ('reviewer-note-limit', 'reviewer_note_limit', 'reviewer-note-limit@example.invalid', 'not-used', 'moderator', 0)`).run();
  database.prepare(`INSERT INTO course_revisions (course_id, revision_course_id, author_id, review_status, submitted_by, submitted_at)
    VALUES ('course-empty', 'course-empty', 'admin-1', 'in_review', 'admin-1', CURRENT_TIMESTAMP)`).run();
  try {
    const reviewResponse = await fetch(apiUrl('/manage/courses/course-empty/review/decision'), {
      method: 'POST',
      headers: { ...userHeaders('reviewer-note-limit'), 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'approve', note: 'n'.repeat(501) }),
    });
    assert.equal(reviewResponse.status, 400);
    assert.equal((await reviewResponse.json()).error, 'Publication note must be 500 characters or fewer.');
    assert.equal(database.prepare("SELECT review_status FROM course_revisions WHERE course_id = 'course-empty'").get().review_status, 'in_review');
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM course_versions WHERE course_id = 'course-empty'").get().count, 0);

    const changeRequestResponse = await fetch(apiUrl('/manage/courses/course-empty/review/decision'), {
      method: 'POST',
      headers: { ...userHeaders('reviewer-note-limit'), 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'changes_requested', note: 'n'.repeat(1001) }),
    });
    assert.equal(changeRequestResponse.status, 400);
    assert.equal((await changeRequestResponse.json()).error, 'Review note must be 1000 characters or fewer.');
    assert.deepEqual(database.prepare('SELECT review_status, review_note FROM course_revisions WHERE course_id = ?').get('course-empty'), {
      review_status: 'in_review', review_note: '',
    });
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.review_changes_requested' AND entity_id = 'course-empty'").get().count, reviewAuditCount);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM course_versions WHERE course_id = 'course-empty'").get().count, 0);
  } finally {
    database.prepare("DELETE FROM course_revisions WHERE course_id = 'course-empty'").run();
    database.prepare("DELETE FROM users WHERE id = 'reviewer-note-limit'").run();
  }
});

test('course revision submission rejects a duplicate while review is pending', async () => {
  const courseId = 'course-review-submission-guard';
  const initialAuditCount = database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.revision_submitted' AND entity_id = ?").get(courseId).count;
  database.prepare(`INSERT INTO courses (id, title, status, created_by, updated_by)
    VALUES (?, 'Review submission guard', 'published', 'admin-1', 'admin-1')`).run(courseId);
  database.prepare(`INSERT INTO course_revisions (course_id, revision_course_id, author_id, review_status)
    VALUES (?, ?, 'admin-1', 'draft')`).run(courseId, courseId);

  try {
    const submit = (note) => fetch(apiUrl(`/manage/courses/${courseId}/review`), {
      method: 'POST',
      headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
      body: JSON.stringify({ note }),
    });
    const firstResponse = await submit('Please review the latest revision.');
    assert.equal(firstResponse.status, 200);
    assert.deepEqual(await firstResponse.json(), { status: 'in_review' });

    const submitted = database.prepare('SELECT review_status, submitted_by, review_note FROM course_revisions WHERE course_id = ?').get(courseId);
    assert.deepEqual(submitted, { review_status: 'in_review', submitted_by: 'admin-1', review_note: 'Please review the latest revision.' });
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.revision_submitted' AND entity_id = ?").get(courseId).count, initialAuditCount + 1);

    const duplicateResponse = await submit('Duplicate review request.');
    assert.equal(duplicateResponse.status, 409);
    assert.deepEqual(await duplicateResponse.json(), {
      error: 'This revision is already awaiting review.',
      code: 'review_already_pending',
    });
    assert.deepEqual(database.prepare('SELECT review_status, submitted_by, review_note FROM course_revisions WHERE course_id = ?').get(courseId), submitted);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.revision_submitted' AND entity_id = ?").get(courseId).count, initialAuditCount + 1);
  } finally {
    database.prepare("DELETE FROM audit_logs WHERE action = 'course.revision_submitted' AND entity_id = ?").run(courseId);
    database.prepare('DELETE FROM course_revisions WHERE course_id = ?').run(courseId);
    database.prepare('DELETE FROM courses WHERE id = ?').run(courseId);
  }
});

test('direct course publication rejects non-boolean recompletion options before saving', async () => {
  const response = await fetch(apiUrl('/manage/courses/course-empty'), {
    method: 'PATCH',
    headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Should remain unchanged', status: 'published', requiresRecompletion: 'false' }),
  });
  assert.equal(response.status, 400);
  const result = await response.json();
  assert.equal(result.code, 'validation_error');
  assert.equal(result.error, 'Recompletion option must be true or false.');
  assert.equal(database.prepare("SELECT title FROM courses WHERE id = 'course-empty'").get().title, 'Empty course');
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM course_versions WHERE course_id = 'course-empty'").get().count, 0);
});

test('path assignment rejects missing and malformed learner IDs as client errors', async () => {
  database.prepare(`INSERT INTO learning_paths (id, title, status, created_by, updated_by)
    VALUES ('path-assignment-validation', 'Assignment validation', 'published', 'admin-1', 'admin-1')`).run();
  for (const body of [{}, { userId: 42 }, { userId: '   ' }]) {
    const response = await fetch(apiUrl('/manage/learning-paths/path-assignment-validation/assignments'), {
      method: 'POST',
      headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Choose a learner to assign.', code: 'validation_error' });
  }
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM learning_path_enrollments WHERE path_id = 'path-assignment-validation'").get().count, 0);
});

test('path assignments reject draft paths before creating an enrollment', async () => {
  database.prepare(`INSERT INTO learning_paths (id, title, status, created_by, updated_by)
    VALUES ('path-draft-assignment', 'Draft assignment', 'draft', 'admin-1', 'admin-1')`).run();

  const response = await fetch(apiUrl('/manage/learning-paths/path-draft-assignment/assignments'), {
    method: 'POST',
    headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
    body: JSON.stringify({ userId: 'learner-unassigned' }),
  });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Published learning path not found.', code: 'not_found' });
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM learning_path_enrollments WHERE path_id = 'path-draft-assignment'").get().count, 0);
});

test('path assignment rolls back enrollment and course state when audit writing fails', async () => {
  database.exec(`
    INSERT INTO courses (id, title, visibility, status, created_by, updated_by)
      VALUES ('path-assignment-audit-course', 'Assignment audit course', 'private', 'published', 'admin-1', 'admin-1');
    INSERT INTO learning_paths (id, title, status, created_by, updated_by)
      VALUES ('path-assignment-audit-rollback', 'Assignment audit rollback', 'published', 'admin-1', 'admin-1');
    INSERT INTO learning_path_courses (id, path_id, course_id, position, requires_previous)
      VALUES ('path-assignment-audit-step', 'path-assignment-audit-rollback', 'path-assignment-audit-course', 0, 0);
    CREATE TRIGGER fail_path_assignment_audit
      BEFORE INSERT ON audit_logs
      WHEN NEW.action = 'path.assigned' AND NEW.entity_id = 'path-assignment-audit-rollback'
      BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;
  `);

  try {
    const response = await fetch(apiUrl('/manage/learning-paths/path-assignment-audit-rollback/assignments'), {
      method: 'POST',
      headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'learner-unassigned' }),
    });
    assert.equal(response.status, 500);
    assert.equal((await response.json()).code, 'audit_unavailable');
    assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM learning_path_enrollments
      WHERE path_id = 'path-assignment-audit-rollback' AND user_id = 'learner-unassigned'`).get().count, 0);
    assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM course_learning_state
      WHERE course_id = 'path-assignment-audit-course' AND user_id = 'learner-unassigned'`).get().count, 0);
    assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM audit_logs
      WHERE action = 'path.assigned' AND entity_id = 'path-assignment-audit-rollback'`).get().count, 0);
  } finally {
    database.exec('DROP TRIGGER fail_path_assignment_audit');
  }
});

test('admin assignment remains accurate when a learner self-enrolls after the directory loads', async () => {
  database.exec(`
    INSERT INTO learning_paths (id, title, status, self_enrollment, created_by, updated_by)
      VALUES ('path-assignment-self-enrollment-race', 'Assignment race', 'published', 1, 'admin-1', 'admin-1');
    INSERT INTO learning_path_courses (id, path_id, course_id, position, requires_previous)
      VALUES ('path-assignment-race-course', 'path-assignment-self-enrollment-race', 'course-analytics', 0, 0);
  `);

  const selfEnrollment = await fetch(apiUrl('/learning-paths/path-assignment-self-enrollment-race/enroll'), {
    method: 'POST',
    headers: userHeaders('learner-unassigned'),
  });
  assert.equal(selfEnrollment.status, 201);

  const assignment = await fetch(apiUrl('/manage/learning-paths/path-assignment-self-enrollment-race/assignments'), {
    method: 'POST',
    headers: { ...userHeaders('admin-1'), 'content-type': 'application/json' },
    body: JSON.stringify({ userId: 'learner-unassigned' }),
  });
  assert.equal(assignment.status, 204);
  assert.equal(database.prepare(`SELECT enrollment_source FROM learning_path_enrollments
    WHERE path_id = 'path-assignment-self-enrollment-race' AND user_id = 'learner-unassigned'`).get().enrollment_source, 'self');
  assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM audit_logs
    WHERE action = 'path.assigned' AND entity_id = 'path-assignment-self-enrollment-race'`).get().count, 0);
});

test('repeated self-enrollment requests create one enrollment and one audit event', async () => {
  database.exec(`
    INSERT INTO learning_paths (id, title, status, self_enrollment, created_by, updated_by)
      VALUES ('path-self-enrollment-idempotency', 'Self-enrollment idempotency', 'published', 1, 'admin-1', 'admin-1');
    INSERT INTO learning_path_courses (id, path_id, course_id, position, requires_previous)
      VALUES ('path-self-enrollment-course', 'path-self-enrollment-idempotency', 'course-analytics', 0, 0);
  `);

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(apiUrl('/learning-paths/path-self-enrollment-idempotency/enroll'), {
      method: 'POST',
      headers: userHeaders('learner-unassigned'),
    });
    assert.equal(response.status, attempt === 0 ? 201 : 200);
    assert.equal((await response.json()).path.enrolled, true);
  }

  assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM learning_path_enrollments
    WHERE path_id = 'path-self-enrollment-idempotency' AND user_id = 'learner-unassigned'`).get().count, 1);
  assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM audit_logs
    WHERE action = 'path.enrolled' AND entity_id = 'path-self-enrollment-idempotency'`).get().count, 1);
});

test('path learner directory searches and paginates active learners without hiding accounts', async () => {
  database.prepare(`INSERT INTO learning_paths (id, title, status, created_by, updated_by)
    VALUES ('path-learner-directory', 'Learner directory', 'published', 'admin-1', 'admin-1')`).run();
  const insertLearner = database.prepare(`INSERT INTO users (id, username, email, password_hash, role, disabled)
    VALUES (?, ?, ?, 'not-used', 'learner', 0)`);
  const insertAssignment = database.prepare(`INSERT INTO learning_path_enrollments (id, path_id, user_id, enrollment_source, assigned_by)
    VALUES (?, 'path-learner-directory', ?, 'assigned', 'admin-1')`);
  for (let index = 1; index <= 52; index++) {
    const suffix = String(index).padStart(3, '0');
    insertLearner.run(`directory-learner-${suffix}`, `page-learner-${suffix}`, `page-${suffix}@example.invalid`);
    insertAssignment.run(`directory-enrollment-${suffix}`, `directory-learner-${suffix}`);
  }
  const unassignedPlan = database.prepare(`EXPLAIN QUERY PLAN SELECT u.id, u.username, u.email,
      NULL AS enrollment_source, NULL AS enrolled_at FROM users u
    WHERE NOT EXISTS (SELECT 1 FROM learning_path_enrollments e
      WHERE e.path_id = ? AND e.user_id = u.id)
      AND u.role = 'learner' AND u.disabled = 0
    ORDER BY u.username COLLATE NOCASE LIMIT ? OFFSET ?`).all('path-learner-directory', 50, 0)
    .map((item) => item.detail).join('\n');
  assert.match(unassignedPlan, /users_role_username/);
  assert.doesNotMatch(unassignedPlan, /USE TEMP B-TREE/);
  const expectedTotal = database.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'learner' AND disabled = 0").get().count;

  const firstPageResponse = await fetch(apiUrl('/manage/learning-paths/path-learner-directory/learners'), {
    headers: userHeaders('admin-1'),
  });
  assert.equal(firstPageResponse.status, 200);
  const firstPage = await firstPageResponse.json();
  assert.equal(firstPage.total, expectedTotal);
  assert.equal(firstPage.page, 1);
  assert.equal(firstPage.pageSize, 50);
  assert.equal(firstPage.hasMore, true);
  assert.equal(firstPage.learners.length, 50);
  assert.equal(firstPage.learners[0].id, 'directory-learner-001');

  const secondPageResponse = await fetch(apiUrl('/manage/learning-paths/path-learner-directory/learners?page=2'), {
    headers: userHeaders('admin-1'),
  });
  const secondPage = await secondPageResponse.json();
  assert.equal(secondPage.page, 2);
  assert.equal(secondPage.hasMore, false);
  assert.equal(secondPage.learners.length, expectedTotal - 50);
  assert.equal(secondPage.learners[0].id, 'directory-learner-051');
  assert.equal(new Set([...firstPage.learners, ...secondPage.learners].map((learner) => learner.id)).size, expectedTotal);
  assert.equal([...firstPage.learners, ...secondPage.learners].some((learner) => learner.id === 'learner-disabled'), false);

  const searchResponse = await fetch(apiUrl('/manage/learning-paths/path-learner-directory/learners?q=PAGE-LEARNER-052'), {
    headers: userHeaders('admin-1'),
  });
  const search = await searchResponse.json();
  assert.equal(search.total, 1);
  assert.equal(search.learners[0].id, 'directory-learner-052');
  assert.equal(search.learners[0].enrolled, true);
  assert.equal(search.learners[0].source, 'assigned');

  const invalidSearch = await fetch(apiUrl(`/manage/learning-paths/path-learner-directory/learners?q=${'x'.repeat(101)}`), {
    headers: userHeaders('admin-1'),
  });
  assert.equal(invalidSearch.status, 400);
  assert.equal((await invalidSearch.json()).code, 'validation_error');
});

test('course access grant lookup reuses its query and sees grant changes immediately', () => {
  const courseId = 'course-grant-statement-cache';
  database.prepare(`INSERT INTO courses (id, title, status, visibility, created_by, updated_by)
    VALUES (?, 'Grant cache test', 'published', 'private', 'admin-1', 'admin-1')`).run(courseId);

  const originalPrepare = database.prepare;
  let grantQueryPreparations = 0;
  database.prepare = (sql) => {
    if (sql.replace(/\s+/g, ' ').trim() === 'SELECT 1 FROM course_grants WHERE course_id = ? AND user_id = ?') {
      grantQueryPreparations += 1;
    }
    return originalPrepare.call(database, sql);
  };

  try {
    assert.equal(hasCourseGrant(courseId, 'learner-active'), false);
    originalPrepare.call(database, `INSERT INTO course_grants (id, course_id, user_id, granted_by)
      VALUES ('grant-statement-cache-test', ?, 'learner-active', 'admin-1')`).run(courseId);
    assert.equal(hasCourseGrant(courseId, 'learner-active'), true);
    originalPrepare.call(database, 'DELETE FROM course_grants WHERE id = ?').run('grant-statement-cache-test');
    assert.equal(hasCourseGrant(courseId, 'learner-active'), false);
  } finally {
    database.prepare = originalPrepare;
  }

  assert.equal(grantQueryPreparations, 0);
});

test('learning-path course lookups have a course-first covering index', () => {
  const queryPlan = database.prepare(`EXPLAIN QUERY PLAN
    SELECT path_id FROM learning_path_courses WHERE course_id = ?`).all('path-index-probe');

  assert.ok(queryPlan.some((row) => row.detail.includes('USING COVERING INDEX learning_path_courses_course_path')),
    `Expected course lookup to use the course-first index, received: ${queryPlan.map((row) => row.detail).join('; ')}`);
});

test('logical course ID resolution reuses its prepared course and content lookups', () => {
  const rootId = 'logical-identity-prepared-root';
  const moduleId = 'logical-identity-prepared-module';
  const lessonId = 'logical-identity-prepared-lesson';
  const quizId = 'logical-identity-prepared-quiz';
  database.prepare(`INSERT INTO courses (id, title, status, created_by, updated_by)
    VALUES (?, 'Logical identity resolver', 'published', 'admin-1', 'admin-1')`).run(rootId);
  database.prepare(`INSERT INTO course_modules (id, course_id, title, position)
    VALUES (?, ?, 'Logical identity module', 0)`).run(moduleId, rootId);
  database.prepare(`INSERT INTO lessons (id, module_id, title, position)
    VALUES (?, ?, 'Logical identity lesson', 0)`).run(lessonId, moduleId);
  database.prepare(`INSERT INTO quizzes (id, module_id, title, pass_mark)
    VALUES (?, ?, 'Logical identity quiz', 70)`).run(quizId, moduleId);

  const lookupQueries = new Set([
    'SELECT id, logical_course_id FROM courses WHERE id = ?',
    'SELECT c.id, c.logical_course_id FROM courses c JOIN course_modules m ON m.course_id = c.id WHERE m.id = ?',
    'SELECT c.id, c.logical_course_id FROM courses c JOIN course_modules m ON m.course_id = c.id JOIN lessons l ON l.module_id = m.id WHERE l.id = ?',
    'SELECT c.id, c.logical_course_id FROM courses c JOIN course_modules m ON m.course_id = c.id JOIN quizzes q ON q.module_id = m.id WHERE q.id = ?',
  ]);
  const originalPrepare = database.prepare;
  let lookupPreparations = 0;
  database.prepare = (sql) => {
    if (lookupQueries.has(sql.replace(/\s+/g, ' ').trim())) lookupPreparations += 1;
    return originalPrepare.call(database, sql);
  };

  try {
    assert.equal(logicalCourseId(rootId), rootId);
    assert.equal(logicalCourseId(moduleId), rootId);
    assert.equal(logicalCourseId(lessonId), rootId);
    assert.equal(logicalCourseId(quizId), rootId);
    assert.equal(logicalCourseId('missing-course-identity'), null);
  } finally {
    database.prepare = originalPrepare;
    originalPrepare.call(database, 'DELETE FROM courses WHERE id = ?').run(rootId);
  }

  assert.equal(lookupPreparations, 0, 'course identity lookups should be prepared once when the module loads');
});

test('published version lookup reuses its statement while reading the latest live version', () => {
  const rootId = 'published-version-prepared-root';
  const firstStorageId = 'published-version-prepared-v1';
  const secondStorageId = 'published-version-prepared-v2';
  database.prepare(`INSERT INTO courses (id, title, status, created_by, updated_by)
    VALUES (?, 'Prepared version root', 'published', 'admin-1', 'admin-1')`).run(rootId);
  database.prepare(`INSERT INTO courses (id, title, status, created_by, updated_by, logical_course_id)
    VALUES (?, 'Version one', 'published', 'admin-1', 'admin-1', ?)`)
    .run(firstStorageId, rootId);
  database.prepare(`INSERT INTO course_versions (id, course_id, storage_course_id, version_number, published_by)
    VALUES ('published-version-prepared-v1-row', ?, ?, 1, 'admin-1')`).run(rootId, firstStorageId);

  const originalPrepare = database.prepare;
  let lookupPreparations = 0;
  database.prepare = (sql) => {
    if (sql.replace(/\s+/g, ' ').trim().startsWith('SELECT v.*, c.title, c.description, c.category, c.visibility, c.status,')) {
      lookupPreparations += 1;
    }
    return originalPrepare.call(database, sql);
  };

  try {
    const firstVersion = publishedVersionForLogicalCourse(rootId);
    assert.equal(firstVersion?.id, 'published-version-prepared-v1-row');
    assert.equal(firstVersion?.title, 'Version one');
    originalPrepare.call(database, `INSERT INTO courses (id, title, status, created_by, updated_by, logical_course_id)
      VALUES (?, 'Version two', 'published', 'admin-1', 'admin-1', ?)`)
      .run(secondStorageId, rootId);
    originalPrepare.call(database, `INSERT INTO course_versions (id, course_id, storage_course_id, version_number, published_by)
      VALUES ('published-version-prepared-v2-row', ?, ?, 2, 'admin-1')`).run(rootId, secondStorageId);
    const latestVersion = publishedVersionForLogicalCourse(rootId);
    assert.equal(latestVersion?.id, 'published-version-prepared-v2-row');
    assert.equal(latestVersion?.title, 'Version two');
  } finally {
    database.prepare = originalPrepare;
    originalPrepare.call(database, 'DELETE FROM courses WHERE id = ?').run(rootId);
  }

  assert.equal(lookupPreparations, 0, 'published-version lookup should reuse the statement prepared at module load');
});

test('course row and version-access lookups reuse prepared statements and read current rows', () => {
  const rootId = 'course-access-prepared-root';
  const firstStorageId = 'course-access-prepared-v1';
  const secondStorageId = 'course-access-prepared-v2';
  database.prepare(`INSERT INTO courses (id, title, status, visibility, created_by, updated_by)
    VALUES (?, 'Course access root', 'published', 'public', 'admin-1', 'admin-1')`).run(rootId);
  database.prepare(`INSERT INTO courses (id, title, status, visibility, created_by, updated_by, logical_course_id)
    VALUES (?, 'Course access version one', 'published', 'public', 'admin-1', 'admin-1', ?)`)
    .run(firstStorageId, rootId);
  database.prepare(`INSERT INTO course_versions (id, course_id, storage_course_id, version_number, published_by)
    VALUES ('course-access-prepared-v1-row', ?, ?, 1, 'admin-1')`).run(rootId, firstStorageId);

  const watchedQueries = new Set([
    'SELECT * FROM courses WHERE id = ?',
    'SELECT * FROM courses WHERE id = ? AND logical_course_id IS NULL',
    'SELECT storage_course_id FROM course_versions WHERE course_id = ? ORDER BY version_number DESC LIMIT 1',
  ]);
  const originalPrepare = database.prepare;
  let watchedPreparations = 0;
  database.prepare = (sql) => {
    if (watchedQueries.has(sql.replace(/\s+/g, ' ').trim())) watchedPreparations += 1;
    return originalPrepare.call(database, sql);
  };

  try {
    assert.equal(readCourseById(rootId)?.title, 'Course access root');
    originalPrepare.call(database, "UPDATE courses SET title = 'Updated course access root' WHERE id = ?").run(rootId);
    assert.equal(readCourseById(rootId)?.title, 'Updated course access root');

    const versionSnapshot = originalPrepare.call(database, 'SELECT * FROM courses WHERE id = ?').get(firstStorageId);
    const learner = { id: 'learner-active', role: 'learner', disabled: 0 };
    assert.equal(canViewCourse(versionSnapshot, learner), true);
    originalPrepare.call(database, `INSERT INTO courses (id, title, status, visibility, created_by, updated_by, logical_course_id)
      VALUES (?, 'Course access version two', 'published', 'public', 'admin-1', 'admin-1', ?)`)
      .run(secondStorageId, rootId);
    originalPrepare.call(database, `INSERT INTO course_versions (id, course_id, storage_course_id, version_number, published_by)
      VALUES ('course-access-prepared-v2-row', ?, ?, 2, 'admin-1')`).run(rootId, secondStorageId);
    assert.equal(canViewCourse(versionSnapshot, learner), false, 'old snapshots should stop being visible after a newer version is published');
  } finally {
    database.prepare = originalPrepare;
    originalPrepare.call(database, 'DELETE FROM courses WHERE id = ?').run(rootId);
  }

  assert.equal(watchedPreparations, 0, 'course-access and row lookups should be prepared once when the module loads');
});

test('course manager resolves module, lesson, and quiz IDs with prepared lookups', () => {
  const courseId = 'manager-content-lookup-course';
  const moduleId = 'manager-content-lookup-module';
  const lessonId = 'manager-content-lookup-lesson';
  const quizId = 'manager-content-lookup-quiz';
  database.prepare(`INSERT INTO courses (id, title, status, created_by, updated_by)
    VALUES (?, 'Manager lookup course', 'published', 'admin-1', 'admin-1')`).run(courseId);
  database.prepare(`INSERT INTO course_modules (id, course_id, title, position)
    VALUES (?, ?, 'Manager lookup module', 0)`).run(moduleId, courseId);
  database.prepare(`INSERT INTO lessons (id, module_id, title, position)
    VALUES (?, ?, 'Manager lookup lesson', 0)`).run(lessonId, moduleId);
  database.prepare(`INSERT INTO quizzes (id, module_id, title, pass_mark)
    VALUES (?, ?, 'Manager lookup quiz', 70)`).run(quizId, moduleId);

  const lookupQueries = new Set([
    'SELECT c.* FROM courses c JOIN course_modules m ON m.course_id = c.id WHERE m.id = ?',
    'SELECT c.* FROM courses c JOIN course_modules m ON m.course_id = c.id JOIN lessons l ON l.module_id = m.id WHERE l.id = ?',
    'SELECT c.* FROM courses c JOIN course_modules m ON m.course_id = c.id JOIN quizzes q ON q.module_id = m.id WHERE q.id = ?',
  ]);
  const originalPrepare = database.prepare;
  let lookupPreparations = 0;
  database.prepare = (sql) => {
    if (lookupQueries.has(sql.replace(/\s+/g, ' ').trim())) lookupPreparations += 1;
    return originalPrepare.call(database, sql);
  };

  try {
    const administrator = { id: 'admin-1', role: 'admin' };
    assert.equal(requireCourseManagerForTests(moduleId, administrator)?.id, courseId);
    originalPrepare.call(database, "UPDATE courses SET title = 'Updated manager lookup course' WHERE id = ?").run(courseId);
    assert.equal(requireCourseManagerForTests(lessonId, administrator)?.title, 'Updated manager lookup course');
    assert.equal(requireCourseManagerForTests(quizId, administrator)?.id, courseId);
  } finally {
    database.prepare = originalPrepare;
    originalPrepare.call(database, 'DELETE FROM courses WHERE id = ?').run(courseId);
  }

  assert.equal(lookupPreparations, 0, 'content-ID course lookups should reuse statements prepared when HTTP helpers load');
});

test('course access reuses complete canonical rows supplied by list queries', () => {
  const course = database.prepare('SELECT * FROM courses WHERE id = ?').get('course-analytics');
  assert.equal(course.logical_course_id, null);
  assert.equal(typeof course.status, 'string');
  assert.equal(typeof course.visibility, 'string');

  const originalPrepare = database.prepare;
  let logicalCoursePreparations = 0;
  let canonicalCoursePreparations = 0;
  database.prepare = (sql) => {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    if (normalized === 'SELECT id, logical_course_id FROM courses WHERE id = ?') logicalCoursePreparations += 1;
    if (normalized === 'SELECT * FROM courses WHERE id = ? AND logical_course_id IS NULL') canonicalCoursePreparations += 1;
    return originalPrepare.call(database, sql);
  };

  try {
    const canView = createCourseAccessChecker({ id: 'learner-active', role: 'learner', disabled: 0 });
    assert.equal(canView(course), true);
  } finally {
    database.prepare = originalPrepare;
  }

  assert.equal(logicalCoursePreparations, 0);
  assert.equal(canonicalCoursePreparations, 0);
});

test('course access reuses the prerequisite query across enrolled paths', () => {
  const targetCourseId = 'path-prerequisite-query-target';
  const prerequisiteCourseId = 'path-prerequisite-query-prerequisite';
  database.exec(`
    INSERT INTO courses (id, title, status, visibility, created_by, updated_by) VALUES
      ('${prerequisiteCourseId}', 'Unfinished prerequisite', 'published', 'public', 'admin-1', 'admin-1'),
      ('${targetCourseId}', 'Private path target', 'published', 'private', 'admin-1', 'admin-1');
    INSERT INTO learning_paths (id, title, status, created_by, updated_by) VALUES
      ('path-prerequisite-query-one', 'Prerequisite query one', 'published', 'admin-1', 'admin-1'),
      ('path-prerequisite-query-two', 'Prerequisite query two', 'published', 'admin-1', 'admin-1');
    INSERT INTO learning_path_courses (id, path_id, course_id, position, requires_previous) VALUES
      ('path-prerequisite-query-one-first', 'path-prerequisite-query-one', '${prerequisiteCourseId}', 0, 0),
      ('path-prerequisite-query-one-target', 'path-prerequisite-query-one', '${targetCourseId}', 1, 1),
      ('path-prerequisite-query-two-first', 'path-prerequisite-query-two', '${prerequisiteCourseId}', 0, 0),
      ('path-prerequisite-query-two-target', 'path-prerequisite-query-two', '${targetCourseId}', 1, 1);
    INSERT INTO learning_path_enrollments (id, path_id, user_id, enrollment_source, assigned_by) VALUES
      ('path-prerequisite-query-enrollment-one', 'path-prerequisite-query-one', 'learner-active', 'assigned', 'admin-1'),
      ('path-prerequisite-query-enrollment-two', 'path-prerequisite-query-two', 'learner-active', 'assigned', 'admin-1');
  `);

  const originalPrepare = database.prepare;
  let prerequisiteQueryPreparations = 0;
  database.prepare = (sql) => {
    if (sql.replace(/\s+/g, ' ').trim() === 'SELECT prior.course_id FROM learning_path_courses prior WHERE prior.path_id = ? AND prior.position < ? ORDER BY prior.position') {
      prerequisiteQueryPreparations += 1;
    }
    return originalPrepare.call(database, sql);
  };

  try {
    const targetCourse = originalPrepare.call(database, 'SELECT * FROM courses WHERE id = ?').get(targetCourseId);
    const canView = createCourseAccessChecker({ id: 'learner-active', role: 'learner', disabled: 0 });
    assert.equal(canView(targetCourse), false);
  } finally {
    database.prepare = originalPrepare;
    originalPrepare.call(database, 'DELETE FROM learning_path_enrollments WHERE id LIKE ?').run('path-prerequisite-query-enrollment-%');
    originalPrepare.call(database, 'DELETE FROM learning_paths WHERE id LIKE ?').run('path-prerequisite-query-%');
    originalPrepare.call(database, 'DELETE FROM courses WHERE id IN (?, ?)').run(targetCourseId, prerequisiteCourseId);
  }

  assert.equal(prerequisiteQueryPreparations, 0);
});

test('course access reuses the enrolled-path lookup across private courses', () => {
  const courseIds = ['enrolled-path-query-course-one', 'enrolled-path-query-course-two'];
  database.exec(`
    INSERT INTO courses (id, title, status, visibility, created_by, updated_by) VALUES
      ('${courseIds[0]}', 'Path course one', 'published', 'private', 'admin-1', 'admin-1'),
      ('${courseIds[1]}', 'Path course two', 'published', 'private', 'admin-1', 'admin-1');
    INSERT INTO learning_paths (id, title, status, created_by, updated_by)
      VALUES ('enrolled-path-query-path', 'Enrolled path query', 'published', 'admin-1', 'admin-1');
    INSERT INTO learning_path_courses (id, path_id, course_id, position, requires_previous) VALUES
      ('enrolled-path-query-step-one', 'enrolled-path-query-path', '${courseIds[0]}', 0, 0),
      ('enrolled-path-query-step-two', 'enrolled-path-query-path', '${courseIds[1]}', 1, 0);
    INSERT INTO learning_path_enrollments (id, path_id, user_id, enrollment_source, assigned_by)
      VALUES ('enrolled-path-query-enrollment', 'enrolled-path-query-path', 'learner-active', 'assigned', 'admin-1');
  `);

  const originalPrepare = database.prepare;
  let enrolledPathQueryPreparations = 0;
  database.prepare = (sql) => {
    if (sql.replace(/\s+/g, ' ').trim() === `SELECT lp.id AS path_id, lp.status, pc.position, pc.requires_previous FROM learning_path_enrollments e JOIN learning_paths lp ON lp.id = e.path_id JOIN learning_path_courses pc ON pc.path_id = lp.id WHERE e.user_id = ? AND pc.course_id = ? AND lp.status = 'published'`) {
      enrolledPathQueryPreparations += 1;
    }
    return originalPrepare.call(database, sql);
  };

  try {
    const canView = createCourseAccessChecker({ id: 'learner-active', role: 'learner', disabled: 0 });
    const firstCourse = originalPrepare.call(database, 'SELECT * FROM courses WHERE id = ?').get(courseIds[0]);
    const secondCourse = originalPrepare.call(database, 'SELECT * FROM courses WHERE id = ?').get(courseIds[1]);
    assert.equal(canView(firstCourse), true);
    assert.equal(canView(secondCourse), true);
    originalPrepare.call(database, 'DELETE FROM learning_path_enrollments WHERE id = ?').run('enrolled-path-query-enrollment');
    const canViewAfterEnrollmentRemoval = createCourseAccessChecker({ id: 'learner-active', role: 'learner', disabled: 0 });
    assert.equal(canViewAfterEnrollmentRemoval(secondCourse), false);
  } finally {
    database.prepare = originalPrepare;
    originalPrepare.call(database, 'DELETE FROM learning_path_enrollments WHERE id = ?').run('enrolled-path-query-enrollment');
    originalPrepare.call(database, 'DELETE FROM learning_paths WHERE id = ?').run('enrolled-path-query-path');
    originalPrepare.call(database, 'DELETE FROM courses WHERE id IN (?, ?)').run(...courseIds);
  }

  assert.equal(enrolledPathQueryPreparations, 0);
});

test('course access reuses prerequisite-completion statements across courses', () => {
  const courseIds = ['path-completion-query-course-one', 'path-completion-query-course-two'];
  const targetCourseId = 'path-completion-query-target';
  const prerequisiteQueryPreparations = new Map([
    'SELECT v.id, v.storage_course_id FROM course_versions v WHERE v.course_id = ? ORDER BY v.version_number DESC LIMIT 1',
    'SELECT target_version_id FROM course_learning_state WHERE user_id = ? AND course_id = ?',
    'SELECT l.id, l.stable_id FROM lessons l JOIN course_modules m ON m.id = l.module_id WHERE m.course_id = ?',
    'SELECT q.id, q.stable_id FROM quizzes q JOIN course_modules m ON m.id = q.module_id WHERE m.course_id = ?',
    'SELECT l.id, l.stable_id FROM lesson_progress p JOIN lessons l ON l.id = p.lesson_id JOIN course_modules m ON m.id = l.module_id JOIN courses c ON c.id = m.course_id WHERE p.user_id = ? AND (c.id = ? OR c.logical_course_id = ?)',
    'SELECT DISTINCT q.id, q.stable_id FROM quiz_attempts a JOIN quizzes q ON q.id = a.quiz_id JOIN course_modules m ON m.id = q.module_id JOIN courses c ON c.id = m.course_id WHERE a.user_id = ? AND a.passed = 1 AND (c.id = ? OR c.logical_course_id = ?)',
  ].map((query) => [query, 0]));
  database.exec(`
    INSERT INTO courses (id, title, status, visibility, created_by, updated_by) VALUES
      ('${courseIds[0]}', 'Completed prerequisite one', 'published', 'public', 'admin-1', 'admin-1'),
      ('${courseIds[1]}', 'Completed prerequisite two', 'published', 'public', 'admin-1', 'admin-1'),
      ('${targetCourseId}', 'Private prerequisite target', 'published', 'private', 'admin-1', 'admin-1');
    INSERT INTO course_modules (id, course_id, title, position) VALUES
      ('path-completion-query-module-one', '${courseIds[0]}', 'Module one', 0),
      ('path-completion-query-module-two', '${courseIds[1]}', 'Module two', 0);
    INSERT INTO lessons (id, module_id, title, position) VALUES
      ('path-completion-query-lesson-one', 'path-completion-query-module-one', 'Lesson one', 0),
      ('path-completion-query-lesson-two', 'path-completion-query-module-two', 'Lesson two', 0);
    INSERT INTO lesson_progress (user_id, lesson_id) VALUES
      ('learner-active', 'path-completion-query-lesson-one'),
      ('learner-active', 'path-completion-query-lesson-two');
    INSERT INTO learning_paths (id, title, status, created_by, updated_by)
      VALUES ('path-completion-query-path', 'Completion query path', 'published', 'admin-1', 'admin-1');
    INSERT INTO learning_path_courses (id, path_id, course_id, position, requires_previous) VALUES
      ('path-completion-query-step-one', 'path-completion-query-path', '${courseIds[0]}', 0, 0),
      ('path-completion-query-step-two', 'path-completion-query-path', '${courseIds[1]}', 1, 1),
      ('path-completion-query-target', 'path-completion-query-path', '${targetCourseId}', 2, 1);
    INSERT INTO learning_path_enrollments (id, path_id, user_id, enrollment_source, assigned_by)
      VALUES ('path-completion-query-enrollment', 'path-completion-query-path', 'learner-active', 'assigned', 'admin-1');
  `);

  const originalPrepare = database.prepare;
  database.prepare = (sql) => {
    const query = sql.replace(/\s+/g, ' ').trim();
    if (prerequisiteQueryPreparations.has(query)) prerequisiteQueryPreparations.set(query, prerequisiteQueryPreparations.get(query) + 1);
    return originalPrepare.call(database, sql);
  };

  try {
    const targetCourse = originalPrepare.call(database, 'SELECT * FROM courses WHERE id = ?').get(targetCourseId);
    const canView = createCourseAccessChecker({ id: 'learner-active', role: 'learner', disabled: 0 });
    assert.equal(canView(targetCourse), true);
    originalPrepare.call(database, 'DELETE FROM learning_path_enrollments WHERE id = ?').run('path-completion-query-enrollment');
    const canViewAfterEnrollmentRemoval = createCourseAccessChecker({ id: 'learner-active', role: 'learner', disabled: 0 });
    assert.equal(canViewAfterEnrollmentRemoval(targetCourse), false);
  } finally {
    database.prepare = originalPrepare;
    originalPrepare.call(database, 'DELETE FROM learning_path_enrollments WHERE id = ?').run('path-completion-query-enrollment');
    originalPrepare.call(database, 'DELETE FROM learning_paths WHERE id = ?').run('path-completion-query-path');
    originalPrepare.call(database, `DELETE FROM lesson_progress WHERE lesson_id IN
      (SELECT l.id FROM lessons l JOIN course_modules m ON m.id = l.module_id WHERE m.course_id IN (?, ?))`)
      .run(...courseIds);
    originalPrepare.call(database, 'DELETE FROM courses WHERE id IN (?, ?, ?)').run(...courseIds, targetCourseId);
  }

  for (const [query, preparations] of prerequisiteQueryPreparations) {
    assert.equal(preparations, 1, `Expected one prepared statement for ${query}.`);
  }
});
