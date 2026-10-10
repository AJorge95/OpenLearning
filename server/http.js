import { randomBytes, timingSafeEqual } from 'node:crypto';
import { db } from './db.js';
import { writeSystemLog } from './log-store.js';
import { editableCourse, logicalCourseId } from './course-versioning.js';

export class ApiError extends Error {
  constructor(status, message, code = 'request_error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const requestBodyErrors = new Map([
  ['charset.unsupported', { status: 415, message: 'Request body uses an unsupported character set.', code: 'unsupported_charset' }],
  ['encoding.unsupported', { status: 415, message: 'Request body uses an unsupported content encoding.', code: 'unsupported_content_encoding' }],
  ['request.size.invalid', { status: 400, message: 'Request body length does not match Content-Length.', code: 'invalid_content_length' }],
  ['request.aborted', { status: 400, message: 'Request body was interrupted before it was complete.', code: 'request_aborted' }],
  ['parameters.too.many', { status: 413, message: 'Request body contains too many form fields.', code: 'too_many_parameters' }],
]);
const currentUserStatement = db.prepare('SELECT id, username, email, first_name, last_name, role, disabled FROM users WHERE id = ?');
const courseGrantStatement = db.prepare('SELECT 1 FROM course_grants WHERE course_id = ? AND user_id = ?');

export function fail(status, message, code) {
  throw new ApiError(status, message, code);
}

export function requireObjectBody(value, label = 'Request body') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(400, `${label} must be an object.`, 'validation_error');
  }
  return value;
}

export function pageQuery(value, maximum = 100_000) {
  if (value !== undefined && typeof value !== 'string') {
    fail(400, 'Page must be a single value.', 'validation_error');
  }
  const parsedPage = Number(value || 1);
  return Number.isSafeInteger(parsedPage) && parsedPage > 0 ? Math.min(parsedPage, maximum) : 1;
}

export function enumQuery(value, label, values, fallback = 'all') {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !values.includes(value)) {
    fail(400, `Choose a valid ${label}.`, 'validation_error');
  }
  return value;
}

export function requireAuth(req, _res, next) {
  if (!req.currentUser || req.currentUser.disabled) return next(new ApiError(401, 'Sign in to continue.', 'unauthorized'));
  next();
}

export function noStoreApiResponses(req, res, next) {
  if (req.path === '/api' || req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.currentUser || req.currentUser.disabled) return next(new ApiError(401, 'Sign in to continue.', 'unauthorized'));
    if (!roles.includes(req.currentUser.role)) return next(new ApiError(403, 'You do not have permission to do that.', 'forbidden'));
    next();
  };
}

export const requireStaff = requireRole('admin', 'moderator');
export const requireAdmin = requireRole('admin');

export function newCsrfToken(req) {
  if (!req.session.csrfToken) req.session.csrfToken = randomBytes(32).toString('base64url');
  return req.session.csrfToken;
}

export function csrfMiddleware(req, _res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const expected = req.session?.csrfToken;
  const provided = req.get('x-csrf-token');
  if (!expected || !provided) return next(new ApiError(403, 'Refresh the page and try again.', 'csrf_missing'));
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length || !timingSafeEqual(expectedBuffer, providedBuffer)) {
    return next(new ApiError(403, 'Refresh the page and try again.', 'csrf_invalid'));
  }
  next();
}

export function loadCurrentUser(req, _res, next) {
  try {
    if (!req.session?.userId) {
      req.currentUser = null;
      return next();
    }
    const user = currentUserStatement.get(req.session.userId);
    if (!user || user.disabled) {
      const reason = user ? 'user_disabled' : 'user_missing';
      req.session.destroy((error) => {
        if (error) writeSystemLog('warn', 'sessions', 'Invalid session cleanup failed', {
          reason,
          errorName: String(error?.name || 'Error').slice(0, 100),
          errorCode: typeof error?.code === 'string' ? error.code.slice(0, 100) : undefined,
        });
      });
      req.currentUser = null;
      return next();
    }
    req.currentUser = user;
    next();
  } catch (error) {
    next(error);
  }
}

export function hasCourseGrant(courseId, userId) {
  return courseGrantStatement.get(courseId, userId) !== undefined;
}

function cachedValue(cache, key, load) {
  if (!cache) return load();
  if (cache.has(key)) return cache.get(key);
  const value = load();
  cache.set(key, value);
  return value;
}

function canViewCourseWithCache(course, user, cache) {
  if (!course || !user || user.disabled) return false;
  if (user.role === 'admin' || user.role === 'moderator') return true;
  const courseId = logicalCourseId(course.id) || course.id;
  const canonical = cachedValue(cache?.canonical, courseId,
    () => db.prepare('SELECT * FROM courses WHERE id = ? AND logical_course_id IS NULL').get(courseId));
  if (!canonical || canonical.status !== 'published') return false;
  if (course.logical_course_id) {
    const active = cachedValue(cache?.activeVersions, courseId,
      () => db.prepare('SELECT storage_course_id FROM course_versions WHERE course_id = ? ORDER BY version_number DESC LIMIT 1').get(courseId));
    if (active?.storage_course_id !== course.id) return false;
  }
  if (canonical.visibility === 'public') return true;
  const granted = cachedValue(cache?.grants, courseId, () => hasCourseGrant(courseId, user.id));
  if (granted) return true;
  return hasUnlockedPathAccess(courseId, user.id, cache);
}

export function canViewCourse(course, user) {
  return canViewCourseWithCache(course, user, null);
}

export function createCourseAccessChecker(user) {
  const cache = {
    canonical: new Map(),
    activeVersions: new Map(),
    grants: new Map(),
    pathAccess: new Map(),
    pathCompletion: new Map(),
  };
  return (course) => canViewCourseWithCache(course, user, cache);
}

function completedForPath(courseId, userId, completionCache) {
  return cachedValue(completionCache, courseId, () => {
    const version = db.prepare(`SELECT v.id, v.storage_course_id FROM course_versions v
      WHERE v.course_id = ? ORDER BY v.version_number DESC LIMIT 1`).get(courseId);
    const contentId = version?.storage_course_id || courseId;
    const state = db.prepare('SELECT target_version_id FROM course_learning_state WHERE user_id = ? AND course_id = ?').get(userId, courseId);
    const resetRequired = Boolean(version && state?.target_version_id === version.id);
    const lessons = db.prepare(`SELECT l.id, l.stable_id FROM lessons l JOIN course_modules m ON m.id = l.module_id WHERE m.course_id = ?`).all(contentId);
    const quizzes = db.prepare(`SELECT q.id, q.stable_id FROM quizzes q JOIN course_modules m ON m.id = q.module_id WHERE m.course_id = ?`).all(contentId);
    if (!lessons.length && !quizzes.length) return false;
    const lessonHistory = db.prepare(`SELECT l.id, l.stable_id FROM lesson_progress p
      JOIN lessons l ON l.id = p.lesson_id JOIN course_modules m ON m.id = l.module_id
      JOIN courses c ON c.id = m.course_id
      WHERE p.user_id = ? AND (c.id = ? OR c.logical_course_id = ?)`)
      .all(userId, courseId, courseId);
    const quizHistory = db.prepare(`SELECT DISTINCT q.id, q.stable_id FROM quiz_attempts a
      JOIN quizzes q ON q.id = a.quiz_id JOIN course_modules m ON m.id = q.module_id
      JOIN courses c ON c.id = m.course_id
      WHERE a.user_id = ? AND a.passed = 1 AND (c.id = ? OR c.logical_course_id = ?)`)
      .all(userId, courseId, courseId);
    const completedLessonIds = new Set(lessonHistory.map((lesson) => lesson.id));
    const completedLessonStableIds = new Set(lessonHistory.map((lesson) => lesson.stable_id ?? lesson.id));
    const passedQuizIds = new Set(quizHistory.map((quiz) => quiz.id));
    const passedQuizStableIds = new Set(quizHistory.map((quiz) => quiz.stable_id ?? quiz.id));
    const hasCompletedLesson = (lesson) => resetRequired
      ? completedLessonIds.has(lesson.id)
      : completedLessonStableIds.has(lesson.stable_id ?? lesson.id);
    const hasPassedQuiz = (quiz) => resetRequired
      ? passedQuizIds.has(quiz.id)
      : passedQuizStableIds.has(quiz.stable_id ?? quiz.id);
    return lessons.every(hasCompletedLesson) && quizzes.every(hasPassedQuiz);
  });
}

function hasUnlockedPathAccess(courseId, userId, cache) {
  return cachedValue(cache?.pathAccess, courseId, () => {
    const paths = db.prepare(`SELECT lp.id AS path_id, lp.status, pc.position, pc.requires_previous
      FROM learning_path_enrollments e JOIN learning_paths lp ON lp.id = e.path_id
      JOIN learning_path_courses pc ON pc.path_id = lp.id
      WHERE e.user_id = ? AND pc.course_id = ? AND lp.status = 'published'`).all(userId, courseId);
    for (const path of paths) {
      if (!path.requires_previous || path.position === 0) return true;
      const prerequisites = db.prepare(`SELECT prior.course_id
        FROM learning_path_courses prior WHERE prior.path_id = ? AND prior.position < ? ORDER BY prior.position`)
        .all(path.path_id, path.position);
      if (prerequisites.every((step) => completedForPath(step.course_id, userId, cache?.pathCompletion))) return true;
    }
    return false;
  });
}

export function courseById(courseId) {
  return db.prepare('SELECT * FROM courses WHERE id = ?').get(courseId);
}

export function requireCourseManager(courseId, user) {
  if (!user || !['admin', 'moderator'].includes(user.role)) fail(403, 'You do not have permission to manage courses.', 'forbidden');
  let course = courseById(courseId);
  if (!course) {
    course = db.prepare(`SELECT c.* FROM courses c JOIN course_modules m ON m.course_id = c.id WHERE m.id = ?`).get(courseId)
      ?? db.prepare(`SELECT c.* FROM courses c JOIN course_modules m ON m.course_id = c.id JOIN lessons l ON l.module_id = m.id WHERE l.id = ?`).get(courseId)
      ?? db.prepare(`SELECT c.* FROM courses c JOIN course_modules m ON m.course_id = c.id JOIN quizzes q ON q.module_id = m.id WHERE q.id = ?`).get(courseId);
  }
  if (!course) fail(404, 'Course not found.', 'not_found');
  const logicalId = course.logical_course_id || course.id;
  if (course.logical_course_id) {
    const revision = db.prepare('SELECT revision_course_id FROM course_revisions WHERE course_id = ?').get(logicalId);
    if (revision?.revision_course_id !== course.id) fail(409, 'This course content belongs to an older published version. Reload the editor to work on the current revision.', 'stale_course_revision');
  }
  const editable = editableCourse(logicalId, user);
  if (!editable) fail(404, 'Course not found.', 'not_found');
  return editable;
}

export function requireCourseViewer(courseId, user) {
  const course = courseById(courseId);
  if (!course) fail(404, 'Course not found.', 'not_found');
  if (!canViewCourse(course, user)) fail(403, 'You do not have access to this course.', 'course_access_denied');
  return course;
}

function recordUnhandledError(error, req) {
  writeSystemLog('error', 'http', String(error?.message || 'Unhandled request error'), {
    method: req.method,
    path: String(req.originalUrl || req.path || '').split('?')[0],
    errorName: String(error?.name || 'Error').slice(0, 100),
    errorCode: typeof error?.code === 'string' ? error.code.slice(0, 100) : undefined,
  });
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    recordUnhandledError(error, req);
    return next(error);
  }
  if (error instanceof ApiError) {
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  if (error?.name === 'URIError' && error?.status === 400) {
    return res.status(400).json({ error: 'Request URL contains invalid encoding.', code: 'invalid_url_encoding' });
  }
  if (error?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body contains invalid JSON.', code: 'invalid_json' });
  }
  if (error?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large.', code: 'payload_too_large' });
  }
  const requestBodyError = requestBodyErrors.get(error?.type);
  if (requestBodyError) {
    return res.status(requestBodyError.status).json({ error: requestBodyError.message, code: requestBodyError.code });
  }
  if (error?.name === 'MulterError') {
    const tooLarge = ['LIMIT_FILE_SIZE', 'LIMIT_FIELD_VALUE'].includes(error.code);
    const message = error.code === 'LIMIT_FILE_SIZE' ? 'This file is larger than the configured upload limit.' : error.message;
    return res.status(tooLarge ? 413 : 400).json({ error: message, code: error.code });
  }
  if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return res.status(409).json({ error: 'That value is already in use.', code: 'conflict' });
  }
  recordUnhandledError(error, req);
  console.error(error);
  return res.status(500).json({ error: 'Something went wrong. Please try again.', code: 'internal_error' });
}
