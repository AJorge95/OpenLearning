import { randomBytes, timingSafeEqual } from 'node:crypto';
import { db } from './db.js';
import { writeSystemLog } from './log-store.js';

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
    const user = db.prepare('SELECT id, username, role, disabled FROM users WHERE id = ?').get(req.session.userId);
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
  return db.prepare('SELECT 1 FROM course_grants WHERE course_id = ? AND user_id = ?').get(courseId, userId) !== undefined;
}

export function canViewCourse(course, user) {
  if (!course || !user || user.disabled) return false;
  if (user.role === 'admin' || user.role === 'moderator') return true;
  if (course.status !== 'published') return false;
  if (course.visibility === 'public') return true;
  return hasCourseGrant(course.id, user.id);
}

export function courseById(courseId) {
  return db.prepare('SELECT * FROM courses WHERE id = ?').get(courseId);
}

export function requireCourseManager(courseId, user) {
  if (!user || !['admin', 'moderator'].includes(user.role)) fail(403, 'You do not have permission to manage courses.', 'forbidden');
  const course = courseById(courseId);
  if (!course) fail(404, 'Course not found.', 'not_found');
  return course;
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
