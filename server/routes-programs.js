import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { createCourseAccessChecker, enumQuery, fail, pageQuery, requireAdmin, requireAuth, requireCourseManager, requireObjectBody, requireStaff } from './http.js';
import { courseLearningDeadlineAt, courseSummaries, courseSummariesWithState, insertCourseLearningStates, prepareCourseLearnerSummaryData, prepareCourseSummaryData } from './course-service.js';
import { courseVersionHistoryPage, logicalCourseId, logicalCourseIds, publishRevision, restoreCourseVersion } from './course-versioning.js';
import { writeAuditLog, writeSystemLog } from './log-store.js';
import { textSearchPredicate } from './sql.js';
import { MAX_LEARNING_PATH_COURSES } from '../shared/learning-path-limits.js';
import { COMPETENCY_ACHIEVEMENT_BATCH_SIZE, COMPETENCY_PROGRESS_PAGE_SIZE } from '../shared/competency-progress.js';

export const programsRouter = Router();
programsRouter.use(requireAuth);
const LEARNING_PATH_PAGE_SIZE = 20;
const LEARNING_PATH_LEARNER_PROGRESS_BATCH_SIZE = 10;
const COURSE_VERSION_PAGE_SIZE = 20;
const COMPETENCY_ADMIN_PAGE_SIZE = 25;
const COURSE_COMPETENCY_SELECTION_LIMIT = 200;
const MAX_CALENDAR_RANGE_DAYS = 62;
const SELF_ENROLLMENT_PATH_COURSE_FILTER = `p.self_enrollment = 1
  AND EXISTS (SELECT 1 FROM learning_path_courses pc WHERE pc.path_id = p.id)
  AND NOT EXISTS (
    SELECT 1 FROM learning_path_courses pc JOIN courses c ON c.id = pc.course_id
    WHERE pc.path_id = p.id AND (c.status <> 'published' OR c.visibility <> 'public')
  )`;

function selfEnrollmentPathIsAvailable(pathId) {
  return Boolean(db.prepare(`SELECT 1 FROM learning_paths p
    WHERE p.id = ? AND p.status = 'published' AND ${SELF_ENROLLMENT_PATH_COURSE_FILTER}`).get(pathId));
}

function text(value, label, max, required = false) {
  if (value !== undefined && value !== null && typeof value !== 'string') fail(400, `${label} must be text.`, 'validation_error');
  const result = (value || '').trim();
  if (required && !result) fail(400, `${label} is required.`, 'validation_error');
  if (result.length > max) fail(400, `${label} must be ${max} characters or fewer.`, 'validation_error');
  return result;
}

function booleanValue(value, label) {
  if (typeof value !== 'boolean') fail(400, `${label} must be true or false.`, 'validation_error');
  return value;
}

function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function calendarDeadlineDate(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  // SQLite's space-separated timestamps have no zone; interpret them as UTC like stored deadlines.
  const normalized = value.trim().replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T');
  const hasDateTime = /^\d{4}-\d{2}-\d{2}T/.test(normalized);
  const hasTimezone = /(?:[zZ]|[+-]\d{2}:\d{2})$/.test(normalized);
  const date = new Date(hasDateTime && !hasTimezone ? `${normalized}Z` : normalized);
  return Number.isFinite(date.getTime()) ? date : null;
}

function logAudit(actor, action, entityType, entityId, summary, details = {}) {
  const auditId = writeAuditLog({ actor, action, entityType, entityId, summary, details });
  if (!auditId) fail(500, 'The change could not be saved because the audit log is unavailable.', 'audit_unavailable');
}

function competencyAdminPage(competency, query = '') {
  const conditions = [];
  const params = [];
  if (query) {
    const search = textSearchPredicate(['title', 'description'], query);
    conditions.push(`(${search.sql})`);
    params.push(...search.params);
  }
  conditions.push(`(active > ? OR (active = ? AND (title COLLATE NOCASE < ?
    OR (title COLLATE NOCASE = ? AND id < ?))))`);
  params.push(competency.active, competency.active, competency.title, competency.title, competency.id);
  const precedingCount = db.prepare(`SELECT COUNT(*) AS count FROM competencies WHERE ${conditions.join(' AND ')}`)
    .get(...params).count;
  return Math.floor(precedingCount / COMPETENCY_ADMIN_PAGE_SIZE) + 1;
}

function pathCourseRows(pathId) {
  return db.prepare(`SELECT pc.id AS path_course_id, pc.path_id, pc.course_id, pc.position, pc.requires_previous, c.*
    FROM learning_path_courses pc JOIN courses c ON c.id = pc.course_id
    WHERE pc.path_id = ? ORDER BY pc.position`).all(pathId);
}

function staffPathStatusFilter(value) {
  const status = enumQuery(value, 'learning path status', ['all', 'draft', 'published', 'archived']);
  return status === 'all' ? { sql: "status != 'archived'", params: [] } : { sql: 'status = ?', params: [status] };
}

function splitIntoBatches(values, size) {
  const batches = [];
  for (let index = 0; index < values.length; index += size) batches.push(values.slice(index, index + size));
  return batches;
}

export function syncUnlockedPathStates(
  pathIds,
  userId,
  pathRowsById = new Map(),
  summaryDataByPathId = new Map(),
  learnerSummaryDataByPathId = new Map(),
  { deferStateInsertions = false } = {},
) {
  const user = { id: userId, role: 'learner', disabled: false };
  const statesByCourse = new Map();
  const deferredStateInsertions = [];
  for (const pathId of pathIds) {
    const rows = pathRowsById.get(pathId) ?? pathCourseRows(pathId);
    const summaries = courseSummariesWithState(rows, user, summaryDataByPathId.get(pathId), learnerSummaryDataByPathId.get(pathId));
    const pendingStateInsertions = [];
    const startedAtDate = new Date();
    const startedAt = startedAtDate.toISOString();
    let allEarlierCoursesCompleted = true;
    for (const [index, row] of rows.entries()) {
      const unlocked = !row.requires_previous || row.position === 0 || allEarlierCoursesCompleted;
      const summaryDetails = summaries[index];
      let summary = summaryDetails.summary;
      if (unlocked) {
        const logicalId = row.logical_course_id || row.course_id;
        let courseState = statesByCourse.get(logicalId);
        if (!courseState) {
          const state = summaryDetails.learningState;
          const created = !state;
          if (created) {
            const deadlineDays = row.completion_window_days;
            const targetVersionId = summaryDetails.version?.requires_recompletion ? summaryDetails.version.id : null;
            const deadlineAt = courseLearningDeadlineAt(deadlineDays, startedAtDate);
            const nextState = { user_id: userId, course_id: logicalId, target_version_id: targetVersionId, deadline_at: deadlineAt };
            pendingStateInsertions.push({
              courseId: logicalId,
              targetVersionId,
              deadlineAt,
              deadlineWindowDays: deadlineDays ?? null,
              startedAt,
            });
            courseState = { state: nextState, created: true };
          } else {
            courseState = { state, created: false };
          }
          statesByCourse.set(logicalId, courseState);
        }
        // A newly created recompletion state evaluates prior progress against the active version's exact IDs.
        if (courseState.created && courseState.state?.target_version_id) {
          summary = { ...summary, completed: summaryDetails.completedWithVersionReset };
        }
      }
      allEarlierCoursesCompleted = allEarlierCoursesCompleted && summary.completed;
    }
    const stateInsertions = pendingStateInsertions.map((state) => ({ userId, ...state }));
    if (deferStateInsertions) deferredStateInsertions.push(...stateInsertions);
    else insertCourseLearningStates(stateInsertions);
  }
  if (deferStateInsertions) return deferredStateInsertions;
}

function syncUnlockedPathStatesForEnrollments(pathId, enrollments) {
  if (!enrollments.length) return;
  // Path order and course structure are shared by every learner, so prepare them once.
  const rows = pathCourseRows(pathId);
  const pathRowsById = new Map([[pathId, rows]]);
  const summaryDataByPathId = new Map([[pathId, prepareCourseSummaryData(rows)]]);
  // Ten learners plus two 200-course ID lists use at most 410 bind variables; batching also bounds history memory.
  for (const enrollmentBatch of splitIntoBatches(enrollments, LEARNING_PATH_LEARNER_PROGRESS_BATCH_SIZE)) {
    const progressByUser = prepareCourseLearnerSummaryData(rows, enrollmentBatch.map((enrollment) => enrollment.user_id));
    // Learner unlock decisions are independent, so defer writes until the whole progress batch is evaluated.
    const pendingStateInsertions = [];
    for (const enrollment of enrollmentBatch) {
      const learnerSummaryDataByPathId = new Map([[pathId, progressByUser.get(enrollment.user_id)]]);
      pendingStateInsertions.push(...syncUnlockedPathStates(
        [pathId],
        enrollment.user_id,
        pathRowsById,
        summaryDataByPathId,
        learnerSummaryDataByPathId,
        { deferStateInsertions: true },
      ));
    }
    insertCourseLearningStates(pendingStateInsertions);
  }
}

function pathPayloads(paths, user) {
  if (!paths.length) return [];
  const pathIds = paths.map((path) => path.id);
  const rowsByPath = new Map(pathIds.map((pathId) => [pathId, []]));
  const allRows = [];
  for (const pathIdBatch of splitIntoBatches(pathIds, 500)) {
    const rows = db.prepare(`SELECT pc.id AS path_course_id, pc.path_id, pc.course_id, pc.position, pc.requires_previous, c.*
      FROM learning_path_courses pc JOIN courses c ON c.id = pc.course_id
      WHERE pc.path_id IN (${pathIdBatch.map(() => '?').join(', ')}) ORDER BY pc.path_id, pc.position`)
      .all(...pathIdBatch);
    for (const row of rows) {
      rowsByPath.get(row.path_id).push(row);
      allRows.push(row);
    }
  }

  const summariesByPath = new Map(pathIds.map((pathId) => [pathId, []]));
  for (const rowBatch of splitIntoBatches(allRows, 400)) {
    const summaries = courseSummaries(rowBatch, user || null);
    for (const [index, row] of rowBatch.entries()) summariesByPath.get(row.path_id).push(summaries[index]);
  }

  const deadlinesByCourse = new Map();
  const courseIds = [...new Set(allRows.map((row) => row.course_id))];
  if (user) {
    for (const courseIdBatch of splitIntoBatches(courseIds, 400)) {
      const rows = db.prepare(`SELECT course_id, deadline_at FROM course_learning_state
        WHERE user_id = ? AND course_id IN (${courseIdBatch.map(() => '?').join(', ')})`)
        .all(user.id, ...courseIdBatch);
      for (const row of rows) deadlinesByCourse.set(row.course_id, row.deadline_at);
    }
  }

  const enrolledPathIds = new Set();
  if (user) {
    for (const pathIdBatch of splitIntoBatches(pathIds, 500)) {
      const rows = db.prepare(`SELECT path_id FROM learning_path_enrollments
        WHERE user_id = ? AND path_id IN (${pathIdBatch.map(() => '?').join(', ')})`)
        .all(user.id, ...pathIdBatch);
      for (const row of rows) enrolledPathIds.add(row.path_id);
    }
  }

  return paths.map((path) => {
    const rows = rowsByPath.get(path.id);
    const summaries = summariesByPath.get(path.id);
    let allEarlierCoursesCompleted = true;
    let completedCount = 0;
    const courses = rows.map((row, index) => {
      const summary = summaries[index];
      const unlocked = user ? !row.requires_previous || row.position === 0 || allEarlierCoursesCompleted : false;
      allEarlierCoursesCompleted = allEarlierCoursesCompleted && summary.completed;
      if (summary.completed) completedCount++;
      return { ...summary, position: row.position, requiresPrevious: Boolean(row.requires_previous), unlocked,
        deadlineAt: deadlinesByCourse.get(row.course_id) ?? null };
    });
    return { ...path, selfEnrollment: Boolean(path.self_enrollment), enrolled: enrolledPathIds.has(path.id),
      completedCourses: completedCount, courseCount: courses.length,
      completed: Boolean(courses.length && completedCount === courses.length), courses };
  });
}

function pathPayload(path, user) {
  return pathPayloads([path], user)[0];
}

programsRouter.get('/learning-paths', (req, res) => {
  const staff = ['admin', 'moderator'].includes(req.currentUser.role);
  const requestedPage = pageQuery(req.query.page);
  const statusFilter = staff ? staffPathStatusFilter(req.query.status) : null;
  const searchText = text(req.query.q, 'Search', 120);
  const search = searchText ? textSearchPredicate(['p.title', 'p.description'], searchText) : null;
  const searchClause = search ? ` AND (${search.sql})` : '';
  const searchParams = search?.params || [];
  const total = staff
    ? db.prepare(`SELECT COUNT(*) AS count FROM learning_paths p WHERE ${statusFilter.sql}${searchClause}`).get(...statusFilter.params, ...searchParams).count
    : db.prepare(`SELECT COUNT(DISTINCT p.id) AS count FROM learning_paths p
      LEFT JOIN learning_path_enrollments e ON e.path_id = p.id AND e.user_id = ?
      WHERE p.status = 'published' AND (e.id IS NOT NULL OR (${SELF_ENROLLMENT_PATH_COURSE_FILTER}))${searchClause}`)
      .get(req.currentUser.id, ...searchParams).count;
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / LEARNING_PATH_PAGE_SIZE)));
  const paths = staff
    ? db.prepare(`SELECT p.* FROM learning_paths p WHERE ${statusFilter.sql}${searchClause} ORDER BY p.updated_at DESC, p.id LIMIT ? OFFSET ?`)
      .all(...statusFilter.params, ...searchParams, LEARNING_PATH_PAGE_SIZE, (page - 1) * LEARNING_PATH_PAGE_SIZE)
    : db.prepare(`SELECT DISTINCT p.* FROM learning_paths p LEFT JOIN learning_path_enrollments e ON e.path_id = p.id AND e.user_id = ?
      WHERE p.status = 'published' AND (e.id IS NOT NULL OR (${SELF_ENROLLMENT_PATH_COURSE_FILTER}))${searchClause}
      ORDER BY p.title COLLATE NOCASE, p.id LIMIT ? OFFSET ?`)
      .all(req.currentUser.id, ...searchParams, LEARNING_PATH_PAGE_SIZE, (page - 1) * LEARNING_PATH_PAGE_SIZE);
  res.json({ paths: pathPayloads(paths, req.currentUser), total, page, pageSize: LEARNING_PATH_PAGE_SIZE,
    hasMore: page * LEARNING_PATH_PAGE_SIZE < total });
});

programsRouter.post('/learning-paths/:pathId/enroll', (req, res) => {
  const enroll = db.transaction(() => {
    const path = db.prepare("SELECT * FROM learning_paths WHERE id = ? AND status = 'published'").get(req.params.pathId);
    if (!path) fail(404, 'Learning path not found.', 'not_found');
    if (!path.self_enrollment || req.currentUser.role !== 'learner') fail(403, 'This learning path is not open for self-enrollment.', 'forbidden');
    if (!selfEnrollmentPathIsAvailable(path.id)) {
      fail(409, 'This path is not available for self-enrollment right now.', 'path_unavailable');
    }
    const result = db.prepare(`INSERT OR IGNORE INTO learning_path_enrollments (id, path_id, user_id, enrollment_source)
      VALUES (?, ?, ?, 'self')`).run(randomUUID(), path.id, req.currentUser.id);
    syncUnlockedPathStates([path.id], req.currentUser.id);
    if (result.changes) logAudit(req.currentUser, 'path.enrolled', 'learning_path', path.id, `Enrolled in learning path: ${path.title}`);
    return { created: result.changes > 0, path: pathPayload(path, req.currentUser) };
  });
  const enrollment = enroll.immediate();
  // Keep the retry successful without reporting that it created a second enrollment.
  res.status(enrollment.created ? 201 : 200).json({ path: enrollment.path });
});

programsRouter.get('/learning-paths/:pathId', (req, res) => {
  const path = db.prepare('SELECT * FROM learning_paths WHERE id = ?').get(req.params.pathId);
  if (!path) fail(404, 'Learning path not found.', 'not_found');
  const enrollment = db.prepare('SELECT 1 FROM learning_path_enrollments WHERE path_id = ? AND user_id = ?').get(path.id, req.currentUser.id);
  if (!['admin', 'moderator'].includes(req.currentUser.role) && !enrollment && !selfEnrollmentPathIsAvailable(path.id)) fail(404, 'Learning path not found.', 'not_found');
  res.json({ path: pathPayload(path, req.currentUser) });
});

programsRouter.get('/manage/learning-paths', requireStaff, (req, res) => {
  const requestedPage = pageQuery(req.query.page);
  const statusFilter = staffPathStatusFilter(req.query.status);
  const total = db.prepare(`SELECT COUNT(*) AS count FROM learning_paths WHERE ${statusFilter.sql}`).get(...statusFilter.params).count;
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / LEARNING_PATH_PAGE_SIZE)));
  const paths = db.prepare(`SELECT * FROM learning_paths WHERE ${statusFilter.sql} ORDER BY updated_at DESC, id LIMIT ? OFFSET ?`)
    .all(...statusFilter.params, LEARNING_PATH_PAGE_SIZE, (page - 1) * LEARNING_PATH_PAGE_SIZE);
  res.json({ paths: pathPayloads(paths, null), total, page, pageSize: LEARNING_PATH_PAGE_SIZE,
    hasMore: page * LEARNING_PATH_PAGE_SIZE < total });
});

function normalizePathCourses(courseInput, selfEnrollment) {
  if (!Array.isArray(courseInput) || courseInput.length > MAX_LEARNING_PATH_COURSES) {
    fail(400, `Provide an ordered list of up to ${MAX_LEARNING_PATH_COURSES} courses.`, 'validation_error');
  }
  const inputIds = courseInput.map((item) => typeof item?.courseId === 'string' ? item.courseId : '');
  const distinctInputIds = [...new Set(inputIds)];
  const courseIdByInputId = logicalCourseIds(distinctInputIds);
  const courseIds = inputIds.map((id) => courseIdByInputId.get(id) || id);
  const distinctCourseIds = [...new Set(courseIds)];
  const publishedCourses = distinctCourseIds.length
    ? db.prepare(`SELECT * FROM courses WHERE id IN (${distinctCourseIds.map(() => '?').join(', ')})
      AND logical_course_id IS NULL AND status = 'published'`).all(...distinctCourseIds)
    : [];
  const courseById = new Map(publishedCourses.map((course) => [course.id, course]));
  const seen = new Set();
  return courseInput.map((item, position) => {
    const courseId = courseIds[position];
    const course = courseById.get(courseId);
    if (!course) fail(400, 'Learning paths can include published courses only.', 'invalid_path_course');
    if (seen.has(courseId)) fail(400, 'A course can appear only once in a learning path.', 'duplicate_path_course');
    if (selfEnrollment && course.visibility !== 'public') fail(400, 'Self-enrollable paths can contain public courses only.', 'private_self_enrollment_course');
    seen.add(courseId);
    const requiresPrevious = item?.requiresPrevious === undefined
      ? position > 0
      : booleanValue(item.requiresPrevious, 'Previous-course requirement');
    return { courseId, position, requiresPrevious: position === 0 ? false : requiresPrevious };
  });
}

function allPathCoursesArePublic(courseIds) {
  const distinctIds = [...new Set(courseIds)];
  if (!distinctIds.length) return true;
  const publicCourses = db.prepare(`SELECT id FROM courses WHERE id IN (${distinctIds.map(() => '?').join(', ')}) AND visibility = 'public'`)
    .all(...distinctIds);
  return publicCourses.length === distinctIds.length;
}

function savePathCourses(pathId, rows) {
  db.prepare('DELETE FROM learning_path_courses WHERE path_id = ?').run(pathId);
  const add = db.prepare(`INSERT INTO learning_path_courses (id, path_id, course_id, position, requires_previous)
    VALUES (?, ?, ?, ?, ?)`);
  for (const row of rows) add.run(randomUUID(), pathId, row.courseId, row.position, row.requiresPrevious ? 1 : 0);
}

programsRouter.post('/manage/learning-paths', requireStaff, (req, res) => {
  const body = req.body || {};
  const title = text(body.title, 'Path title', 160, true);
  const description = text(body.description, 'Description', 6000);
  const selfEnrollment = body.selfEnrollment === undefined ? false : booleanValue(body.selfEnrollment, 'Self-enrollment');
  const status = body.status === undefined ? 'draft' : body.status;
  if (!['draft', 'published'].includes(status)) fail(400, 'Choose draft or published for this learning path.', 'validation_error');
  const id = randomUUID();
  // Build the returned path before commit so summary-read failures roll back creation and audit logging.
  const create = db.transaction(() => {
    const courses = normalizePathCourses(body.courses === undefined ? [] : body.courses, selfEnrollment);
    if (status === 'published' && courses.length === 0) fail(400, 'Add at least one course before publishing a learning path.', 'empty_path');
    db.prepare(`INSERT INTO learning_paths (id, title, description, status, self_enrollment, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, title, description, status, selfEnrollment ? 1 : 0, req.currentUser.id, req.currentUser.id);
    savePathCourses(id, courses);
    logAudit(req.currentUser, 'path.created', 'learning_path', id, `Created learning path: ${title}`, { courseCount: courses.length, status, selfEnrollment });
    return pathPayload(db.prepare('SELECT * FROM learning_paths WHERE id = ?').get(id), null);
  });
  const path = create.immediate();
  res.status(201).json({ path });
});

programsRouter.patch('/manage/learning-paths/:pathId', requireStaff, (req, res) => {
  const body = requireObjectBody(req.body, 'Learning path changes');
  // Resolve course summaries before commit, including for no-op saves, to keep errors atomic.
  const update = db.transaction(() => {
    const current = db.prepare('SELECT * FROM learning_paths WHERE id = ?').get(req.params.pathId);
    if (!current) fail(404, 'Learning path not found.', 'not_found');
    const title = body.title === undefined ? current.title : text(body.title, 'Path title', 160, true);
    const description = body.description === undefined ? current.description : text(body.description, 'Description', 6000);
    const selfEnrollment = body.selfEnrollment === undefined ? Boolean(current.self_enrollment) : booleanValue(body.selfEnrollment, 'Self-enrollment');
    const status = body.status === undefined ? current.status : body.status;
    if (!['draft', 'published', 'archived'].includes(status)) fail(400, 'Choose a valid path status.', 'validation_error');
    const existingCourses = db.prepare('SELECT course_id, requires_previous FROM learning_path_courses WHERE path_id = ? ORDER BY position').all(current.id);
    const courses = body.courses === undefined ? existingCourses.map((row) => ({ courseId: row.course_id, requiresPrevious: Boolean(row.requires_previous) }))
      : normalizePathCourses(body.courses, selfEnrollment);
    if (status === 'published' && courses.length === 0) fail(400, 'Add at least one course before publishing a learning path.', 'empty_path');
    if (status !== 'archived' && selfEnrollment && body.courses === undefined && !allPathCoursesArePublic(courses.map((step) => step.courseId))) {
      fail(400, 'Self-enrollable paths can contain public courses only.', 'private_self_enrollment_course');
    }
    const coursesChanged = courses.length !== existingCourses.length || courses.some((course, index) =>
      course.courseId !== existingCourses[index]?.course_id
      || course.requiresPrevious !== Boolean(existingCourses[index]?.requires_previous));
    const changed = title !== current.title
      || description !== current.description
      || selfEnrollment !== Boolean(current.self_enrollment)
      || status !== current.status
      || coursesChanged;
    if (!changed) return pathPayload(current, null);
    db.prepare(`UPDATE learning_paths SET title = ?, description = ?, self_enrollment = ?, status = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(title, description, selfEnrollment ? 1 : 0, status, req.currentUser.id, current.id);
    if (coursesChanged) {
      savePathCourses(current.id, courses);
      const enrolledLearners = db.prepare('SELECT user_id FROM learning_path_enrollments WHERE path_id = ?').all(current.id);
      syncUnlockedPathStatesForEnrollments(current.id, enrolledLearners);
    }
    logAudit(req.currentUser, 'path.updated', 'learning_path', current.id, `Updated learning path: ${title}`, { status, selfEnrollment, courseCount: courses.length });
    return pathPayload(db.prepare('SELECT * FROM learning_paths WHERE id = ?').get(current.id), null);
  });
  const path = update.immediate();
  res.json({ path });
});

programsRouter.post('/manage/learning-paths/:pathId/assignments', requireStaff, (req, res) => {
  const result = db.transaction(() => {
    const path = db.prepare("SELECT * FROM learning_paths WHERE id = ? AND status = 'published'").get(req.params.pathId);
    if (!path) fail(404, 'Published learning path not found.', 'not_found');
    const userId = req.body?.userId;
    if (typeof userId !== 'string' || !userId.trim()) fail(400, 'Choose a learner to assign.', 'validation_error');
    const learner = db.prepare("SELECT id, username FROM users WHERE id = ? AND role = 'learner' AND disabled = 0").get(userId);
    if (!learner) fail(404, 'Active learner not found.', 'learner_not_found');
    const inserted = db.prepare(`INSERT OR IGNORE INTO learning_path_enrollments (id, path_id, user_id, enrollment_source, assigned_by)
      VALUES (?, ?, ?, 'assigned', ?)`).run(randomUUID(), path.id, learner.id, req.currentUser.id);
    syncUnlockedPathStates([path.id], learner.id);
    if (inserted.changes) logAudit(req.currentUser, 'path.assigned', 'learning_path', path.id, `Assigned ${learner.username} to learning path: ${path.title}`, { learnerId: learner.id });
  });
  result.immediate();
  res.status(204).end();
});

programsRouter.get('/manage/learning-paths/:pathId/learners', requireStaff, (req, res) => {
  const path = db.prepare('SELECT id FROM learning_paths WHERE id = ?').get(req.params.pathId);
  if (!path) fail(404, 'Learning path not found.', 'not_found');
  const query = text(req.query.q, 'Search', 100);
  const requestedPage = pageQuery(req.query.page, 100_000);
  const search = query ? textSearchPredicate(['u.username', 'u.email'], query) : null;
  const searchClause = search ? ` AND (${search.sql})` : '';
  const searchParams = search?.params || [];
  const where = `u.role = 'learner' AND u.disabled = 0${searchClause}`;
  const total = db.prepare(`SELECT COUNT(*) AS count FROM users u WHERE ${where}`).get(...searchParams).count;
  const pageSize = 50;
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));
  const offset = (page - 1) * pageSize;
  const enrolledTotal = db.prepare(`SELECT COUNT(*) AS count FROM learning_path_enrollments e
    CROSS JOIN users u ON u.id = e.user_id WHERE e.path_id = ? AND ${where}`)
    .get(path.id, ...searchParams).count;
  const enrolledLimit = Math.min(pageSize, Math.max(0, enrolledTotal - offset));
  const learners = enrolledLimit ? db.prepare(`SELECT u.id, u.username, u.email, e.enrollment_source, e.enrolled_at
    FROM learning_path_enrollments e CROSS JOIN users u ON u.id = e.user_id
    WHERE e.path_id = ? AND ${where} ORDER BY u.username COLLATE NOCASE LIMIT ? OFFSET ?`)
    .all(path.id, ...searchParams, enrolledLimit, offset) : [];
  const unassignedLimit = pageSize - learners.length;
  if (unassignedLimit) learners.push(...db.prepare(`SELECT u.id, u.username, u.email,
    NULL AS enrollment_source, NULL AS enrolled_at FROM users u
    WHERE NOT EXISTS (SELECT 1 FROM learning_path_enrollments e WHERE e.path_id = ? AND e.user_id = u.id)
      AND ${where}
    ORDER BY u.username COLLATE NOCASE LIMIT ? OFFSET ?`)
    .all(path.id, ...searchParams, unassignedLimit, Math.max(0, offset - enrolledTotal)));
  res.json({ learners: learners.map((item) => ({ id: item.id, username: item.username, email: item.email,
    enrolled: Boolean(item.enrollment_source), source: item.enrollment_source, enrolledAt: item.enrolled_at })),
  total, page, pageSize, hasMore: page * pageSize < total });
});

programsRouter.delete('/manage/learning-paths/:pathId/assignments/:userId', requireStaff, (req, res) => {
  const remove = db.transaction(() => {
    const path = db.prepare('SELECT id, title FROM learning_paths WHERE id = ?').get(req.params.pathId);
    if (!path) fail(404, 'Learning path not found.', 'not_found');
    const result = db.prepare("DELETE FROM learning_path_enrollments WHERE path_id = ? AND user_id = ? AND enrollment_source = 'assigned'")
      .run(path.id, req.params.userId);
    if (result.changes) logAudit(req.currentUser, 'path.assignment_removed', 'learning_path', path.id, `Removed a learner from learning path: ${path.title}`, { learnerId: req.params.userId });
  });
  remove.immediate();
  res.status(204).end();
});

programsRouter.get('/calendar', (req, res) => {
  const from = typeof req.query.from === 'string' ? req.query.from : '';
  const to = typeof req.query.to === 'string' ? req.query.to : '';
  if (!isCalendarDate(from) || !isCalendarDate(to) || from > to) fail(400, 'Choose a valid calendar date range.', 'validation_error');
  const rangeDays = (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000 + 1;
  if (rangeDays > MAX_CALENDAR_RANGE_DAYS) fail(400, `Calendar date range must be ${MAX_CALENDAR_RANGE_DAYS} days or fewer.`, 'validation_error');
  // Stored timestamps use ISO `T` or SQLite's space separator, both before this inclusive-day sentinel.
  const endExclusive = `${to}Z`;
  const items = db.prepare(`SELECT s.course_id AS id, s.course_id, s.deadline_at, s.started_at, c.title, c.category, c.visibility, c.status, c.logical_course_id
    FROM course_learning_state s JOIN courses c ON c.id = s.course_id
    WHERE s.user_id = ? AND s.deadline_at >= ? AND s.deadline_at < ?
      AND c.status = 'published' ORDER BY s.deadline_at, c.title COLLATE NOCASE, c.id ASC`).all(req.currentUser.id, from, endExclusive);
  const canView = createCourseAccessChecker(req.currentUser);
  const visibleItems = items.filter((item) => item.visibility === 'public' || canView(item));
  const validItems = [];
  const invalidDeadlineCourseIds = [];
  for (const item of visibleItems) {
    const dueAt = calendarDeadlineDate(item.deadline_at);
    if (!dueAt) {
      if (invalidDeadlineCourseIds.length < 10) invalidDeadlineCourseIds.push(item.course_id);
      continue;
    }
    validItems.push({ ...item, dueAt });
  }
  const invalidDeadlineCount = visibleItems.length - validItems.length;
  if (invalidDeadlineCount > 0) {
    writeSystemLog('warn', 'calendar', 'Malformed course deadlines were omitted from the calendar response.', {
      invalidDeadlineCount,
      courseIds: invalidDeadlineCourseIds,
    });
  }
  const summaries = courseSummaries(validItems, req.currentUser);
  const now = Date.now();
  res.json({ hasInvalidDeadlines: invalidDeadlineCount > 0, items: validItems.map((item, index) => {
    const completed = summaries[index].completed;
    const { dueAt } = item;
    return { courseId: item.course_id, title: item.title, category: item.category, dueAt: dueAt.toISOString(),
      status: completed ? 'completed' : dueAt.getTime() < now ? 'overdue' : 'upcoming', completed,
      url: `/courses/${item.course_id}` };
  }) });
});

programsRouter.get('/competencies', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) AS count FROM competencies WHERE active = 1').get().count;
  const requestedPage = pageQuery(req.query.page);
  const pageSize = COMPETENCY_PROGRESS_PAGE_SIZE;
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));
  const offset = (page - 1) * pageSize;
  const pageRows = db.prepare(`SELECT * FROM competencies WHERE active = 1
    ORDER BY title COLLATE NOCASE, id ASC LIMIT ? OFFSET ?`).all(pageSize, offset);
  const summaryIds = pageRows.map((item) => item.id);
  const pageCourses = summaryIds.length ? db.prepare(`SELECT cc.competency_id, c.* FROM course_competencies cc
    JOIN competencies competency ON competency.id = cc.competency_id
    JOIN courses c ON c.id = cc.course_id
    WHERE competency.active = 1 AND c.status = 'published'
      AND cc.competency_id IN (${summaryIds.map(() => '?').join(', ')})
    ORDER BY cc.competency_id, c.title COLLATE NOCASE, c.id ASC`).all(...summaryIds) : [];
  const canView = createCourseAccessChecker(req.currentUser);
  const visiblePageCourses = pageCourses.filter((course) => course.visibility === 'public' || canView(course));
  const summaryCourses = [...new Map(visiblePageCourses.map((course) => [course.id, course])).values()];
  const summaries = courseSummaries(summaryCourses, req.currentUser);
  const summariesByCourseId = new Map(summaryCourses.map((course, index) => [course.id, summaries[index]]));
  const coursesByCompetency = new Map(pageRows.map((item) => [item.id, []]));
  visiblePageCourses.forEach((course) => {
    coursesByCompetency.get(course.competency_id)?.push({
      id: course.id,
      title: course.title,
      completed: summariesByCourseId.get(course.id)?.completed ?? false,
    });
  });
  const mappedCompetencies = pageRows.map((item) => {
    const mapped = coursesByCompetency.get(item.id);
    const completedCourses = mapped.filter((course) => course.completed).length;
    return { id: item.id, title: item.title, description: item.description, achieved: mapped.some((course) => course.completed),
      completedCourses, courseCount: mapped.length, courses: mapped };
  });
  const achievedCompetencyIds = new Set();
  if (page === 1) {
    // Keyset batches keep history scans and course-summary IN lists bounded on large accounts.
    const achievementCandidates = db.prepare(`SELECT c.* FROM courses c
      WHERE c.status = 'published' AND (? IS NULL OR c.id > ?)
        AND EXISTS (SELECT 1 FROM course_competencies cc JOIN competencies competency ON competency.id = cc.competency_id
          WHERE cc.course_id = c.id AND competency.active = 1)
        AND (
          EXISTS (SELECT 1 FROM lesson_progress p
            JOIN lessons l ON l.id = p.lesson_id JOIN course_modules m ON m.id = l.module_id
            JOIN courses progress_course ON progress_course.id = m.course_id
            WHERE p.user_id = ? AND (progress_course.id = COALESCE(c.logical_course_id, c.id)
              OR progress_course.logical_course_id = COALESCE(c.logical_course_id, c.id)))
          OR EXISTS (SELECT 1 FROM quiz_attempts a
            JOIN quizzes q ON q.id = a.quiz_id JOIN course_modules m ON m.id = q.module_id
            JOIN courses progress_course ON progress_course.id = m.course_id
            WHERE a.user_id = ? AND a.passed = 1 AND (progress_course.id = COALESCE(c.logical_course_id, c.id)
              OR progress_course.logical_course_id = COALESCE(c.logical_course_id, c.id)))
        )
      ORDER BY c.id ASC LIMIT ?`);
    let lastCourseId = null;
    while (true) {
      const candidateBatch = achievementCandidates.all(lastCourseId, lastCourseId, req.currentUser.id,
        req.currentUser.id, COMPETENCY_ACHIEVEMENT_BATCH_SIZE);
      if (!candidateBatch.length) break;
      lastCourseId = candidateBatch.at(-1).id;

      const visibleCandidates = candidateBatch.filter((course) => course.visibility === 'public' || canView(course));
      const uncachedCourses = visibleCandidates.filter((course) => !summariesByCourseId.has(course.id));
      const candidateSummaries = courseSummaries(uncachedCourses, req.currentUser);
      uncachedCourses.forEach((course, index) => summariesByCourseId.set(course.id, candidateSummaries[index]));

      const completedCourseIds = visibleCandidates
        .filter((course) => summariesByCourseId.get(course.id)?.completed)
        .map((course) => course.id);
      if (!completedCourseIds.length) continue;
      const mappedCompetencies = db.prepare(`SELECT DISTINCT cc.competency_id FROM course_competencies cc
        JOIN competencies competency ON competency.id = cc.competency_id
        WHERE competency.active = 1 AND cc.course_id IN (${completedCourseIds.map(() => '?').join(', ')})`)
        .all(...completedCourseIds);
      mappedCompetencies.forEach((item) => achievedCompetencyIds.add(item.competency_id));
    }
  }
  res.json({
    competencies: mappedCompetencies,
    total,
    ...(page === 1 ? { achievedTotal: achievedCompetencyIds.size } : {}),
    page,
    pageSize,
    hasMore: page * pageSize < total,
  });
});

programsRouter.get('/admin/competencies', requireAdmin, (req, res) => {
  const query = text(req.query.q, 'Search', 100);
  const search = query ? textSearchPredicate(['title', 'description'], query) : null;
  const where = search ? `WHERE (${search.sql})` : '';
  const params = search?.params ?? [];
  const requestedPage = pageQuery(req.query.page);
  const total = db.prepare(`SELECT COUNT(*) AS count FROM competencies ${where}`).get(...params).count;
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / COMPETENCY_ADMIN_PAGE_SIZE)));
  const competencies = db.prepare(`SELECT * FROM competencies ${where}
    ORDER BY active DESC, title COLLATE NOCASE, id LIMIT ? OFFSET ?`)
    .all(...params, COMPETENCY_ADMIN_PAGE_SIZE, (page - 1) * COMPETENCY_ADMIN_PAGE_SIZE);
  res.json({ competencies, total, page, pageSize: COMPETENCY_ADMIN_PAGE_SIZE,
    hasMore: page * COMPETENCY_ADMIN_PAGE_SIZE < total });
});

programsRouter.post('/admin/competencies', requireAdmin, (req, res) => {
  const title = text(req.body?.title, 'Competency title', 160, true);
  const description = text(req.body?.description, 'Description', 2000);
  const id = randomUUID();
  const create = db.transaction(() => {
    if (db.prepare('SELECT 1 FROM competencies WHERE title = ?').get(title)) {
      fail(409, 'A competency with this name already exists.', 'duplicate_competency');
    }
    db.prepare('INSERT INTO competencies (id, title, description, created_by) VALUES (?, ?, ?, ?)').run(id, title, description, req.currentUser.id);
    logAudit(req.currentUser, 'competency.created', 'competency', id, `Created competency: ${title}`);
    const competency = db.prepare('SELECT * FROM competencies WHERE id = ?').get(id);
    return { competency, page: competencyAdminPage(competency) };
  });
  res.status(201).json(create.immediate());
});

programsRouter.patch('/admin/competencies/:competencyId', requireAdmin, (req, res) => {
  const query = text(req.query.q, 'Search', 100);
  const body = requireObjectBody(req.body, 'Competency changes');
  const change = db.transaction(() => {
    const current = db.prepare('SELECT * FROM competencies WHERE id = ?').get(req.params.competencyId);
    if (!current) fail(404, 'Competency not found.', 'not_found');
    const title = body.title === undefined ? current.title : text(body.title, 'Competency title', 160, true);
    const description = body.description === undefined ? current.description : text(body.description, 'Description', 2000);
    const active = body.active === undefined ? current.active : Number(booleanValue(body.active, 'Competency active status'));
    if (title !== current.title && db.prepare('SELECT 1 FROM competencies WHERE title = ? AND id <> ?').get(title, current.id)) {
      fail(409, 'A competency with this name already exists.', 'duplicate_competency');
    }
    if (title !== current.title || description !== current.description || active !== current.active) {
      db.prepare(`UPDATE competencies SET title = ?, description = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(title, description, active, current.id);
      logAudit(req.currentUser, 'competency.updated', 'competency', current.id, `Updated competency: ${title}`, { active: Boolean(active) });
    }
    const competency = db.prepare('SELECT * FROM competencies WHERE id = ?').get(current.id);
    return { competency, page: competencyAdminPage(competency, query) };
  });
  res.json(change.immediate());
});

programsRouter.delete('/admin/competencies/:competencyId', requireAdmin, (req, res) => {
  const remove = db.transaction(() => {
    const current = db.prepare('SELECT * FROM competencies WHERE id = ?').get(req.params.competencyId);
    if (!current) fail(404, 'Competency not found.', 'not_found');
    db.prepare('DELETE FROM competencies WHERE id = ?').run(current.id);
    logAudit(req.currentUser, 'competency.deleted', 'competency', current.id, `Deleted competency: ${current.title}`);
  });
  remove.immediate();
  res.status(204).end();
});

programsRouter.get('/manage/courses/:courseId/competencies', requireStaff, (req, res) => {
  requireCourseManager(req.params.courseId, req.currentUser);
  const courseId = logicalCourseId(req.params.courseId) || req.params.courseId;
  const competencies = db.prepare('SELECT competency_id AS id FROM course_competencies WHERE course_id = ?').all(courseId).map((row) => row.id);
  const available = db.prepare(`SELECT * FROM competencies c WHERE c.active = 1
    OR EXISTS (SELECT 1 FROM course_competencies cc WHERE cc.course_id = ? AND cc.competency_id = c.id)
    ORDER BY c.active DESC, c.title COLLATE NOCASE`).all(courseId);
  res.json({ competencies: available, selected: competencies, selectionLimit: COURSE_COMPETENCY_SELECTION_LIMIT });
});

programsRouter.put('/manage/courses/:courseId/competencies', requireStaff, (req, res) => {
  const update = db.transaction(() => {
    requireCourseManager(req.params.courseId, req.currentUser);
    const courseId = logicalCourseId(req.params.courseId) || req.params.courseId;
    const ids = req.body?.competencyIds;
    if (!Array.isArray(ids) || ids.length > COURSE_COMPETENCY_SELECTION_LIMIT || ids.some((id) => typeof id !== 'string')) fail(400, 'Choose a valid competency list.', 'validation_error');
    const unique = [...new Set(ids)];
    const existing = new Set(db.prepare('SELECT competency_id FROM course_competencies WHERE course_id = ?').all(courseId).map((row) => row.competency_id));
    const available = new Set(db.prepare(`SELECT id FROM competencies WHERE active = 1
      OR id IN (SELECT competency_id FROM course_competencies WHERE course_id = ?)`)
      .all(courseId).map((row) => row.id));
    if (unique.some((id) => !available.has(id))) fail(400, 'One or more competencies are unavailable.', 'invalid_competency');
    const changed = unique.length !== existing.size || unique.some((id) => !existing.has(id));
    if (changed) {
      db.prepare('DELETE FROM course_competencies WHERE course_id = ?').run(courseId);
      const insert = db.prepare('INSERT INTO course_competencies (course_id, competency_id, created_by) VALUES (?, ?, ?)');
      for (const id of unique) insert.run(courseId, id, req.currentUser.id);
      logAudit(req.currentUser, 'competency.course_mapping_changed', 'course', courseId, 'Updated course competency mapping', { competencyIds: unique });
    }
    return unique;
  });
  res.json({ selected: update.immediate() });
});

programsRouter.get('/manage/courses/:courseId/versions', requireStaff, (req, res) => {
  requireCourseManager(req.params.courseId, req.currentUser);
  const courseId = logicalCourseId(req.params.courseId) || req.params.courseId;
  const requestedPage = pageQuery(req.query.page);
  const historySummary = db.prepare('SELECT COUNT(*) AS count, MAX(version_number) AS currentVersionNumber FROM course_versions WHERE course_id = ?').get(courseId);
  const currentVersionNumber = historySummary.currentVersionNumber;
  const currentVersion = currentVersionNumber === null ? null : courseVersionHistoryPage(courseId, 1, 0)[0] ?? null;
  const total = Math.max(0, historySummary.count - Number(currentVersionNumber !== null));
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / COURSE_VERSION_PAGE_SIZE)));
  const revision = db.prepare('SELECT r.*, u.username AS author FROM course_revisions r LEFT JOIN users u ON u.id = r.author_id WHERE r.course_id = ?').get(courseId);
  res.json({ currentVersion, versions: courseVersionHistoryPage(courseId, COURSE_VERSION_PAGE_SIZE,
    (page - 1) * COURSE_VERSION_PAGE_SIZE + Number(currentVersionNumber !== null)),
    total, page, pageSize: COURSE_VERSION_PAGE_SIZE, hasMore: page * COURSE_VERSION_PAGE_SIZE < total,
    revision: revision ? {
    status: revision.review_status, author: revision.author, submittedAt: revision.submitted_at,
    submittedBy: revision.submitted_by, reviewedBy: revision.reviewed_by, reviewNote: revision.review_note,
  } : null });
});

programsRouter.post('/manage/courses/:courseId/review', requireStaff, (req, res) => {
  const submit = db.transaction(() => {
    const course = requireCourseManager(req.params.courseId, req.currentUser);
    const courseId = course.logical_course_id || course.id;
    const revision = db.prepare('SELECT * FROM course_revisions WHERE course_id = ?').get(courseId);
    if (!revision) fail(409, 'There are no unpublished course changes to submit.', 'revision_missing');
    if (revision.review_status === 'in_review') fail(409, 'This revision is already awaiting review.', 'review_already_pending');
    const note = text(req.body?.note, 'Submission note', 1000);
    db.prepare(`UPDATE course_revisions SET review_status = 'in_review', submitted_by = ?, submitted_at = CURRENT_TIMESTAMP,
      reviewed_by = NULL, reviewed_at = NULL, review_note = ?, updated_at = CURRENT_TIMESTAMP WHERE course_id = ?`)
      .run(req.currentUser.id, note, courseId);
    logAudit(req.currentUser, 'course.revision_submitted', 'course', courseId, `Submitted ${course.title} for review`, { revisionCourseId: revision.revision_course_id, note });
    return { status: 'in_review' };
  });
  res.json(submit.immediate());
});

programsRouter.post('/manage/courses/:courseId/review/decision', requireStaff, (req, res) => {
  const outcome = req.body?.decision;
  if (!['approve', 'changes_requested'].includes(outcome)) fail(400, 'Choose approve or request changes.', 'validation_error');
  const decide = db.transaction(() => {
    const current = requireCourseManager(req.params.courseId, req.currentUser);
    const logicalId = current.logical_course_id || current.id;
    const revision = db.prepare('SELECT * FROM course_revisions WHERE course_id = ?').get(logicalId);
    if (!revision || revision.review_status !== 'in_review') fail(409, 'This revision is not awaiting review.', 'review_not_pending');
    if (revision.submitted_by === req.currentUser.id) fail(403, 'A different administrator or moderator must review this revision.', 'self_review_forbidden');
    const requestsChanges = outcome === 'changes_requested';
    // A change request must give its editor actionable feedback; approval notes remain optional.
    const noteLabel = requestsChanges ? 'Review note' : 'Publication note';
    const noteLimit = requestsChanges ? 1000 : 500;
    const note = text(req.body?.note, noteLabel, noteLimit, requestsChanges);
    if (requestsChanges) {
      db.prepare(`UPDATE course_revisions SET review_status = 'changes_requested', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP,
        review_note = ?, updated_at = CURRENT_TIMESTAMP WHERE course_id = ?`).run(req.currentUser.id, note, logicalId);
      logAudit(req.currentUser, 'course.review_changes_requested', 'course', logicalId, `Requested changes to ${current.title}`, { note });
      return { status: 'changes_requested' };
    }
    const requiresRecompletion = req.body?.requiresRecompletion === undefined
      ? false : booleanValue(req.body.requiresRecompletion, 'Recompletion option');
    const published = publishRevision(logicalId, req.currentUser, { requiresRecompletion, changeNote: note || 'Approved revision' });
    logAudit(req.currentUser, 'course.review_approved', 'course', logicalId, `Approved and published ${current.title}`, { versionId: published.id, requiresRecompletion });
    return { status: 'published', version: published };
  });
  res.json(decide.immediate());
});

programsRouter.post('/manage/courses/:courseId/versions/:versionId/restore', requireStaff, (req, res) => {
  const restore = db.transaction(() => {
    const current = requireCourseManager(req.params.courseId, req.currentUser);
    const logicalId = current.logical_course_id || current.id;
    const source = db.prepare('SELECT id, version_number FROM course_versions WHERE id = ? AND course_id = ?')
      .get(req.params.versionId, logicalId);
    if (!source) fail(404, 'Course version not found.', 'not_found');
    const requiresRecompletion = req.body?.requiresRecompletion === undefined
      ? false : booleanValue(req.body.requiresRecompletion, 'Recompletion option');
    const restored = restoreCourseVersion(logicalId, source.id, req.currentUser, { requiresRecompletion });
    logAudit(req.currentUser, 'course.version_restored', 'course', logicalId, `Restored ${current.title} from version ${source.version_number}`, { sourceVersionId: source.id, versionId: restored.id });
    return { version: restored };
  });
  res.json(restore.immediate());
});
