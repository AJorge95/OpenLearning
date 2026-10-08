import { randomBytes, timingSafeEqual } from 'node:crypto';
import { db } from './db.js';

export class ApiError extends Error {
  constructor(status, message, code = 'request_error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function fail(status, message, code) {
  throw new ApiError(status, message, code);
}

export function requireAuth(req, _res, next) {
  if (!req.currentUser || req.currentUser.disabled) return next(new ApiError(401, 'Sign in to continue.', 'unauthorized'));
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
      req.session.destroy(() => {});
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

export function errorHandler(error, _req, res, _next) {
  if (res.headersSent) return;
  if (error instanceof ApiError) {
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  if (error?.name === 'MulterError') {
    const message = error.code === 'LIMIT_FILE_SIZE' ? 'This file is larger than the configured upload limit.' : error.message;
    return res.status(413).json({ error: message, code: error.code });
  }
  if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return res.status(409).json({ error: 'That value is already in use.', code: 'conflict' });
  }
  console.error(error);
  return res.status(500).json({ error: 'Something went wrong. Please try again.', code: 'internal_error' });
}

