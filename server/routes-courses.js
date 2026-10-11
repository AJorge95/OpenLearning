import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { config } from './config.js';
import { createCourseAccessChecker, enumQuery, fail, pageQuery, requireAuth, requireObjectBody, requireStaff, requireCourseManager, requireCourseViewer } from './http.js';
import { assertPublishable, canLearnerAccess, courseFromLesson, courseSummaries, courseSummary, enrollLearner, getCoursePayload, isLessonUnlocked, moduleCourse, quizCourse } from './course-service.js';
import { likeContains, textSearchPredicate } from './sql.js';
import { writeAuditLog, writeSystemLog } from './log-store.js';
import { validateLessonResourceUrl } from '../shared/resource-url-validation.js';
import { learnerCommentLimiter, learnerReactionLimiter, quizAttemptLimiter } from './rate-limits.js';
import { canonicalCourse, logicalCourseId, publishRevision, publishedVersion } from './course-versioning.js';
import { certificatePayload, findCourseCertificate, issueCertificateIfComplete } from './certificate-service.js';
import { syncUnlockedPathStates } from './routes-programs.js';
import { beginLessonWatch, getLessonWatchProgress, lessonVideoWasWatched, recordLessonWatchProgress, rewindLessonWatch } from './lesson-watch.js';
import { readMp4Duration } from './mp4-duration.js';
import { createVideoDurationReader } from './video-duration-reader.js';

export const courseRouter = Router();
courseRouter.use(requireAuth);
const COURSE_PAGE_SIZE = 24;
const MAX_COURSE_PAGE = 100_000;
const readCachedVideoDuration = createVideoDurationReader(readMp4Duration);

function paginationWindow(total, value, requestedPageSize = COURSE_PAGE_SIZE) {
  const requestedPage = pageQuery(value, MAX_COURSE_PAGE);
  const pageSize = requestedPageSize;
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));
  return { page, pageSize, offset: (page - 1) * pageSize, hasMore: page * pageSize < total };
}

function textField(value, label, max, { required = false } = {}) {
  if (value !== undefined && value !== null && typeof value !== 'string') {
    fail(400, `${label} must be text.`, 'validation_error');
  }
  const result = typeof value === 'string' ? value.trim() : '';
  if (required && !result) fail(400, `${label} is required.`, 'validation_error');
  if (result.length > max) fail(400, `${label} must be ${max} characters or fewer.`, 'validation_error');
  return result;
}

function intField(value, label, min, max) {
  const number = value;
  if (typeof number !== 'number' || !Number.isInteger(number) || number < min || number > max) {
    fail(400, `${label} must be between ${min} and ${max}.`, 'validation_error');
  }
  return number;
}

function booleanField(value, label) {
  if (typeof value !== 'boolean') fail(400, `${label} must be true or false.`, 'validation_error');
  return value;
}

function courseFileDirectory(courseId) {
  const root = path.resolve(config.mediaRoot);
  const candidate = path.resolve(root, logicalCourseId(courseId) || courseId);
  if (!candidate.startsWith(`${root}${path.sep}`)) fail(400, 'Invalid course identifier.', 'invalid_path');
  return candidate;
}

function syncLearnerPathsForCourse(courseId, userId) {
  const logicalId = logicalCourseId(courseId) || courseId;
  const paths = db.prepare(`SELECT DISTINCT e.path_id FROM learning_path_enrollments e
    JOIN learning_path_courses pc ON pc.path_id = e.path_id
    WHERE e.user_id = ? AND pc.course_id = ?`).all(userId, logicalId);
  syncUnlockedPathStates(paths.map((path) => path.path_id), userId);
}

async function removeCourseMediaFile(courseId, fileName, message, details = {}) {
  const logicalId = logicalCourseId(courseId) || courseId;
  if (db.prepare('SELECT 1 FROM course_versions WHERE course_id = ? LIMIT 1').get(logicalId)) return;
  try {
    await fs.promises.rm(path.join(courseFileDirectory(logicalId), fileName), { force: true });
  } catch (error) {
    writeSystemLog('error', 'media', message, {
      courseId,
      ...details,
      errorName: String(error?.name || 'Error').slice(0, 100),
      errorCode: typeof error?.code === 'string' ? error.code.slice(0, 100) : undefined,
    });
  }
}

function accessiblePublishedCourses(user, filters = {}) {
  const clauses = ["c.status = 'published'", 'c.logical_course_id IS NULL'];
  const params = [];
  if (filters.query) {
    const search = textSearchPredicate(['c.title', 'c.description', 'c.category'], filters.query);
    clauses.push(`(${search.sql})`);
    params.push(...search.params);
  }
  if (filters.category) {
    clauses.push('c.category = ?');
    params.push(filters.category);
  }
  if (user.role === 'admin' || user.role === 'moderator') {
    clauses.push("(c.visibility = 'public' OR c.visibility = 'private')");
  } else {
    clauses.push("(c.visibility = 'public' OR EXISTS (SELECT 1 FROM course_grants g WHERE g.course_id = c.id AND g.user_id = ?))");
    params.push(user.id);
  }
  const orderBy = filters.sort === 'title' ? 'c.title COLLATE NOCASE ASC' : 'c.updated_at DESC';
  const where = clauses.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS count FROM courses c WHERE ${where}`).get(...params).count;
  const { page, pageSize, offset, hasMore } = paginationWindow(total, filters.page);
  const courses = db.prepare(`SELECT c.* FROM courses c WHERE ${where} ORDER BY ${orderBy}, c.id ASC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, offset);
  return { courses, total, page, pageSize, hasMore };
}

function accessibleLearningCoursePage(user, requestedPageValue) {
  const requestedPage = pageQuery(requestedPageValue, MAX_COURSE_PAGE);
  const requestedOffset = (requestedPage - 1) * COURSE_PAGE_SIZE;
  const requestedEnd = requestedOffset + COURSE_PAGE_SIZE;
  const pageCandidates = [];
  const trailingCandidates = [];
  let total = 0;
  const canViewCourse = createCourseAccessChecker(user);
  const candidates = db.prepare(`WITH course_activity(course_id, activity_at, precedence) AS (
      SELECT e.course_id, e.enrolled_at, 0 FROM enrollments e WHERE e.user_id = ?
      UNION ALL
      SELECT g.course_id, g.granted_at, 1 FROM course_grants g WHERE g.user_id = ?
      UNION ALL
      SELECT pc.course_id, e.enrolled_at, 2 FROM learning_path_enrollments e
        JOIN learning_paths lp ON lp.id = e.path_id AND lp.status = 'published'
        JOIN learning_path_courses pc ON pc.path_id = e.path_id
        WHERE e.user_id = ?
    ), activity_by_course AS (
      SELECT course_id, COALESCE(
        MAX(CASE precedence WHEN 0 THEN activity_at END),
        MAX(CASE precedence WHEN 1 THEN activity_at END),
        MAX(CASE precedence WHEN 2 THEN activity_at END)
      ) AS activity_at
      FROM course_activity GROUP BY course_id
    )
    SELECT c.* FROM activity_by_course a JOIN courses c ON c.id = a.course_id
    WHERE c.status = 'published'
    ORDER BY a.activity_at DESC, c.id ASC`).iterate(user.id, user.id, user.id);

  for (const course of candidates) {
    if (!canViewCourse(course)) continue;
    if (total >= requestedOffset && total < requestedEnd) pageCandidates.push(course);
    if (trailingCandidates.length === COURSE_PAGE_SIZE) trailingCandidates.shift();
    trailingCandidates.push(course);
    total += 1;
  }

  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / COURSE_PAGE_SIZE)));
  const lastPageSize = total === 0 ? 0 : (total - 1) % COURSE_PAGE_SIZE + 1;
  return {
    courses: page === requestedPage ? pageCandidates : trailingCandidates.slice(-lastPageSize),
    total,
    page,
    pageSize: COURSE_PAGE_SIZE,
    hasMore: page * COURSE_PAGE_SIZE < total,
  };
}

function requireLearnerLesson(lessonId, user) {
  const lesson = courseFromLesson(lessonId);
  if (!lesson) fail(404, 'Lesson not found.', 'not_found');
  if (user.role !== 'learner') fail(403, 'Only learners can react to or comment on lessons.', 'forbidden');
  requireCourseViewer(lesson.id, user);
  if (lesson.status !== 'published') fail(404, 'Lesson not found.', 'not_found');
  if (!isLessonUnlocked(lessonId, user)) fail(423, 'Complete the previous lesson before opening this one.', 'lesson_locked');
  return lesson;
}

function requireWatchableLesson(lessonId, user) {
  const lesson = courseFromLesson(lessonId);
  if (!lesson) fail(404, 'Lesson not found.', 'not_found');
  requireCourseViewer(lesson.id, user);
  if (lesson.status !== 'published' || !lesson.media_id) fail(404, 'Lesson video is not available.', 'not_found');
  if (!isLessonUnlocked(lessonId, user)) fail(423, 'Complete the previous lesson before opening this one.', 'lesson_locked');
  return lesson;
}

async function verifiedVideoDuration(lesson) {
  const media = db.prepare('SELECT id, file_name, duration_seconds FROM media_files WHERE id = ? AND media_kind = \'video\'')
    .get(lesson.media_id);
  if (!media) fail(404, 'Lesson video is not available.', 'not_found');
  if (Number.isFinite(media.duration_seconds) && media.duration_seconds > 0) return media.duration_seconds;
  const base = courseFileDirectory(lesson.id);
  const filePath = path.resolve(base, media.file_name);
  if (!filePath.startsWith(`${base}${path.sep}`)) fail(404, 'Lesson video is not available.', 'not_found');
  let duration;
  try { duration = await readCachedVideoDuration(media.id, filePath); }
  catch { fail(422, 'This video duration could not be verified. Contact your course administrator.', 'video_duration_unavailable'); }
  if (!Number.isFinite(duration) || duration <= 0) {
    fail(422, 'This video duration could not be verified. Contact your course administrator.', 'video_duration_unavailable');
  }
  db.prepare('UPDATE media_files SET duration_seconds = ? WHERE id = ? AND duration_seconds IS NULL').run(duration, media.id);
  return db.prepare('SELECT duration_seconds FROM media_files WHERE id = ?').get(media.id).duration_seconds;
}

function requireFeedbackLesson(lessonId, user) {
  const lesson = courseFromLesson(lessonId);
  if (!lesson) fail(404, 'Lesson not found.', 'not_found');
  if (user.role === 'learner') requireCourseViewer(lesson.id, user);
  else if (!['admin', 'moderator'].includes(user.role)) fail(403, 'You do not have permission to view lesson feedback.', 'forbidden');
  if (lesson.status !== 'published') fail(404, 'Lesson not found.', 'not_found');
  return lesson;
}

function lessonReactionSummary(lessonId, userId) {
  const summary = db.prepare(`SELECT
    COUNT(CASE WHEN reaction = 'like' THEN 1 END) AS likes,
    COUNT(CASE WHEN reaction = 'dislike' THEN 1 END) AS dislikes,
    MAX(CASE WHEN user_id = ? THEN reaction END) AS user_reaction
    FROM lesson_reactions WHERE lesson_id = ?`).get(userId, lessonId);
  return {
    reaction: summary.user_reaction || null,
    counts: { like: summary.likes, dislike: summary.dislikes },
  };
}

courseRouter.get('/courses', (req, res) => {
  const query = textField(req.query.q, 'Search', 120);
  const category = textField(req.query.category, 'Category', 100);
  const sort = enumQuery(req.query.sort, 'sort order', ['recent', 'title'], 'recent');
  const includeCategories = enumQuery(req.query.includeCategories, 'category option', ['0', '1'], '1') === '1';
  const { courses, total, page, pageSize } = accessiblePublishedCourses(req.currentUser, { query, category, sort, page: req.query.page });
  const response = { courses: courseSummaries(courses, req.currentUser), total, page, pageSize, hasMore: page * pageSize < total };
  if (includeCategories) {
    response.categories = db.prepare(`
      SELECT DISTINCT c.category FROM courses c WHERE c.status = 'published' AND c.logical_course_id IS NULL AND (
        c.visibility = 'public' OR ? IN ('admin', 'moderator') OR
        EXISTS (SELECT 1 FROM course_grants g WHERE g.course_id = c.id AND g.user_id = ?)
      ) ORDER BY c.category COLLATE NOCASE
    `).all(req.currentUser.role, req.currentUser.id).map((row) => row.category);
  }
  res.json(response);
});

courseRouter.get('/my-learning', (req, res) => {
  const { courses, total, page, pageSize, hasMore } = accessibleLearningCoursePage(req.currentUser, req.query.page);
  const includeCertificates = enumQuery(req.query.includeCertificates, 'certificate option', ['0', '1'], '1');
  const certificateData = includeCertificates === '0' ? {} : learnerCertificatePage(req.currentUser.id, req.query.certificatesPage);
  res.json({ courses: courseSummaries(courses, req.currentUser), total, page, pageSize, hasMore, ...certificateData });
});

function learnerCertificatePage(userId, requestedPage) {
  const total = db.prepare('SELECT COUNT(*) AS count FROM course_certificates WHERE user_id = ?').get(userId).count;
  const { page, pageSize, offset, hasMore } = paginationWindow(total, requestedPage, 20);
  const certificates = db.prepare(`SELECT * FROM course_certificates WHERE user_id = ?
    ORDER BY issued_at DESC, id DESC LIMIT ? OFFSET ?`).all(userId, pageSize, offset).map(certificatePayload);
  return { certificates, certificatesTotal: total, certificatesPage: page, certificatesPageSize: pageSize, certificatesHasMore: hasMore };
}

courseRouter.get('/my-learning/certificates', (req, res) => {
  const { certificates, certificatesTotal, certificatesPage, certificatesPageSize, certificatesHasMore } = learnerCertificatePage(req.currentUser.id, req.query.page);
  res.json({ certificates, total: certificatesTotal, page: certificatesPage, pageSize: certificatesPageSize, hasMore: certificatesHasMore });
});

courseRouter.get('/manage/courses', requireStaff, (req, res) => {
  const query = textField(req.query.q, 'Search', 120);
  const status = enumQuery(req.query.status, 'course status', ['all', 'draft', 'published', 'archived'], 'all');
  const clauses = ['c.logical_course_id IS NULL'];
  const params = [];
  if (status === 'draft') {
    clauses.push(`(c.status = 'draft' OR (c.status = 'published' AND revision.revision_course_id IS NOT NULL))`);
  } else if (status !== 'all') {
    clauses.push('c.status = ?');
    params.push(status);
  }
  if (query) {
    const search = textSearchPredicate([
      'c.title', 'c.description', 'c.category',
      'draft.title', 'draft.description', 'draft.category',
    ], query);
    clauses.push(`(${search.sql})`);
    params.push(...search.params);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const from = `FROM courses c JOIN users u ON u.id = c.created_by
    LEFT JOIN course_revisions revision ON revision.course_id = c.id
    LEFT JOIN courses draft ON draft.id = revision.revision_course_id`;
  const total = db.prepare(`SELECT COUNT(*) AS count ${from} ${where}`).get(...params).count;
  const { page, pageSize, offset } = paginationWindow(total, req.query.page, 50);
  const rows = db.prepare(`
    SELECT c.*, u.username AS owner,
      revision.revision_course_id, revision.review_status,
      draft.title AS draft_title, draft.description AS draft_description, draft.category AS draft_category,
      draft.visibility AS draft_visibility, draft.cover_media_id AS draft_cover_media_id,
      draft.updated_at AS draft_updated_at
    ${from} ${where} ORDER BY COALESCE(draft.updated_at, c.updated_at) DESC, c.id ASC LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset);
  const courses = courseSummaries(rows, req.currentUser).map((course, index) => {
    const row = rows[index];
    const hasUnpublishedChanges = Boolean(row.revision_course_id);
    if (!hasUnpublishedChanges) return { ...course, hasUnpublishedChanges: false };
    return {
      ...course,
      title: row.draft_title,
      description: row.draft_description,
      category: row.draft_category,
      visibility: row.draft_visibility,
      coverMediaId: row.draft_cover_media_id,
      coverUrl: row.draft_cover_media_id ? `/media/${row.draft_cover_media_id}` : null,
      updatedAt: row.draft_updated_at,
      hasUnpublishedChanges: true,
      reviewStatus: row.review_status || 'draft',
    };
  });
  res.json({ courses, total, page, pageSize });
});

courseRouter.get('/courses/:courseId', (req, res) => {
  const course = requireCourseViewer(req.params.courseId, req.currentUser);
  res.json({ course: getCoursePayload(course, req.currentUser) });
});

courseRouter.get('/certificates/:certificateRef', (req, res) => {
  const saved = db.prepare('SELECT * FROM course_certificates WHERE id = ? AND user_id = ?')
    .get(req.params.certificateRef, req.currentUser.id);
  if (saved) return res.json({ certificate: certificatePayload(saved) });
  const existing = findCourseCertificate(req.params.certificateRef, req.currentUser.id);
  if (existing) return res.json({ certificate: certificatePayload(existing) });
  if (req.currentUser.role !== 'learner') fail(403, 'Only learners can earn course certificates.', 'forbidden');
  const course = requireCourseViewer(req.params.certificateRef, req.currentUser);
  if (course.status !== 'published') fail(404, 'Course not found.', 'not_found');
  const certificate = issueCertificateIfComplete(course.id, req.currentUser);
  if (!certificate && courseSummary(course, req.currentUser).completed
      && (!req.currentUser.first_name?.trim() || !req.currentUser.last_name?.trim())) {
    fail(409, 'Add your first and last name in Account settings to receive your certificate.', 'certificate_name_required');
  }
  if (!certificate) fail(409, 'Complete all lessons and pass the required quizzes to earn this certificate.', 'course_incomplete');
  res.json({ certificate });
});

courseRouter.get('/lessons/:lessonId/watch-progress', async (req, res) => {
  const lesson = courseFromLesson(req.params.lessonId);
  if (!lesson) fail(404, 'Lesson not found.', 'not_found');
  requireCourseViewer(lesson.id, req.currentUser);
  if (lesson.status !== 'published' || !lesson.media_id) fail(404, 'Lesson video is not available.', 'not_found');
  if (req.currentUser.role === 'learner' && !isLessonUnlocked(lesson.lesson_id, req.currentUser)) {
    fail(423, 'Complete the previous lesson before opening this one.', 'lesson_locked');
  }
  const duration = await verifiedVideoDuration(lesson);
  res.json(getLessonWatchProgress(req.currentUser, lesson.lesson_id, duration));
});

courseRouter.post('/lessons/:lessonId/watch-progress/start', async (req, res) => {
  const lesson = requireWatchableLesson(req.params.lessonId, req.currentUser);
  const duration = await verifiedVideoDuration(lesson);
  res.json(beginLessonWatch(req.currentUser, lesson.lesson_id, duration));
});

courseRouter.post('/lessons/:lessonId/watch-progress/rewind', (req, res) => {
  const lesson = requireWatchableLesson(req.params.lessonId, req.currentUser);
  res.json(rewindLessonWatch(req.currentUser, lesson.lesson_id, req.body?.positionSeconds));
});

courseRouter.put('/lessons/:lessonId/watch-progress', (req, res) => {
  const lesson = requireWatchableLesson(req.params.lessonId, req.currentUser);
  const progress = recordLessonWatchProgress(req.currentUser, lesson.lesson_id, req.body?.positionSeconds);
  if (progress.shouldLogAnomaly) {
    writeSystemLog('warn', 'lesson-watch', 'Rejected implausible video progress', {
      userId: req.currentUser.id,
      username: req.currentUser.username,
      role: req.currentUser.role,
      courseId: lesson.id,
      lessonId: lesson.lesson_id,
      anomaly: progress.anomaly,
      reportedPositionSeconds: progress.reportedPositionSeconds,
      lastAcceptedPositionSeconds: progress.lastAcceptedPositionSeconds,
      maximumCrediblePositionSeconds: progress.maximumCrediblePositionSeconds,
      rejectedAttemptCount: progress.rejectedAttemptCount,
      watchedSeconds: progress.watchedSeconds,
      durationSeconds: progress.durationSeconds,
    });
  }
  const response = { ...progress };
  delete response.shouldLogAnomaly;
  delete response.anomaly;
  delete response.reportedPositionSeconds;
  delete response.lastAcceptedPositionSeconds;
  delete response.maximumCrediblePositionSeconds;
  delete response.rejectedAttemptCount;
  delete response.watchedSeconds;
  res.json(response);
});

courseRouter.get('/manage/courses/:courseId', requireStaff, (req, res) => {
  const course = requireCourseManager(req.params.courseId, req.currentUser);
  res.json({ course: getCoursePayload(course, req.currentUser, { includeAnswers: true }) });
});

courseRouter.get('/manage/courses/:courseId/analytics', requireStaff, (req, res) => {
  const courseId = logicalCourseId(req.params.courseId) || req.params.courseId;
  const catalogCourse = canonicalCourse(courseId);
  if (!catalogCourse) fail(404, 'Course not found.', 'not_found');
  const latestPublishedVersion = publishedVersion(courseId);
  // Analytics describe the content learners can currently access. Resolving the
  // editable copy here created a draft as a side effect and detached the
  // response identity and lesson IDs from the published course.
  const course = latestPublishedVersion
    ? db.prepare('SELECT * FROM courses WHERE id = ?').get(latestPublishedVersion.storage_course_id)
    : catalogCourse;
  const pageSize = 50;
  const eligibleLearners = `SELECT u.id, u.username, u.disabled FROM (
    SELECT user_id AS id FROM enrollments WHERE course_id = ?
    UNION SELECT user_id FROM course_grants WHERE course_id = ?
  ) member CROSS JOIN users u ON u.id = member.id WHERE u.role = 'learner'`;
  const learnerTotals = db.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(disabled), 0) AS disabled_count
    FROM (${eligibleLearners})`).get(courseId, courseId);
  const { page, pageSize: responsePageSize, offset } = paginationWindow(learnerTotals.total, req.query.page, pageSize);
  const learnerRows = db.prepare(`
    WITH eligible AS (${eligibleLearners})
    SELECT eligible.id, eligible.username, eligible.disabled, e.enrolled_at, g.granted_at
    FROM eligible
    LEFT JOIN enrollments e ON e.course_id = ? AND e.user_id = eligible.id
    LEFT JOIN course_grants g ON g.course_id = ? AND g.user_id = eligible.id
    ORDER BY eligible.username COLLATE NOCASE, eligible.id ASC LIMIT ? OFFSET ?
  `).all(courseId, courseId, courseId, courseId, responsePageSize, offset);
  const lessons = db.prepare(`
    SELECT l.id, l.title, l.position, m.id AS module_id, m.title AS module_title, m.position AS module_position
    FROM lessons l JOIN course_modules m ON m.id = l.module_id
    WHERE m.course_id = ? ORDER BY m.position, m.id, l.position, l.id
  `).all(course.id);
  const quizzes = db.prepare(`
    SELECT q.id, q.title, q.pass_mark, m.id AS module_id, m.title AS module_title, m.position AS module_position
    FROM quizzes q JOIN course_modules m ON m.id = q.module_id
    WHERE m.course_id = ? ORDER BY m.position, m.id, q.id
  `).all(course.id);

  const requiredItemCount = lessons.length + quizzes.length;
  const globalProgress = db.prepare(`
    WITH eligible AS (
      ${eligibleLearners}
    ),
    lesson_by_user AS (
      SELECT lp.user_id, COUNT(*) AS lesson_completions
      FROM lesson_progress lp JOIN lessons l ON l.id = lp.lesson_id
      JOIN course_modules m ON m.id = l.module_id JOIN eligible e ON e.id = lp.user_id
      WHERE m.course_id = ? GROUP BY lp.user_id
    ),
    quiz_by_user AS (
      SELECT a.user_id, a.quiz_id, COUNT(*) AS attempts, MAX(a.passed) AS passed
      FROM quiz_attempts a JOIN quizzes q ON q.id = a.quiz_id
      JOIN course_modules m ON m.id = q.module_id JOIN eligible e ON e.id = a.user_id
      WHERE m.course_id = ? GROUP BY a.user_id, a.quiz_id
    ),
    quiz_totals_by_user AS (
      SELECT user_id, SUM(passed) AS passed_quizzes, SUM(attempts) AS quiz_attempts
      FROM quiz_by_user GROUP BY user_id
    ),
    learner_progress AS (
      SELECT e.id,
        COALESCE(l.lesson_completions, 0) AS lesson_completions,
        COALESCE(q.passed_quizzes, 0) AS passed_quizzes,
        COALESCE(q.quiz_attempts, 0) AS quiz_attempts
      FROM eligible e
      LEFT JOIN lesson_by_user l ON l.user_id = e.id
      LEFT JOIN quiz_totals_by_user q ON q.user_id = e.id
    )
    SELECT
      COALESCE(SUM(CASE WHEN lesson_completions + passed_quizzes > 0 OR quiz_attempts > 0 THEN 1 ELSE 0 END), 0) AS started_count,
      COALESCE(SUM(CASE WHEN ? > 0 AND lesson_completions + passed_quizzes = ? THEN 1 ELSE 0 END), 0) AS completed_count,
      ROUND(AVG(CASE WHEN ? > 0 THEN ROUND((lesson_completions + passed_quizzes) * 100.0 / ?) ELSE 0 END)) AS average_progress,
      COALESCE(SUM(lesson_completions), 0) AS lesson_completions,
      COALESCE(SUM(quiz_attempts), 0) AS quiz_attempts
    FROM learner_progress
  `).get(courseId, courseId, course.id, course.id,
    requiredItemCount, requiredItemCount, requiredItemCount, requiredItemCount);

  const lessonCompletionCounts = db.prepare(`
    WITH eligible AS (
      ${eligibleLearners}
    )
    SELECT l.id, COUNT(lp.user_id) AS completed_count
    FROM lessons l JOIN course_modules m ON m.id = l.module_id
    LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id
    LEFT JOIN eligible e ON e.id = lp.user_id
    WHERE m.course_id = ? AND (lp.user_id IS NULL OR e.id IS NOT NULL)
    GROUP BY l.id
  `).all(courseId, courseId, course.id);
  const lessonCompletionById = new Map(lessonCompletionCounts.map((row) => [row.id, row.completed_count]));
  const quizTotals = db.prepare(`
    WITH eligible AS (
      ${eligibleLearners}
    ),
    learner_quiz AS (
      SELECT a.quiz_id, a.user_id, COUNT(*) AS attempts, MAX(a.passed) AS passed, AVG(a.score) AS average_score
      FROM quiz_attempts a JOIN quizzes aq ON aq.id = a.quiz_id
      JOIN course_modules am ON am.id = aq.module_id JOIN eligible e ON e.id = a.user_id
      WHERE am.course_id = ? GROUP BY a.quiz_id, a.user_id
    )
    SELECT q.id,
      COALESCE(SUM(lq.attempts), 0) AS attempts,
      COUNT(lq.user_id) AS learners_attempted,
      COALESCE(SUM(lq.passed), 0) AS learners_passed,
      CASE WHEN SUM(lq.attempts) > 0 THEN ROUND(SUM(lq.average_score * lq.attempts) / SUM(lq.attempts)) ELSE NULL END AS average_score
    FROM quizzes q JOIN course_modules m ON m.id = q.module_id
    LEFT JOIN learner_quiz lq ON lq.quiz_id = q.id
    WHERE m.course_id = ? GROUP BY q.id
  `).all(courseId, courseId, course.id, course.id);
  const quizTotalsById = new Map(quizTotals.map((row) => [row.id, row]));

  const progressByUser = new Map();
  const learnerIds = learnerRows.map((learner) => learner.id);
  if (learnerIds.length) for (const row of db.prepare(`
    SELECT lp.user_id, lp.lesson_id, lp.completed_at
    FROM lesson_progress lp JOIN lessons l ON l.id = lp.lesson_id
    JOIN course_modules m ON m.id = l.module_id
    WHERE m.course_id = ? AND lp.user_id IN (${learnerIds.map(() => '?').join(',')})
  `).all(course.id, ...learnerIds)) {
    const entries = progressByUser.get(row.user_id) ?? new Map();
    entries.set(row.lesson_id, row.completed_at);
    progressByUser.set(row.user_id, entries);
  }

  const quizResultsByUser = new Map();
  if (learnerIds.length) for (const row of db.prepare(`
    SELECT a.user_id, a.quiz_id, COUNT(*) AS attempts, MAX(a.score) AS highest_score,
      MAX(a.passed) AS passed,
      (SELECT latest.score FROM quiz_attempts latest WHERE latest.user_id = a.user_id AND latest.quiz_id = a.quiz_id
        ORDER BY latest.submitted_at DESC, latest.rowid DESC LIMIT 1) AS latest_score,
      (SELECT latest.passed FROM quiz_attempts latest WHERE latest.user_id = a.user_id AND latest.quiz_id = a.quiz_id
        ORDER BY latest.submitted_at DESC, latest.rowid DESC LIMIT 1) AS latest_passed,
      MAX(a.submitted_at) AS latest_submitted_at
    FROM quiz_attempts a JOIN quizzes q ON q.id = a.quiz_id
    JOIN course_modules m ON m.id = q.module_id
    WHERE m.course_id = ? AND a.user_id IN (${learnerIds.map(() => '?').join(',')})
    GROUP BY a.user_id, a.quiz_id
  `).all(course.id, ...learnerIds)) {
    const entries = quizResultsByUser.get(row.user_id) ?? new Map();
    entries.set(row.quiz_id, row);
    quizResultsByUser.set(row.user_id, entries);
  }

  const learners = learnerRows.map((learner) => {
    const completedLessons = progressByUser.get(learner.id) ?? new Map();
    const quizResults = quizResultsByUser.get(learner.id) ?? new Map();
    const lessonProgress = lessons.map((lesson) => ({
      id: lesson.id,
      title: lesson.title,
      moduleTitle: lesson.module_title,
      completedAt: completedLessons.get(lesson.id) ?? null,
      completed: completedLessons.has(lesson.id),
    }));
    const quizProgress = quizzes.map((quiz) => {
      const result = quizResults.get(quiz.id);
      return {
        id: quiz.id,
        title: quiz.title,
        moduleTitle: quiz.module_title,
        passMark: quiz.pass_mark,
        attempts: result?.attempts ?? 0,
        highestScore: result?.highest_score ?? null,
        latestScore: result?.latest_score ?? null,
        latestPassed: result ? Boolean(result.latest_passed) : null,
        passed: result ? Boolean(result.passed) : false,
        latestSubmittedAt: result?.latest_submitted_at ?? null,
      };
    });
    const completedLessonCount = lessonProgress.filter((lesson) => lesson.completed).length;
    const passedQuizCount = quizProgress.filter((quiz) => quiz.passed).length;
    const requiredItems = lessons.length + quizzes.length;
    const completedItems = completedLessonCount + passedQuizCount;
    const progress = requiredItems ? Math.round((completedItems / requiredItems) * 100) : 0;
    const activityDates = [
      ...lessonProgress.map((lesson) => lesson.completedAt),
      ...quizProgress.map((quiz) => quiz.latestSubmittedAt),
    ].filter(Boolean);
    const lastActivityAt = activityDates.reduce((latest, date) => !latest || date > latest ? date : latest, null);
    return {
      id: learner.id,
      username: learner.username,
      disabled: Boolean(learner.disabled),
      enrolledAt: learner.enrolled_at,
      assignedAt: learner.granted_at,
      completedLessonCount,
      lessonCount: lessons.length,
      passedQuizCount,
      quizCount: quizzes.length,
      progress,
      completed: requiredItems > 0 && completedItems === requiredItems,
      started: completedItems > 0 || quizProgress.some((quiz) => quiz.attempts > 0),
      lastActivityAt,
      lessonProgress,
      quizProgress,
    };
  });

  const lessonMetrics = lessons.map((lesson) => {
    const completedCount = lessonCompletionById.get(lesson.id) ?? 0;
    return { id: lesson.id, title: lesson.title, moduleTitle: lesson.module_title, completedCount,
      completionRate: learnerTotals.total ? Math.round((completedCount / learnerTotals.total) * 100) : null };
  });
  const quizMetrics = quizzes.map((quiz) => {
    const totals = quizTotalsById.get(quiz.id) ?? { attempts: 0, learners_attempted: 0, learners_passed: 0, average_score: null };
    return { id: quiz.id, title: quiz.title, moduleTitle: quiz.module_title, passMark: quiz.pass_mark,
      attempts: totals.attempts, learnersAttempted: totals.learners_attempted, learnersPassed: totals.learners_passed,
      participationRate: learnerTotals.total ? Math.round((totals.learners_attempted / learnerTotals.total) * 100) : null,
      passRate: totals.learners_attempted ? Math.round((totals.learners_passed / totals.learners_attempted) * 100) : null,
      averageScore: totals.average_score };
  });
  const summary = {
    learnerCount: learnerTotals.total,
    disabledLearnerCount: learnerTotals.disabled_count,
    startedLearnerCount: globalProgress.started_count,
    completedLearnerCount: globalProgress.completed_count,
    completionRate: learnerTotals.total ? Math.round((globalProgress.completed_count / learnerTotals.total) * 100) : null,
    averageProgress: learnerTotals.total ? globalProgress.average_progress : null,
    lessonCount: lessons.length,
    quizCount: quizzes.length,
    lessonCompletions: globalProgress.lesson_completions,
    quizAttempts: globalProgress.quiz_attempts,
  };
  res.json({
    course: { id: courseId, title: catalogCourse.title, category: catalogCourse.category, status: catalogCourse.status, visibility: catalogCourse.visibility },
    summary,
    lessonMetrics,
    quizMetrics,
    learners,
    page,
    pageSize: responsePageSize,
  });
});

courseRouter.post('/courses/:courseId/enroll', (req, res) => {
  // Keep eligibility, enrollment, and initial learning state in one transaction.
  const enroll = db.transaction(() => {
    const course = requireCourseViewer(req.params.courseId, req.currentUser);
    if (!canLearnerAccess(course, req.currentUser) || course.status !== 'published') fail(403, 'You do not have access to this course.', 'course_access_denied');
    enrollLearner(course.id, req.currentUser.id);
  });
  enroll.immediate();
  res.status(201).json({ ok: true });
});

courseRouter.post('/manage/courses', requireStaff, (req, res) => {
  const body = requireObjectBody(req.body, 'Course details');
  const title = textField(body.title ?? 'Untitled course', 'Course title', 160, { required: true });
  const description = textField(body.description, 'Description', 6000);
  const category = textField(body.category ?? 'General', 'Category', 100, { required: true });
  const visibility = body.visibility === undefined ? 'public' : body.visibility;
  if (!['public', 'private'].includes(visibility)) fail(400, 'Visibility must be public or private.', 'validation_error');
  const id = randomUUID();
  // Include response reads in the create transaction so a failed read leaves no partial creation.
  const createCourse = db.transaction(() => {
    db.prepare(`INSERT INTO courses (id, title, description, category, visibility, status, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`)
      .run(id, title, description, category, visibility, req.currentUser.id, req.currentUser.id);
    const auditId = writeAuditLog({ actor: req.currentUser, action: 'course.created', entityType: 'course', entityId: id,
      summary: `Created course: ${title}`, details: { category, visibility, status: 'draft' } });
    if (!auditId) fail(500, 'Course could not be created because the audit log is unavailable.', 'audit_unavailable');
    return getCoursePayload(db.prepare('SELECT * FROM courses WHERE id = ?').get(id), req.currentUser, { includeAnswers: true });
  });
  const course = createCourse.immediate();
  res.status(201).json({ course });
});

courseRouter.patch('/manage/courses/:courseId', requireStaff, (req, res) => {
  const body = requireObjectBody(req.body, 'Course changes');
  // Build the editor payload before commit so a read failure rolls back the save and audit entry.
  function buildEditorPayload(course, storageCourseId) {
    return getCoursePayload(course, req.currentUser, {
      includeAnswers: true,
      ...(storageCourseId ? { storageCourseId } : {}),
    });
  }

  const saveCourse = db.transaction(() => {
    const current = requireCourseManager(req.params.courseId, req.currentUser);
    const title = body.title === undefined ? current.title : textField(body.title, 'Course title', 160, { required: true });
    const description = body.description === undefined ? current.description : textField(body.description, 'Description', 6000);
    const category = body.category === undefined ? current.category : textField(body.category, 'Category', 100, { required: true });
    const visibility = body.visibility === undefined ? current.visibility : body.visibility;
    const status = body.status === undefined ? current.status : body.status;
    const completionWindowDays = body.completionWindowDays === undefined ? (current.completion_window_days ?? null) : body.completionWindowDays;
    const requiresRecompletion = body.requiresRecompletion === undefined ? false : booleanField(body.requiresRecompletion, 'Recompletion option');
    if (!['public', 'private'].includes(visibility)) fail(400, 'Visibility must be public or private.', 'validation_error');
    if (!['draft', 'published', 'archived'].includes(status)) fail(400, 'Choose a valid course status.', 'validation_error');
    if (completionWindowDays !== null && (!Number.isSafeInteger(completionWindowDays) || completionWindowDays < 1 || completionWindowDays > 3650)) {
      fail(400, 'Completion time must be between 1 and 3,650 days, or left blank.', 'validation_error');
    }
    const logicalId = current.logical_course_id || current.id;
    const canonical = canonicalCourse(logicalId);
    if (!canonical) fail(404, 'Course not found.', 'not_found');
    if (visibility === 'private' && db.prepare(`SELECT 1 FROM learning_path_courses pc JOIN learning_paths p ON p.id = pc.path_id
      WHERE pc.course_id = ? AND p.status = 'published' AND p.self_enrollment = 1 LIMIT 1`).get(logicalId)) {
      fail(409, 'This course is in a self-enrollable path. Remove it from that path before making it private.', 'course_in_public_self_enrollment_path');
    }
    if (status === 'published') {
      const changeNote = body.changeNote === undefined ? '' : textField(body.changeNote, 'Publication note', 500);
      const revision = db.prepare('SELECT * FROM course_revisions WHERE course_id = ?').get(logicalId);
      if (revision?.review_status === 'in_review' && revision.submitted_by === req.currentUser.id) {
        fail(409, 'This revision is awaiting independent review. A different staff member must approve it.', 'review_pending');
      }
      db.prepare(`UPDATE courses SET title = ?, description = ?, category = ?, visibility = ?, completion_window_days = ?,
        updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(title, description, category, visibility, completionWindowDays, req.currentUser.id, current.id);
      const readyCourse = db.prepare('SELECT * FROM courses WHERE id = ?').get(current.id);
      assertPublishable(readyCourse.id);
      const version = publishRevision(logicalId, req.currentUser, {
        requiresRecompletion,
        changeNote,
      });
      if (!version) fail(404, 'Course could not be published.', 'not_found');
      const auditId = writeAuditLog({ actor: req.currentUser, action: 'course.published', entityType: 'course', entityId: logicalId,
        summary: `Published ${title} as version ${version.version_number}`, details: { versionId: version.id, version: version.version_number, requiresRecompletion } });
      if (!auditId) fail(500, 'Course could not be published because the audit log is unavailable.', 'audit_unavailable');
      const updated = db.prepare('SELECT * FROM courses WHERE id = ?').get(logicalId);
      const contentCourse = db.prepare('SELECT * FROM courses WHERE id = ?').get(version.storage_course_id);
      return { course: buildEditorPayload(updated, contentCourse.id) };
    }
    if (status === 'archived' && db.prepare("SELECT 1 FROM learning_path_courses pc JOIN learning_paths p ON p.id = pc.path_id WHERE pc.course_id = ? AND p.status = 'published' LIMIT 1").get(logicalId)) {
      fail(409, 'Remove this course from published learning paths before archiving it.', 'course_in_published_path');
    }
    const nextValues = { title, description, category, visibility, completion_window_days: completionWindowDays };
    const changedFields = Object.keys(nextValues).filter((field) => current[field] !== nextValues[field]);
    let updated = current;
    if (changedFields.length) {
      db.prepare(`UPDATE courses SET title = ?, description = ?, category = ?, visibility = ?, completion_window_days = ?,
          updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(title, description, category, visibility, completionWindowDays, req.currentUser.id, current.id);
      updated = db.prepare('SELECT * FROM courses WHERE id = ?').get(current.id);
      const auditId = writeAuditLog({ actor: req.currentUser, action: 'course.updated', entityType: 'course', entityId: logicalId,
        summary: `Updated course revision: ${title}`,
        details: { changedFields, category, visibility, status } });
      if (!auditId) fail(500, 'Course could not be updated because the audit log is unavailable.', 'audit_unavailable');
    }
    const unpublish = status === 'draft' && body.unpublish === true;
    if (status === 'archived' || unpublish || (status === 'draft' && canonical.status === 'archived')) {
      db.prepare(`UPDATE courses SET status = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(status, req.currentUser.id, logicalId);
      const auditId = writeAuditLog({ actor: req.currentUser, action: status === 'archived' ? 'course.archived' : 'course.unpublished',
        entityType: 'course', entityId: logicalId, summary: `${status === 'archived' ? 'Archived' : 'Unpublished'} ${canonical.title}` });
      if (!auditId) fail(500, 'Course status could not be changed because the audit log is unavailable.', 'audit_unavailable');
    }
    return { course: buildEditorPayload(updated) };
  });
  const { course } = saveCourse.immediate();
  res.json({ course });
});

courseRouter.delete('/manage/courses/:courseId', requireStaff, async (req, res) => {
  const deleteCourse = db.transaction(() => {
    const course = canonicalCourse(req.params.courseId);
    if (!course) fail(404, 'Course not found.', 'not_found');
    if (course.status !== 'archived') fail(409, 'Archive this course before permanently deleting it.', 'archive_required');
    const directory = courseFileDirectory(course.id);
    db.prepare('DELETE FROM courses WHERE id = ?').run(course.id);
    const auditId = writeAuditLog({ actor: req.currentUser, action: 'course.deleted', entityType: 'course', entityId: course.id,
      summary: `Permanently deleted course: ${course.title}` });
    if (!auditId) fail(500, 'Course could not be deleted because the audit log is unavailable.', 'audit_unavailable');
    return { courseId: course.id, directory };
  });
  const { courseId, directory } = deleteCourse.immediate();
  try {
    await fs.promises.rm(directory, { recursive: true, force: true });
  } catch (error) {
    writeSystemLog('error', 'media', 'Course records were deleted but media cleanup failed', {
      courseId,
      errorName: String(error?.name || 'Error').slice(0, 100),
      errorCode: typeof error?.code === 'string' ? error.code.slice(0, 100) : undefined,
    });
  }
  res.status(204).end();
});

courseRouter.post('/manage/courses/:courseId/modules', requireStaff, (req, res) => {
  const title = textField(req.body?.title, 'Module title', 160, { required: true });
  const id = randomUUID();
  const createModule = db.transaction(() => {
    const course = requireCourseManager(req.params.courseId, req.currentUser);
    const position = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM course_modules WHERE course_id = ?').get(course.id).next;
    db.prepare('INSERT INTO course_modules (id, course_id, title, position) VALUES (?, ?, ?, ?)').run(id, course.id, title, position);
    db.prepare('UPDATE courses SET updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.currentUser.id, course.id);
    const auditId = writeAuditLog({ actor: req.currentUser, action: 'course.module_created', entityType: 'module', entityId: id,
      summary: `Added module "${title}" to ${course.title}`, details: { courseId: course.id } });
    if (!auditId) fail(500, 'Module could not be created because the audit log is unavailable.', 'audit_unavailable');
    return { courseId: course.id, position };
  });
  const { courseId, position } = createModule.immediate();
  res.status(201).json({ module: { id, courseId, title, position } });
});

courseRouter.patch('/manage/modules/:moduleId', requireStaff, (req, res) => {
  const module = moduleCourse(req.params.moduleId);
  if (!module) fail(404, 'Module not found.', 'not_found');
  requireCourseManager(module.id, req.currentUser);
  const title = textField(req.body?.title, 'Module title', 160, { required: true });
  const updateModule = db.transaction(() => {
    const current = moduleCourse(req.params.moduleId);
    if (!current) fail(404, 'Module not found.', 'not_found');
    requireCourseManager(current.id, req.currentUser);
    if (current.module_title === title) return null;
    db.prepare('UPDATE course_modules SET title = ? WHERE id = ?').run(title, current.module_id);
    db.prepare('UPDATE courses SET updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.currentUser.id, current.id);
    const auditId = writeAuditLog({ actor: req.currentUser, action: 'course.module_updated', entityType: 'module', entityId: current.module_id,
      summary: `Renamed a module in ${current.title} to "${title}"`, details: { courseId: current.id } });
    if (!auditId) fail(500, 'Module could not be renamed because the audit log is unavailable.', 'audit_unavailable');
    return current;
  });
  updateModule.immediate();
  res.json({ ok: true });
});

courseRouter.delete('/manage/modules/:moduleId', requireStaff, async (req, res) => {
  const deleteModule = db.transaction(() => {
    const module = moduleCourse(req.params.moduleId);
    if (!module) fail(404, 'Module not found.', 'not_found');
    requireCourseManager(module.id, req.currentUser);
    const media = db.prepare(`SELECT mf.id, mf.file_name FROM media_files mf WHERE mf.course_id = ? AND mf.id IN (
      SELECT l.media_id FROM lessons l WHERE l.module_id = ? AND l.media_id IS NOT NULL
    )`).all(module.id, module.module_id);
    const documents = db.prepare(`
      SELECT lr.id, lr.file_name FROM lesson_resources lr JOIN lessons l ON l.id = lr.lesson_id
      WHERE l.module_id = ? AND lr.resource_type = 'document'
    `).all(module.module_id);
    const captions = db.prepare(`
      SELECT lc.id, lc.file_name FROM lesson_captions lc JOIN lessons l ON l.id = lc.lesson_id
      WHERE l.module_id = ?
    `).all(module.module_id);
    db.prepare('DELETE FROM course_modules WHERE id = ?').run(module.module_id);
    for (const item of media) db.prepare('DELETE FROM media_files WHERE id = ?').run(item.id);
    db.prepare('UPDATE courses SET updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.currentUser.id, module.id);
    const auditId = writeAuditLog({ actor: req.currentUser, action: 'course.module_deleted', entityType: 'module', entityId: module.module_id,
      summary: `Deleted a module from ${module.title}` });
    if (!auditId) fail(500, 'Module could not be deleted because the audit log is unavailable.', 'audit_unavailable');
    return { module, media, documents, captions };
  });
  const { module, media, documents, captions } = deleteModule.immediate();
  for (const item of media) {
    await removeCourseMediaFile(module.id, item.file_name, 'Module video cleanup failed after module deletion', {
      moduleId: module.module_id,
      mediaId: item.id,
    });
  }
  for (const item of documents) {
    await removeCourseMediaFile(module.id, item.file_name, 'Module document cleanup failed after module deletion', {
      moduleId: module.module_id,
      resourceId: item.id,
    });
  }
  for (const item of captions) {
    await removeCourseMediaFile(module.id, item.file_name, 'Module caption cleanup failed after module deletion', {
      moduleId: module.module_id,
      captionId: item.id,
    });
  }
  res.status(204).end();
});

courseRouter.post('/manage/modules/:moduleId/lessons', requireStaff, (req, res) => {
  const module = moduleCourse(req.params.moduleId);
  if (!module) fail(404, 'Module not found.', 'not_found');
  requireCourseManager(module.id, req.currentUser);
  const title = textField(req.body?.title, 'Lesson title', 160, { required: true });
  const id = randomUUID();
  const createLesson = db.transaction(() => {
    const currentModule = moduleCourse(req.params.moduleId);
    if (!currentModule) fail(404, 'Module not found.', 'not_found');
    requireCourseManager(currentModule.id, req.currentUser);
    const position = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM lessons WHERE module_id = ?').get(currentModule.module_id).next;
    db.prepare('INSERT INTO lessons (id, module_id, title, position) VALUES (?, ?, ?, ?)').run(id, currentModule.module_id, title, position);
    db.prepare('UPDATE courses SET updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.currentUser.id, currentModule.id);
    const auditId = writeAuditLog({ actor: req.currentUser, action: 'course.lesson_created', entityType: 'lesson', entityId: id,
      summary: `Added lesson "${title}"`, details: { courseId: currentModule.id, moduleId: currentModule.module_id } });
    if (!auditId) fail(500, 'Lesson could not be created because the audit log is unavailable.', 'audit_unavailable');
    return { module: currentModule, position };
  });
  const { module: createdInModule, position } = createLesson.immediate();
  res.status(201).json({ lesson: { id, moduleId: createdInModule.module_id, title, position, hasVideo: false } });
});

courseRouter.patch('/manage/lessons/:lessonId', requireStaff, (req, res) => {
  const body = requireObjectBody(req.body, 'Lesson changes');
  const lesson = courseFromLesson(req.params.lessonId);
  if (!lesson) fail(404, 'Lesson not found.', 'not_found');
  requireCourseManager(lesson.id, req.currentUser);
  const requestedTitle = body.title === undefined ? undefined : textField(body.title, 'Lesson title', 160, { required: true });
  const requestedDescription = body.description === undefined ? undefined : textField(body.description, 'Lesson description', 2000);
  const requestedTranscript = body.transcript === undefined ? undefined : textField(body.transcript, 'Lesson transcript', 50000);
  const updateLesson = db.transaction(() => {
    const current = courseFromLesson(req.params.lessonId);
    if (!current) fail(404, 'Lesson not found.', 'not_found');
    requireCourseManager(current.id, req.currentUser);
    const title = requestedTitle === undefined ? current.lesson_title : requestedTitle;
    const description = requestedDescription === undefined ? current.lesson_description : requestedDescription;
    const transcript = requestedTranscript === undefined ? current.lesson_transcript : requestedTranscript;
    const changedFields = [
      title !== current.lesson_title ? 'title' : null,
      description !== current.lesson_description ? 'description' : null,
      transcript !== current.lesson_transcript ? 'transcript' : null,
    ].filter(Boolean);
    if (!changedFields.length) return null;
    db.prepare('UPDATE lessons SET title = ?, description = ?, transcript = ? WHERE id = ?').run(title, description, transcript, current.lesson_id);
    db.prepare('UPDATE courses SET updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.currentUser.id, current.id);
    const auditId = writeAuditLog({ actor: req.currentUser, action: 'course.lesson_updated', entityType: 'lesson', entityId: current.lesson_id,
      summary: `Updated lesson: ${title}`, details: { courseId: current.id, changedFields } });
    if (!auditId) fail(500, 'Lesson could not be updated because the audit log is unavailable.', 'audit_unavailable');
    return { lesson: current, title, changedFields };
  });
  updateLesson.immediate();
  res.json({ ok: true });
});

courseRouter.post('/manage/lessons/:lessonId/resources', requireStaff, (req, res) => {
  const lesson = courseFromLesson(req.params.lessonId);
  if (!lesson) fail(404, 'Lesson not found.', 'not_found');
  requireCourseManager(lesson.id, req.currentUser);
  const title = textField(req.body?.title, 'Resource title', 160, { required: true });
  const rawUrl = textField(req.body?.url, 'Link URL', 2048, { required: true });
  const urlValidation = validateLessonResourceUrl(rawUrl);
  if (urlValidation.error) fail(400, urlValidation.error, 'validation_error');
  const { url } = urlValidation;
  const id = randomUUID();
  const createResource = db.transaction(() => {
    const currentLesson = courseFromLesson(req.params.lessonId);
    if (!currentLesson) fail(404, 'Lesson not found.', 'not_found');
    requireCourseManager(currentLesson.id, req.currentUser);
    const position = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM lesson_resources WHERE lesson_id = ?').get(currentLesson.lesson_id).next;
    db.prepare(`INSERT INTO lesson_resources (id, lesson_id, resource_type, title, href, position)
      VALUES (?, ?, 'link', ?, ?, ?)`).run(id, currentLesson.lesson_id, title, url.href, position);
    db.prepare('UPDATE courses SET updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.currentUser.id, currentLesson.id);
    const auditId = writeAuditLog({ actor: req.currentUser, action: 'course.resource_link_added', entityType: 'lesson', entityId: currentLesson.lesson_id,
      summary: `Added a resource link to ${currentLesson.lesson_title}`, details: { courseId: currentLesson.id, title } });
    if (!auditId) fail(500, 'Resource link could not be added because the audit log is unavailable.', 'audit_unavailable');
    return currentLesson;
  });
  createResource.immediate();
  res.status(201).json({ resource: { id, kind: 'link', title, url: url.href, fileName: null } });
});

courseRouter.delete('/manage/lessons/:lessonId/resources/:resourceId', requireStaff, async (req, res) => {
  const removeResource = db.transaction(() => {
    const lesson = courseFromLesson(req.params.lessonId);
    if (!lesson) fail(404, 'Lesson not found.', 'not_found');
    requireCourseManager(lesson.id, req.currentUser);
    const resource = db.prepare('SELECT * FROM lesson_resources WHERE id = ? AND lesson_id = ?')
      .get(req.params.resourceId, lesson.lesson_id);
    if (!resource) fail(404, 'Lesson resource not found.', 'not_found');
    db.prepare('DELETE FROM lesson_resources WHERE id = ?').run(resource.id);
    db.prepare('UPDATE courses SET updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.currentUser.id, lesson.id);
    const auditId = writeAuditLog({ actor: req.currentUser, action: 'course.resource_removed', entityType: 'lesson', entityId: lesson.lesson_id,
      summary: `Removed a resource from ${lesson.lesson_title}`, details: { courseId: lesson.id, title: resource.title, resourceType: resource.resource_type } });
    if (!auditId) fail(500, 'Resource could not be removed because the audit log is unavailable.', 'audit_unavailable');
    return { lesson, resource };
  });
  const { lesson, resource } = removeResource.immediate();
  if (resource.resource_type === 'document') {
    await removeCourseMediaFile(lesson.id, resource.file_name, 'Lesson document cleanup failed after resource removal', {
      lessonId: lesson.lesson_id,
      resourceId: resource.id,
    });
  }
  res.status(204).end();
});

courseRouter.delete('/manage/lessons/:lessonId', requireStaff, async (req, res) => {
  const removeLesson = db.transaction(() => {
    const lesson = courseFromLesson(req.params.lessonId);
    if (!lesson) fail(404, 'Lesson not found.', 'not_found');
    requireCourseManager(lesson.id, req.currentUser);
    const media = lesson.media_id ? db.prepare('SELECT file_name FROM media_files WHERE id = ?').get(lesson.media_id) : null;
    const documents = db.prepare("SELECT id, file_name FROM lesson_resources WHERE lesson_id = ? AND resource_type = 'document'").all(lesson.lesson_id);
    const captions = db.prepare('SELECT id, file_name FROM lesson_captions WHERE lesson_id = ?').all(lesson.lesson_id);
    db.prepare('DELETE FROM lessons WHERE id = ?').run(lesson.lesson_id);
    if (media) db.prepare('DELETE FROM media_files WHERE id = ?').run(lesson.media_id);
    db.prepare('UPDATE courses SET updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.currentUser.id, lesson.id);
    const auditId = writeAuditLog({ actor: req.currentUser, action: 'course.lesson_deleted', entityType: 'lesson', entityId: lesson.lesson_id,
      summary: `Deleted lesson: ${lesson.lesson_title}`, details: { courseId: lesson.id } });
    if (!auditId) fail(500, 'Lesson could not be deleted because the audit log is unavailable.', 'audit_unavailable');
    return { lesson, media, documents, captions };
  });
  const { lesson, media, documents, captions } = removeLesson.immediate();
  if (media) await removeCourseMediaFile(lesson.id, media.file_name, 'Lesson video cleanup failed after lesson deletion', {
    lessonId: lesson.lesson_id,
    mediaId: lesson.media_id,
  });
  for (const item of documents) await removeCourseMediaFile(lesson.id, item.file_name, 'Lesson document cleanup failed after lesson deletion', {
    lessonId: lesson.lesson_id,
    resourceId: item.id,
  });
  for (const item of captions) await removeCourseMediaFile(lesson.id, item.file_name, 'Lesson caption cleanup failed after lesson deletion', {
    lessonId: lesson.lesson_id,
    captionId: item.id,
  });
  res.status(204).end();
});

courseRouter.post('/manage/modules/:moduleId/move', requireStaff, (req, res) => {
  const module = moduleCourse(req.params.moduleId);
  if (!module) fail(404, 'Module not found.', 'not_found');
  requireCourseManager(module.id, req.currentUser);
  const direction = req.body?.direction;
  if (!['up', 'down'].includes(direction)) fail(400, 'Choose up or down.', 'validation_error');
  const move = db.transaction(() => {
    const currentModule = moduleCourse(req.params.moduleId);
    if (!currentModule) fail(404, 'Module not found.', 'not_found');
    requireCourseManager(currentModule.id, req.currentUser);
    const modules = db.prepare('SELECT id, position FROM course_modules WHERE course_id = ? ORDER BY position, id').all(currentModule.id);
    const index = modules.findIndex((item) => item.id === currentModule.module_id);
    if (index < 0) return false;
    const current = modules[index];
    const other = modules[index + (direction === 'up' ? -1 : 1)];
    if (!other) return false;
    const temporaryPosition = modules.reduce((maximum, item) => Math.max(maximum, item.position), 0) + 1;
    db.prepare('UPDATE course_modules SET position = ? WHERE id = ?').run(temporaryPosition, current.id);
    db.prepare('UPDATE course_modules SET position = ? WHERE id = ?').run(current.position, other.id);
    db.prepare('UPDATE course_modules SET position = ? WHERE id = ?').run(other.position, current.id);
    db.prepare('UPDATE courses SET updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.currentUser.id, currentModule.id);
    const auditId = writeAuditLog({ actor: req.currentUser, action: 'course.module_reordered', entityType: 'course', entityId: currentModule.id,
      summary: `Reordered modules in ${currentModule.title}`, details: { direction } });
    if (!auditId) fail(500, 'Modules could not be reordered because the audit log is unavailable.', 'audit_unavailable');
    return true;
  });
  move.immediate();
  res.json({ ok: true });
});

courseRouter.post('/manage/lessons/:lessonId/move', requireStaff, (req, res) => {
  const lesson = courseFromLesson(req.params.lessonId);
  if (!lesson) fail(404, 'Lesson not found.', 'not_found');
  requireCourseManager(lesson.id, req.currentUser);
  const direction = req.body?.direction;
  if (!['up', 'down'].includes(direction)) fail(400, 'Choose up or down.', 'validation_error');
  const move = db.transaction(() => {
    const currentLesson = courseFromLesson(req.params.lessonId);
    if (!currentLesson) fail(404, 'Lesson not found.', 'not_found');
    requireCourseManager(currentLesson.id, req.currentUser);
    const lessons = db.prepare('SELECT id, position FROM lessons WHERE module_id = ? ORDER BY position, id').all(currentLesson.module_id);
    const index = lessons.findIndex((item) => item.id === currentLesson.lesson_id);
    if (index < 0) return false;
    const current = lessons[index];
    const other = lessons[index + (direction === 'up' ? -1 : 1)];
    if (!other) return false;
    const temporaryPosition = lessons.reduce((maximum, item) => Math.max(maximum, item.position), 0) + 1;
    db.prepare('UPDATE lessons SET position = ? WHERE id = ?').run(temporaryPosition, current.id);
    db.prepare('UPDATE lessons SET position = ? WHERE id = ?').run(current.position, other.id);
    db.prepare('UPDATE lessons SET position = ? WHERE id = ?').run(other.position, current.id);
    db.prepare('UPDATE courses SET updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.currentUser.id, currentLesson.id);
    const auditId = writeAuditLog({ actor: req.currentUser, action: 'course.lesson_reordered', entityType: 'lesson', entityId: currentLesson.lesson_id,
      summary: `Reordered lesson: ${currentLesson.lesson_title}`, details: { direction, courseId: currentLesson.id } });
    if (!auditId) fail(500, 'Lessons could not be reordered because the audit log is unavailable.', 'audit_unavailable');
    return true;
  });
  move.immediate();
  res.json({ ok: true });
});

courseRouter.put('/manage/modules/:moduleId/quiz', requireStaff, (req, res) => {
  const module = moduleCourse(req.params.moduleId);
  if (!module) fail(404, 'Module not found.', 'not_found');
  requireCourseManager(module.id, req.currentUser);
  const title = textField(req.body?.title ?? 'Module quiz', 'Quiz title', 160, { required: true });
  const passMark = intField(req.body?.passMark ?? 70, 'Pass mark', 1, 100);
  const questions = req.body?.questions;
  if (!Array.isArray(questions)) fail(400, 'Questions must be an array.', 'validation_error');
  if (questions.length > 50) fail(400, 'A quiz can contain up to 50 questions.', 'validation_error');
  for (const question of questions) {
    if (!question || typeof question !== 'object' || Array.isArray(question)) {
      fail(400, 'Each quiz question must be an object.', 'validation_error');
    }
    if (!Array.isArray(question.choices)) fail(400, 'Each quiz question must include an answer-choice list.', 'validation_error');
    if (question.choices.length < 2 || question.choices.length > 6) {
      fail(400, 'Each quiz question must have between two and six answer choices.', 'validation_error');
    }
    let correctChoiceCount = 0;
    for (const choice of question.choices) {
      if (!choice || typeof choice !== 'object' || Array.isArray(choice)) {
        fail(400, 'Each answer choice must be an object.', 'validation_error');
      }
      if (choice.isCorrect !== undefined && typeof choice.isCorrect !== 'boolean') {
        fail(400, 'Correct-answer flags must be true or false.', 'validation_error');
      }
      if (choice.isCorrect === true) correctChoiceCount += 1;
    }
    if (correctChoiceCount !== 1) fail(400, 'Each quiz question must have exactly one correct answer.', 'validation_error');
  }
  const normalizedQuestions = questions.map((question) => ({
    prompt: textField(question.prompt, 'Question', 1000, { required: true }),
    explanation: textField(question.explanation, 'Explanation', 1000),
    choices: question.choices.map((choice) => ({
      text: textField(choice.text, 'Answer choice', 500, { required: true }),
      isCorrect: choice.isCorrect === true,
    })),
  }));
  // Keep response reads inside the transaction for both changed and unchanged quiz saves.
  function buildEditorCourse(courseId) {
    const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(courseId);
    return getCoursePayload(course, req.currentUser, { includeAnswers: true });
  }

  const saveQuiz = db.transaction(() => {
    const currentModule = moduleCourse(req.params.moduleId);
    if (!currentModule) fail(404, 'Module not found.', 'not_found');
    requireCourseManager(currentModule.id, req.currentUser);
    const existingQuiz = db.prepare('SELECT id, title, pass_mark FROM quizzes WHERE module_id = ?').get(currentModule.module_id);
    if (existingQuiz) {
      const savedQuestions = db.prepare('SELECT id, prompt, explanation, position FROM quiz_questions WHERE quiz_id = ? ORDER BY position, id').all(existingQuiz.id);
      const savedChoices = db.prepare(`SELECT qc.question_id, qc.choice_text, qc.is_correct, qc.position
        FROM quiz_choices qc JOIN quiz_questions qq ON qq.id = qc.question_id
        WHERE qq.quiz_id = ? ORDER BY qq.position, qq.id, qc.position, qc.id`).all(existingQuiz.id);
      const choicesByQuestion = new Map();
      for (const choice of savedChoices) {
        const choices = choicesByQuestion.get(choice.question_id) ?? [];
        choices.push(choice);
        choicesByQuestion.set(choice.question_id, choices);
      }
      const unchanged = existingQuiz.title === title && existingQuiz.pass_mark === passMark
        && savedQuestions.length === normalizedQuestions.length
        && savedQuestions.every((question, qIndex) => {
          const requested = normalizedQuestions[qIndex];
          const choices = choicesByQuestion.get(question.id) ?? [];
          return question.position === qIndex && question.prompt === requested.prompt && question.explanation === requested.explanation
            && choices.length === requested.choices.length
            && choices.every((choice, cIndex) => choice.position === cIndex
              && choice.choice_text === requested.choices[cIndex].text
              && Boolean(choice.is_correct) === requested.choices[cIndex].isCorrect);
        });
      if (unchanged) return buildEditorCourse(currentModule.id);
    }
    const quizId = existingQuiz?.id || randomUUID();
    db.prepare(`INSERT INTO quizzes (id, module_id, title, pass_mark) VALUES (?, ?, ?, ?)
      ON CONFLICT(module_id) DO UPDATE SET title = excluded.title, pass_mark = excluded.pass_mark, updated_at = CURRENT_TIMESTAMP`)
      .run(quizId, currentModule.module_id, title, passMark);
    db.prepare('DELETE FROM quiz_questions WHERE quiz_id = ?').run(quizId);
    normalizedQuestions.forEach((question, qIndex) => {
      const questionId = randomUUID();
      db.prepare('INSERT INTO quiz_questions (id, quiz_id, prompt, explanation, position) VALUES (?, ?, ?, ?, ?)')
        .run(questionId, quizId, question.prompt, question.explanation, qIndex);
      question.choices.forEach((choice, cIndex) => {
        db.prepare('INSERT INTO quiz_choices (id, question_id, choice_text, is_correct, position) VALUES (?, ?, ?, ?, ?)')
          .run(randomUUID(), questionId, choice.text, choice.isCorrect ? 1 : 0, cIndex);
      });
    });
    db.prepare('UPDATE courses SET updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.currentUser.id, currentModule.id);
    const auditId = writeAuditLog({ actor: req.currentUser, action: 'course.quiz_saved', entityType: 'quiz', entityId: quizId,
      summary: `Saved quiz for ${currentModule.title}`, details: { courseId: currentModule.id, passMark, questionCount: normalizedQuestions.length } });
    if (!auditId) fail(500, 'Quiz could not be saved because the audit log is unavailable.', 'audit_unavailable');
    return buildEditorCourse(currentModule.id);
  });
  const course = saveQuiz.immediate();
  res.json({ course });
});

courseRouter.delete('/manage/modules/:moduleId/quiz', requireStaff, (req, res) => {
  const deleteQuiz = db.transaction(() => {
    const module = moduleCourse(req.params.moduleId);
    if (!module) fail(404, 'Module not found.', 'not_found');
    requireCourseManager(module.id, req.currentUser);
    db.prepare('DELETE FROM quizzes WHERE module_id = ?').run(module.module_id);
    db.prepare('UPDATE courses SET updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.currentUser.id, module.id);
    const auditId = writeAuditLog({ actor: req.currentUser, action: 'course.quiz_deleted', entityType: 'module', entityId: module.module_id,
      summary: `Removed quiz from ${module.title}`, details: { courseId: module.id } });
    if (!auditId) fail(500, 'Quiz could not be removed because the audit log is unavailable.', 'audit_unavailable');
    return module;
  });
  deleteQuiz.immediate();
  res.status(204).end();
});

courseRouter.get('/manage/courses/:courseId/access', requireStaff, (req, res) => {
  const managed = requireCourseManager(req.params.courseId, req.currentUser);
  const course = canonicalCourse(managed.logical_course_id || managed.id);
  if (!course) fail(404, 'Course not found.', 'not_found');
  const query = textField(req.query.q, 'Search', 100);
  const pageSize = 50;
  const requestedPage = pageQuery(req.query.page, MAX_COURSE_PAGE);
  const search = query ? textSearchPredicate(['u.username', 'u.email'], query) : null;
  const searchClause = search ? ` AND (${search.sql})` : '';
  const searchParams = search?.params || [];
  const total = db.prepare(`SELECT COUNT(*) AS count FROM users u
    WHERE u.role = 'learner'${searchClause}`)
    .get(...searchParams).count;
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));
  const offset = (page - 1) * pageSize;
  const assignedCount = db.prepare(`SELECT COUNT(*) AS count FROM course_grants g
    JOIN users u ON u.id = g.user_id
    WHERE g.course_id = ? AND u.role = 'learner'${searchClause}`)
    .get(course.id, ...searchParams).count;
  const assignedLimit = Math.min(pageSize, Math.max(0, assignedCount - offset));
  const users = assignedLimit ? db.prepare(`
    SELECT u.id, u.username, u.role, u.disabled, g.id AS grant_id, g.granted_at, gu.username AS granted_by
    FROM course_grants g CROSS JOIN users u ON u.id = g.user_id
    LEFT JOIN users gu ON gu.id = g.granted_by
    WHERE g.course_id = ? AND u.role = 'learner'${searchClause}
    ORDER BY u.username COLLATE NOCASE, u.id ASC LIMIT ? OFFSET ?
  `).all(course.id, ...searchParams, assignedLimit, offset) : [];
  const unassignedLimit = pageSize - users.length;
  if (unassignedLimit) users.push(...db.prepare(`
    SELECT u.id, u.username, u.role, u.disabled, NULL AS grant_id, NULL AS granted_at, NULL AS granted_by
    FROM users u
    WHERE u.role = 'learner' AND NOT EXISTS (
      SELECT 1 FROM course_grants g WHERE g.course_id = ? AND g.user_id = u.id
    )${searchClause}
    ORDER BY u.username COLLATE NOCASE, u.id ASC LIMIT ? OFFSET ?
  `).all(course.id, ...searchParams, unassignedLimit, Math.max(0, offset - assignedCount)));
  res.json({ users: users.map((user) => ({ id: user.id, username: user.username, disabled: Boolean(user.disabled), granted: Boolean(user.grant_id), grantedAt: user.granted_at, grantedBy: user.granted_by })), total, page, pageSize });
});

courseRouter.put('/manage/courses/:courseId/access/:userId', requireStaff, (req, res) => {
  const grantAccess = db.transaction(() => {
    const managed = requireCourseManager(req.params.courseId, req.currentUser);
    const course = canonicalCourse(managed.logical_course_id || managed.id);
    if (!course) fail(404, 'Course not found.', 'not_found');
    const learner = db.prepare("SELECT id, username FROM users WHERE id = ? AND role = 'learner' AND disabled = 0").get(req.params.userId);
    if (!learner) fail(404, 'Active learner not found.', 'learner_not_found');
    const result = db.prepare('INSERT OR IGNORE INTO course_grants (id, course_id, user_id, granted_by) VALUES (?, ?, ?, ?)')
      .run(randomUUID(), course.id, learner.id, req.currentUser.id);
    enrollLearner(course.id, learner.id);
    if (result.changes) {
      const auditId = writeAuditLog({ actor: req.currentUser, action: course.visibility === 'private' ? 'course.access_granted' : 'course.learner_assigned',
        entityType: 'course', entityId: course.id, summary: `Assigned ${learner.username} to ${course.title}`,
        details: { learnerId: learner.id, learnerUsername: learner.username, visibility: course.visibility } });
      if (!auditId) fail(500, 'Learner access could not be granted because the audit log is unavailable.', 'audit_unavailable');
    }
    return { created: result.changes > 0, course, learner };
  });
  grantAccess.immediate();
  res.status(204).end();
});

courseRouter.delete('/manage/courses/:courseId/access/:userId', requireStaff, (req, res) => {
  const revokeAccess = db.transaction(() => {
    const managed = requireCourseManager(req.params.courseId, req.currentUser);
    const course = canonicalCourse(managed.logical_course_id || managed.id);
    if (!course) fail(404, 'Course not found.', 'not_found');
    const result = db.prepare('DELETE FROM course_grants WHERE course_id = ? AND user_id = ?').run(course.id, req.params.userId);
    if (result.changes) {
      const user = db.prepare('SELECT username FROM users WHERE id = ?').get(req.params.userId);
      const auditId = writeAuditLog({ actor: req.currentUser, action: course.visibility === 'private' ? 'course.access_revoked' : 'course.learner_unassigned',
        entityType: 'course', entityId: course.id, summary: `Unassigned ${user?.username || 'a learner'} from ${course.title}`,
        details: { learnerId: req.params.userId, learnerUsername: user?.username || null, visibility: course.visibility } });
      if (!auditId) fail(500, 'Learner access could not be revoked because the audit log is unavailable.', 'audit_unavailable');
    }
  });
  revokeAccess.immediate();
  res.status(204).end();
});

courseRouter.get('/lessons/:lessonId/feedback', (req, res) => {
  const lesson = requireFeedbackLesson(req.params.lessonId, req.currentUser);
  const isLearner = req.currentUser.role === 'learner';
  const summary = isLearner
    ? lessonReactionSummary(lesson.lesson_id, req.currentUser.id)
    : { reaction: null, counts: { like: 0, dislike: 0 } };
  const requestedPage = pageQuery(req.query.page);
  const pageSize = 20;
  const selectComments = db.prepare(`SELECT c.id, c.body, c.created_at, u.username, COUNT(*) OVER () AS total
    FROM lesson_comments c JOIN users u ON u.id = c.user_id
    WHERE c.lesson_id = ? ORDER BY c.created_at DESC, c.id DESC LIMIT ? OFFSET ?`);
  let comments = selectComments.all(lesson.lesson_id, pageSize, (requestedPage - 1) * pageSize);
  let total = comments[0]?.total ?? 0;
  let page = requestedPage;
  if (!comments.length && requestedPage > 1) {
    total = db.prepare('SELECT COUNT(*) AS count FROM lesson_comments WHERE lesson_id = ?').get(lesson.lesson_id).count;
    page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));
    if (page < requestedPage) comments = selectComments.all(lesson.lesson_id, pageSize, (page - 1) * pageSize);
  }
  res.json({
    lessonId: lesson.lesson_id,
    reaction: summary.reaction,
    counts: summary.counts,
    comments: comments.map((comment) => ({ id: comment.id, body: comment.body, username: comment.username, createdAt: comment.created_at })),
    total,
    page,
    pageSize,
  });
});

courseRouter.put('/lessons/:lessonId/reaction', learnerReactionLimiter, (req, res) => {
  const saveReaction = db.transaction(() => {
    const lesson = requireLearnerLesson(req.params.lessonId, req.currentUser);
    const reaction = req.body?.reaction;
    if (reaction !== null && reaction !== 'like' && reaction !== 'dislike') {
      fail(400, 'Choose like, dislike, or clear your reaction.', 'invalid_reaction');
    }
    if (reaction === null) {
      db.prepare('DELETE FROM lesson_reactions WHERE lesson_id = ? AND user_id = ?').run(lesson.lesson_id, req.currentUser.id);
    } else {
      db.prepare(`INSERT INTO lesson_reactions (lesson_id, user_id, reaction) VALUES (?, ?, ?)
        ON CONFLICT(lesson_id, user_id) DO UPDATE SET reaction = excluded.reaction, updated_at = CURRENT_TIMESTAMP`)
        .run(lesson.lesson_id, req.currentUser.id, reaction);
    }
    const summary = lessonReactionSummary(lesson.lesson_id, req.currentUser.id);
    return { reaction, counts: summary.counts };
  });
  res.json(saveReaction.immediate());
});

courseRouter.post('/lessons/:lessonId/comments', learnerCommentLimiter, (req, res) => {
  if (typeof req.body?.body !== 'string') fail(400, 'Enter a comment before posting.', 'invalid_comment');
  const body = req.body.body.trim();
  if (!body || body.length > 2000) fail(400, 'Comments must be between 1 and 2,000 characters.', 'invalid_comment');
  const createComment = db.transaction(() => {
    const lesson = requireLearnerLesson(req.params.lessonId, req.currentUser);
    const id = randomUUID();
    db.prepare('INSERT INTO lesson_comments (id, lesson_id, user_id, body) VALUES (?, ?, ?, ?)')
      .run(id, lesson.lesson_id, req.currentUser.id, body);
    const comment = db.prepare(`SELECT c.id, c.body, c.created_at, u.username,
      (SELECT COUNT(*) FROM lesson_comments WHERE lesson_id = c.lesson_id) AS total
      FROM lesson_comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?`).get(id);
    return { comment: { id: comment.id, body: comment.body, username: comment.username, createdAt: comment.created_at }, total: comment.total };
  });
  res.status(201).json(createComment.immediate());
});

courseRouter.delete('/lessons/:lessonId/comments/:commentId', (req, res) => {
  const removeComment = db.transaction(() => {
    const lesson = courseFromLesson(req.params.lessonId);
    if (!lesson) fail(404, 'Lesson not found.', 'not_found');
    requireCourseManager(lesson.id, req.currentUser);
    if (lesson.status !== 'published') fail(404, 'Lesson not found.', 'not_found');
    const comment = db.prepare(`SELECT c.id, c.user_id, u.username FROM lesson_comments c
      JOIN users u ON u.id = c.user_id WHERE c.id = ? AND c.lesson_id = ?`)
      .get(req.params.commentId, lesson.lesson_id);
    if (!comment) fail(404, 'Comment not found.', 'not_found');
    db.prepare('DELETE FROM lesson_comments WHERE id = ? AND lesson_id = ?').run(comment.id, lesson.lesson_id);
    const auditId = writeAuditLog({
      actor: req.currentUser,
      action: 'course.comment_removed',
      entityType: 'lesson_comment',
      entityId: comment.id,
      summary: `Removed a learner comment from "${lesson.lesson_title}"`,
      details: {
        courseId: lesson.id,
        courseTitle: lesson.title,
        lessonId: lesson.lesson_id,
        lessonTitle: lesson.lesson_title,
        commentAuthorId: comment.user_id,
        commentAuthorUsername: comment.username,
      },
    });
    if (!auditId) fail(500, 'The comment could not be removed because the audit log is unavailable.', 'audit_unavailable');
    return { lesson };
  });
  removeComment.immediate();
  res.status(204).end();
});

courseRouter.put('/lessons/:lessonId/completion', (req, res) => {
  const completeLesson = db.transaction(() => {
    const lesson = courseFromLesson(req.params.lessonId);
    if (!lesson) fail(404, 'Lesson not found.', 'not_found');
    requireCourseViewer(lesson.id, req.currentUser);
    if (lesson.status !== 'published' || !lesson.media_id) fail(404, 'Lesson video is not available.', 'not_found');
    const alreadyCompleted = Boolean(db.prepare('SELECT 1 FROM lesson_progress WHERE user_id = ? AND lesson_id = ?')
      .get(req.currentUser.id, lesson.lesson_id));
    if (req.currentUser.role === 'learner' && !isLessonUnlocked(lesson.lesson_id, req.currentUser)) {
      fail(423, 'Complete the previous lesson before opening this one.', 'lesson_locked');
    }
    if (!alreadyCompleted && !lessonVideoWasWatched(req.currentUser.id, lesson.lesson_id)) {
      fail(409, 'Watch the full lesson video before marking it complete.', 'video_watch_required');
    }
    enrollLearner(lesson.id, req.currentUser.id);
    db.prepare('INSERT OR IGNORE INTO lesson_progress (user_id, lesson_id) VALUES (?, ?)').run(req.currentUser.id, lesson.lesson_id);
    syncLearnerPathsForCourse(lesson.id, req.currentUser.id);
    return issueCertificateIfComplete(lesson.id, req.currentUser);
  });
  let certificate;
  try {
    certificate = completeLesson.immediate();
  } catch (error) {
    if (error?.code === 'video_watch_required') {
      const lesson = courseFromLesson(req.params.lessonId);
      if (lesson) {
        const watchProgress = getLessonWatchProgress(req.currentUser, lesson.lesson_id);
        const watchedSeconds = db.prepare(`SELECT watched_seconds FROM lesson_watch_telemetry
          WHERE user_id = ? AND lesson_id = ?`).get(req.currentUser.id, lesson.lesson_id)?.watched_seconds ?? 0;
        writeSystemLog('warn', 'lesson-watch', 'Rejected lesson completion before verified video watch', {
          userId: req.currentUser.id,
          username: req.currentUser.username,
          role: req.currentUser.role,
          courseId: lesson.id,
          lessonId: lesson.lesson_id,
          watchedSeconds,
          watchedUntilSeconds: watchProgress.watchedUntilSeconds,
          durationSeconds: watchProgress.durationSeconds,
        });
      }
    }
    throw error;
  }
  res.json({ completed: true, certificate });
});

courseRouter.delete('/lessons/:lessonId/completion', (req, res) => {
  const lesson = courseFromLesson(req.params.lessonId);
  if (!lesson) fail(404, 'Lesson not found.', 'not_found');
  requireCourseViewer(lesson.id, req.currentUser);
  db.prepare('DELETE FROM lesson_progress WHERE user_id = ? AND lesson_id = ?').run(req.currentUser.id, lesson.lesson_id);
  res.json({ completed: false });
});

function summarizeQuizAttempt(attempt, snapshot) {
  const questions = Array.isArray(snapshot) ? snapshot : [];
  return {
    id: attempt.id,
    score: attempt.score,
    correctCount: questions.reduce((count, question) => count + Number(Boolean(
      question.correctChoiceId && question.selectedChoiceId === question.correctChoiceId,
    )), 0),
    questionCount: questions.length,
    passed: Boolean(attempt.passed),
    ...(attempt.submitted_at ? { submittedAt: attempt.submitted_at } : {}),
  };
}

courseRouter.post('/quizzes/:quizId/attempts', quizAttemptLimiter, (req, res) => {
  const submitAttempt = db.transaction(() => {
    const quiz = quizCourse(req.params.quizId);
    if (!quiz) fail(404, 'Quiz not found.', 'not_found');
    requireCourseViewer(quiz.id, req.currentUser);
    if (quiz.status !== 'published') fail(404, 'Quiz is not available.', 'not_found');
    const questions = db.prepare('SELECT * FROM quiz_questions WHERE quiz_id = ? ORDER BY position, id').all(quiz.quiz_id);
    if (!questions.length) fail(400, 'This quiz has no questions yet.', 'quiz_empty');
    const answers = req.body?.answers;
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) fail(400, 'Choose an answer for every question.', 'answers_required');
    const answerIds = Object.keys(answers);
    const questionIds = questions.map((question) => question.id);
    const questionIdSet = new Set(questionIds);
    // Reject unknown question keys separately from genuinely missing answers.
    if (answerIds.some((id) => !questionIdSet.has(id))) fail(400, 'One of the selected answers is invalid.', 'invalid_answer');
    if (answerIds.length !== questions.length) fail(400, 'Choose an answer for every question.', 'answers_required');
    const placeholders = questionIds.map(() => '?').join(', ');
    const choicesByQuestion = new Map();
    for (const choice of db.prepare(`
      SELECT id, question_id, choice_text, is_correct FROM quiz_choices
      WHERE question_id IN (${placeholders}) ORDER BY question_id, position, id
    `).all(...questionIds)) {
      const choices = choicesByQuestion.get(choice.question_id) ?? [];
      choices.push(choice);
      choicesByQuestion.set(choice.question_id, choices);
    }
    let correct = 0;
    const snapshot = [];
    for (const question of questions) {
      const choices = choicesByQuestion.get(question.id) ?? [];
      const answerId = answers[question.id];
      const selected = choices.find((choice) => choice.id === answerId);
      if (!selected) fail(400, 'One of the selected answers is invalid.', 'invalid_answer');
      if (selected.is_correct) correct += 1;
      snapshot.push({
        id: question.id,
        prompt: question.prompt,
        explanation: question.explanation,
        correctChoiceId: choices.find((choice) => choice.is_correct)?.id,
        choices: choices.map((choice) => ({ id: choice.id, text: choice.choice_text })),
        selectedChoiceId: selected.id,
      });
    }
    const score = Math.round((correct / questions.length) * 100);
    const passMark = db.prepare('SELECT pass_mark FROM quizzes WHERE id = ?').get(quiz.quiz_id).pass_mark;
    const passed = score >= passMark;
    const attemptId = randomUUID();
    enrollLearner(quiz.id, req.currentUser.id);
    db.prepare(`INSERT INTO quiz_attempts (id, quiz_id, user_id, score, passed, answers_json, question_snapshot_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(attemptId, quiz.quiz_id, req.currentUser.id, score, passed ? 1 : 0, JSON.stringify(answers), JSON.stringify(snapshot));
    if (passed) syncLearnerPathsForCourse(quiz.id, req.currentUser.id);
    const certificate = issueCertificateIfComplete(quiz.id, req.currentUser);
    const attempt = summarizeQuizAttempt({
      id: attemptId,
      score,
      passed,
      submitted_at: db.prepare('SELECT submitted_at FROM quiz_attempts WHERE id = ?').get(attemptId).submitted_at,
    }, snapshot);
    return { attempt, certificate };
  });
  res.status(201).json(submitAttempt.immediate());
});

courseRouter.get('/quizzes/:quizId/attempts/:attemptId', (req, res) => {
  const quiz = quizCourse(req.params.quizId);
  if (!quiz) fail(404, 'Quiz not found.', 'not_found');
  requireCourseViewer(quiz.id, req.currentUser);
  const attempt = db.prepare('SELECT * FROM quiz_attempts WHERE id = ? AND quiz_id = ? AND user_id = ?')
    .get(req.params.attemptId, req.params.quizId, req.currentUser.id);
  if (!attempt) fail(404, 'Quiz result not found.', 'not_found');
  res.json({ attempt: summarizeQuizAttempt(attempt, JSON.parse(attempt.question_snapshot_json)) });
});
