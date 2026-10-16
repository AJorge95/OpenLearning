import { randomUUID } from 'node:crypto';
import { db } from './db.js';

const cloneId = () => randomUUID();
const courseIdentityByIdStatement = db.prepare('SELECT id, logical_course_id FROM courses WHERE id = ?');
const courseIdentityByModuleStatement = db.prepare(`SELECT c.id, c.logical_course_id FROM courses c
  JOIN course_modules m ON m.course_id = c.id WHERE m.id = ?`);
const courseIdentityByLessonStatement = db.prepare(`SELECT c.id, c.logical_course_id FROM courses c
  JOIN course_modules m ON m.course_id = c.id JOIN lessons l ON l.module_id = m.id WHERE l.id = ?`);
const courseIdentityByQuizStatement = db.prepare(`SELECT c.id, c.logical_course_id FROM quizzes q
  LEFT JOIN course_modules m ON m.id = q.module_id
  JOIN courses c ON c.id = COALESCE(m.course_id, q.course_id) WHERE q.id = ?`);
const publishedVersionLookupStatement = db.prepare(`SELECT v.*, c.title, c.description, c.category, c.visibility, c.status,
    c.cover_media_id, c.created_by, c.updated_by, c.updated_at, c.completion_window_days
  FROM course_versions v JOIN courses c ON c.id = v.storage_course_id
  WHERE v.course_id = ? ORDER BY v.version_number DESC LIMIT 1`);

function groupRowsBy(rows, key) {
  const grouped = new Map();
  for (const row of rows) {
    const items = grouped.get(row[key]) ?? [];
    items.push(row);
    grouped.set(row[key], items);
  }
  return grouped;
}

export function logicalCourseId(courseId) {
  const row = courseIdentityByIdStatement.get(courseId)
    ?? courseIdentityByModuleStatement.get(courseId)
    ?? courseIdentityByLessonStatement.get(courseId)
    ?? courseIdentityByQuizStatement.get(courseId);
  return row ? (row.logical_course_id || row.id) : null;
}

export function logicalCourseIds(courseIds) {
  const ids = [...new Set(courseIds.filter((id) => typeof id === 'string' && id))];
  if (!ids.length) return new Map();

  // Resolve the bounded path selection in one statement instead of four lookups per unknown ID.
  const requestedIds = ids.map(() => '(?)').join(', ');
  const rows = db.prepare(`WITH requested(id) AS (VALUES ${requestedIds})
    SELECT requested.id AS input_id,
      COALESCE(direct_course.logical_course_id, direct_course.id,
        module_course.logical_course_id, module_course.id,
        lesson_course.logical_course_id, lesson_course.id,
        quiz_course.logical_course_id, quiz_course.id) AS logical_course_id
    FROM requested
    LEFT JOIN courses direct_course ON direct_course.id = requested.id
    LEFT JOIN course_modules module ON module.id = requested.id
    LEFT JOIN courses module_course ON module_course.id = module.course_id
    LEFT JOIN lessons lesson ON lesson.id = requested.id
    LEFT JOIN course_modules lesson_module ON lesson_module.id = lesson.module_id
    LEFT JOIN courses lesson_course ON lesson_course.id = lesson_module.course_id
    LEFT JOIN quizzes quiz ON quiz.id = requested.id
     LEFT JOIN course_modules quiz_module ON quiz_module.id = quiz.module_id
     LEFT JOIN courses quiz_course ON quiz_course.id = COALESCE(quiz_module.course_id, quiz.course_id)`).all(...ids);
  return new Map(rows.filter((row) => row.logical_course_id).map((row) => [row.input_id, row.logical_course_id]));
}

export function publishedVersionForLogicalCourse(logicalCourseIdValue) {
  return publishedVersionLookupStatement.get(logicalCourseIdValue) ?? null;
}

export function publishedVersion(courseId) {
  const id = logicalCourseId(courseId) || courseId;
  return publishedVersionForLogicalCourse(id);
}

function copyPublishedContent(sourceId, targetId, logicalId, actorId) {
  const source = db.prepare('SELECT * FROM courses WHERE id = ?').get(sourceId);
  if (!source) return null;
  const mediaIds = new Map();
  const mediaRows = db.prepare(`SELECT DISTINCT mf.* FROM media_files mf WHERE mf.id = ? OR mf.id IN (
    SELECT l.media_id FROM lessons l JOIN course_modules m ON m.id = l.module_id WHERE m.course_id = ? AND l.media_id IS NOT NULL
  )`).all(source.cover_media_id || '', sourceId);
  const addMedia = db.prepare(`INSERT INTO media_files (id, course_id, original_name, file_name, mime_type, byte_size, media_kind, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const media of mediaRows) {
    const nextMediaId = cloneId();
    mediaIds.set(media.id, nextMediaId);
    addMedia.run(nextMediaId, logicalId, media.original_name, media.file_name, media.mime_type, media.byte_size, media.media_kind, media.created_at);
  }
  db.prepare(`INSERT INTO courses (id, title, description, category, visibility, status, cover_media_id,
      created_by, updated_by, created_at, updated_at, logical_course_id, completion_window_days)
    VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)`)
    .run(targetId, source.title, source.description, source.category, source.visibility, mediaIds.get(source.cover_media_id) || source.cover_media_id,
      source.created_by, actorId, source.created_at, logicalId, source.completion_window_days ?? null);

  const moduleIds = new Map();
  const lessonIds = new Map();
  const quizIds = new Map();
  const questionIds = new Map();
  const modules = db.prepare('SELECT * FROM course_modules WHERE course_id = ? ORDER BY position, id').all(sourceId);
  const addModule = db.prepare('INSERT INTO course_modules (id, course_id, title, position, created_at, stable_id) VALUES (?, ?, ?, ?, ?, ?)');
  const addLesson = db.prepare(`INSERT INTO lessons (id, module_id, title, description, transcript, media_id, position, created_at, stable_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const addQuiz = db.prepare(`INSERT INTO quizzes
    (id, module_id, course_id, title, pass_mark, questions_per_attempt, required_for_completion, created_at, updated_at, stable_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const getLessons = db.prepare(`SELECT l.* FROM lessons l
    JOIN course_modules m ON m.id = l.module_id WHERE m.course_id = ?
    ORDER BY m.position, m.id, l.position, l.id`);
  const getResources = db.prepare(`SELECT lr.* FROM lesson_resources lr
    JOIN lessons l ON l.id = lr.lesson_id JOIN course_modules m ON m.id = l.module_id
    WHERE m.course_id = ? ORDER BY m.position, m.id, l.position, l.id, lr.position, lr.id`);
  const getCaptions = db.prepare(`SELECT lc.* FROM lesson_captions lc
    JOIN lessons l ON l.id = lc.lesson_id JOIN course_modules m ON m.id = l.module_id
    WHERE m.course_id = ? ORDER BY m.position, m.id, l.position, l.id, lc.id`);
  const getQuizzes = db.prepare(`SELECT q.* FROM quizzes q LEFT JOIN course_modules m ON m.id = q.module_id
    WHERE COALESCE(m.course_id, q.course_id) = ? ORDER BY CASE WHEN q.course_id IS NULL THEN 0 ELSE 1 END, m.position, m.id`);
  const getQuestions = db.prepare(`SELECT qq.* FROM quiz_questions qq
    JOIN quizzes q ON q.id = qq.quiz_id LEFT JOIN course_modules m ON m.id = q.module_id
    WHERE COALESCE(m.course_id, q.course_id) = ? ORDER BY m.position, m.id, qq.position, qq.id`);
  const getChoices = db.prepare(`SELECT qc.* FROM quiz_choices qc
    JOIN quiz_questions qq ON qq.id = qc.question_id JOIN quizzes q ON q.id = qq.quiz_id
    LEFT JOIN course_modules m ON m.id = q.module_id
    WHERE COALESCE(m.course_id, q.course_id) = ? ORDER BY m.position, m.id, qq.position, qq.id, qc.position, qc.id`);
  const addResource = db.prepare(`INSERT INTO lesson_resources (id, lesson_id, resource_type, title, href, file_name, original_name, mime_type, byte_size, position, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const addCaption = db.prepare(`INSERT INTO lesson_captions (id, lesson_id, language, label, file_name, original_name, byte_size, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const addQuestion = db.prepare('INSERT INTO quiz_questions (id, quiz_id, prompt, explanation, position) VALUES (?, ?, ?, ?, ?)');
  const addChoice = db.prepare('INSERT INTO quiz_choices (id, question_id, choice_text, is_correct, position) VALUES (?, ?, ?, ?, ?)');
  // Read each content table once, then copy its rows from the in-memory groups.
  const groupCourseRows = (statement, key) => groupRowsBy(statement.all(sourceId), key);
  const lessonsByModule = groupCourseRows(getLessons, 'module_id');
  const resourcesByLesson = lessonsByModule.size ? groupCourseRows(getResources, 'lesson_id') : new Map();
  const captionsByLesson = lessonsByModule.size ? groupCourseRows(getCaptions, 'lesson_id') : new Map();
  const quizRows = getQuizzes.all(sourceId);
  const quizByModule = new Map(quizRows.filter((quiz) => quiz.module_id).map((quiz) => [quiz.module_id, quiz]));
  const courseFinalExam = quizRows.find((quiz) => quiz.course_id === sourceId);
  const questionsByQuiz = quizRows.length ? groupCourseRows(getQuestions, 'quiz_id') : new Map();
  const choicesByQuestion = questionsByQuiz.size ? groupCourseRows(getChoices, 'question_id') : new Map();
  const copyQuiz = (quiz, nextModuleId, nextCourseId) => {
    const nextQuizId = cloneId();
    quizIds.set(quiz.id, nextQuizId);
    addQuiz.run(nextQuizId, nextModuleId, nextCourseId, quiz.title, quiz.pass_mark, quiz.questions_per_attempt,
      quiz.required_for_completion, quiz.created_at, quiz.updated_at, quiz.stable_id || quiz.id);
    const questions = questionsByQuiz.get(quiz.id) ?? [];
    for (const question of questions) {
      const nextQuestionId = cloneId();
      questionIds.set(question.id, nextQuestionId);
      addQuestion.run(nextQuestionId, nextQuizId, question.prompt, question.explanation, question.position);
      for (const choice of choicesByQuestion.get(question.id) ?? []) {
        addChoice.run(cloneId(), nextQuestionId, choice.choice_text, choice.is_correct, choice.position);
      }
    }
  };
  for (const module of modules) {
    const nextModuleId = cloneId();
    moduleIds.set(module.id, nextModuleId);
    addModule.run(nextModuleId, targetId, module.title, module.position, module.created_at, module.stable_id || module.id);
    for (const lesson of lessonsByModule.get(module.id) ?? []) {
      const nextLessonId = cloneId();
      lessonIds.set(lesson.id, nextLessonId);
      addLesson.run(nextLessonId, nextModuleId, lesson.title, lesson.description, lesson.transcript, mediaIds.get(lesson.media_id) || lesson.media_id,
        lesson.position, lesson.created_at, lesson.stable_id || lesson.id);
      for (const resource of resourcesByLesson.get(lesson.id) ?? []) {
        addResource.run(cloneId(), nextLessonId, resource.resource_type, resource.title, resource.href, resource.file_name,
          resource.original_name, resource.mime_type, resource.byte_size, resource.position, resource.created_at);
      }
      for (const caption of captionsByLesson.get(lesson.id) ?? []) {
        addCaption.run(cloneId(), nextLessonId, caption.language, caption.label, caption.file_name, caption.original_name, caption.byte_size, caption.created_at);
      }
    }
    const quiz = quizByModule.get(module.id);
    if (quiz) copyQuiz(quiz, nextModuleId, null);
  }
  if (courseFinalExam) copyQuiz(courseFinalExam, null, targetId);
  return { moduleIds, lessonIds, quizIds, questionIds };
}

export function editableCourse(courseId, actor) {
  const logicalId = logicalCourseId(courseId) || courseId;
  const root = db.prepare('SELECT * FROM courses WHERE id = ? AND logical_course_id IS NULL').get(logicalId);
  if (!root) return null;
  const hasVersions = db.prepare('SELECT 1 FROM course_versions WHERE course_id = ? LIMIT 1').get(logicalId);
  if (!hasVersions) return root;
  const existing = db.prepare(`SELECT c.* FROM course_revisions r JOIN courses c ON c.id = r.revision_course_id WHERE r.course_id = ?`).get(logicalId);
  if (existing) return existing;
  const latest = publishedVersion(logicalId);
  if (!latest) return root;
  const revisionId = cloneId();
  const createRevision = db.transaction(() => {
    const existingRevision = db.prepare('SELECT revision_course_id FROM course_revisions WHERE course_id = ?').get(logicalId);
    if (existingRevision) return existingRevision.revision_course_id;
    if (!copyPublishedContent(latest.storage_course_id, revisionId, logicalId, actor.id)) return null;
    db.prepare(`INSERT INTO course_revisions (course_id, revision_course_id, author_id, requires_recompletion)
      VALUES (?, ?, ?, 0)`).run(logicalId, revisionId, actor.id);
    return revisionId;
  });
  const resolvedRevisionId = createRevision.immediate();
  if (!resolvedRevisionId) return root;
  return db.prepare('SELECT * FROM courses WHERE id = ?').get(resolvedRevisionId);
}

export function currentPublishedCourse(courseId) {
  const id = logicalCourseId(courseId) || courseId;
  return db.prepare(`SELECT * FROM courses WHERE id = COALESCE(
    (SELECT storage_course_id FROM course_versions WHERE course_id = ? ORDER BY version_number DESC LIMIT 1), ?
  )`).get(id, id);
}

export function currentPublishedCourseForVersion(logicalCourseIdValue, version) {
  return db.prepare('SELECT * FROM courses WHERE id = ?').get(version?.storage_course_id || logicalCourseIdValue) ?? null;
}

export function courseVersionHistoryPage(courseId, pageSize, offset) {
  const id = logicalCourseId(courseId) || courseId;
  return db.prepare(`SELECT v.*, u.username AS publisher, c.title
    FROM course_versions v LEFT JOIN users u ON u.id = v.published_by
    JOIN courses c ON c.id = v.storage_course_id
    WHERE v.course_id = ? ORDER BY v.version_number DESC LIMIT ? OFFSET ?`).all(id, pageSize, offset);
}

export function publishRevision(courseId, actor, { requiresRecompletion = false, changeNote = '' } = {}) {
  const logicalId = logicalCourseId(courseId) || courseId;
  const root = db.prepare('SELECT * FROM courses WHERE id = ? AND logical_course_id IS NULL').get(logicalId);
  const revision = db.prepare('SELECT * FROM course_revisions WHERE course_id = ?').get(logicalId);
  let storage = revision ? db.prepare('SELECT * FROM courses WHERE id = ?').get(revision.revision_course_id) : root;
  if (!root || !storage) return null;
  const firstDurationEnabled = !root.completion_window_activated && storage.completion_window_days > 0;
  const versionNumber = db.prepare('SELECT COALESCE(MAX(version_number), 0) + 1 AS next FROM course_versions WHERE course_id = ?').get(logicalId).next;
  if (versionNumber === 1 && requiresRecompletion && storage.id === root.id) {
    // Legacy published courses can have completion rows on the same IDs as
    // their first version. New IDs let reset-required progress ignore those
    // rows while preserving the historical completion records.
    const firstVersionStorageId = cloneId();
    if (!copyPublishedContent(storage.id, firstVersionStorageId, logicalId, actor.id)) return null;
    storage = db.prepare('SELECT * FROM courses WHERE id = ?').get(firstVersionStorageId);
    if (!storage) return null;
  }
  const versionId = cloneId();
  db.prepare(`UPDATE courses SET logical_course_id = ?, status = 'published', updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(logicalId === storage.id ? null : logicalId, actor.id, storage.id);
  db.prepare(`UPDATE courses SET title = ?, description = ?, category = ?, visibility = ?, status = 'published', cover_media_id = ?,
      completion_window_days = ?, completion_window_activated = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(storage.title, storage.description, storage.category, storage.visibility, storage.cover_media_id,
      storage.completion_window_days ?? null, root.completion_window_activated || storage.completion_window_days > 0 ? 1 : 0, actor.id, logicalId);
  db.prepare(`INSERT INTO course_versions (id, course_id, storage_course_id, version_number, published_by, requires_recompletion, change_note)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(versionId, logicalId, storage.id, versionNumber, actor.id, requiresRecompletion ? 1 : 0, changeNote.slice(0, 500));
  db.prepare('DELETE FROM course_revisions WHERE course_id = ?').run(logicalId);
  const stateRows = db.prepare(`SELECT DISTINCT user_id FROM (
      SELECT user_id FROM enrollments WHERE course_id = ?
      UNION SELECT user_id FROM course_grants WHERE course_id = ?
      UNION SELECT user_id FROM course_learning_state WHERE course_id = ?
    )`).all(logicalId, logicalId, logicalId);
  const saveState = db.prepare(`INSERT INTO course_learning_state (user_id, course_id, target_version_id)
      VALUES (?, ?, ?) ON CONFLICT(user_id, course_id) DO UPDATE SET target_version_id = excluded.target_version_id`);
  for (const row of stateRows) saveState.run(row.user_id, logicalId, requiresRecompletion ? versionId : null);
  if (firstDurationEnabled) {
    const deadline = new Date(Date.now() + storage.completion_window_days * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`UPDATE course_learning_state SET deadline_at = ?, deadline_window_days = ?
      WHERE course_id = ? AND deadline_at IS NULL`).run(deadline, storage.completion_window_days, logicalId);
  }
  return db.prepare(`SELECT v.*, c.title FROM course_versions v JOIN courses c ON c.id = v.storage_course_id WHERE v.id = ?`).get(versionId);
}

export function restoreCourseVersion(courseId, versionId, actor, { requiresRecompletion = false } = {}) {
  const logicalId = logicalCourseId(courseId) || courseId;
  const selected = db.prepare('SELECT * FROM course_versions WHERE id = ? AND course_id = ?').get(versionId, logicalId);
  const root = db.prepare('SELECT * FROM courses WHERE id = ? AND logical_course_id IS NULL').get(logicalId);
  if (!selected || !root) return null;
  const previous = db.prepare('SELECT * FROM courses WHERE id = ?').get(selected.storage_course_id);
  const firstDurationEnabled = !root.completion_window_activated && previous.completion_window_days > 0;
  const pendingRevision = db.prepare('SELECT revision_course_id FROM course_revisions WHERE course_id = ?').get(logicalId);
  if (pendingRevision) db.prepare('DELETE FROM courses WHERE id = ?').run(pendingRevision.revision_course_id);
  const storageId = cloneId();
  if (!copyPublishedContent(selected.storage_course_id, storageId, logicalId, actor.id)) return null;
  db.prepare(`UPDATE courses SET status = 'published', updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(actor.id, storageId);
  const number = db.prepare('SELECT COALESCE(MAX(version_number), 0) + 1 AS next FROM course_versions WHERE course_id = ?').get(logicalId).next;
  const newVersionId = cloneId();
  db.prepare(`UPDATE courses SET title = ?, description = ?, category = ?, visibility = ?, status = 'published', cover_media_id = ?,
      completion_window_days = ?, completion_window_activated = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(previous.title, previous.description, previous.category, previous.visibility, db.prepare('SELECT cover_media_id FROM courses WHERE id = ?').get(storageId).cover_media_id,
      previous.completion_window_days ?? null, root.completion_window_activated || previous.completion_window_days > 0 ? 1 : 0, actor.id, logicalId);
  db.prepare(`INSERT INTO course_versions (id, course_id, storage_course_id, version_number, published_by, requires_recompletion, change_note)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(newVersionId, logicalId, storageId, number, actor.id, requiresRecompletion ? 1 : 0, `Restored from version ${selected.version_number}`);
  const learners = db.prepare(`SELECT DISTINCT user_id FROM (
    SELECT user_id FROM enrollments WHERE course_id = ? UNION SELECT user_id FROM course_grants WHERE course_id = ?
    UNION SELECT user_id FROM course_learning_state WHERE course_id = ?
  )`).all(logicalId, logicalId, logicalId);
  if (firstDurationEnabled) {
    const deadline = new Date(Date.now() + previous.completion_window_days * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`UPDATE course_learning_state SET deadline_at = ?, deadline_window_days = ?
      WHERE course_id = ? AND deadline_at IS NULL`).run(deadline, previous.completion_window_days, logicalId);
  }
  const saveState = db.prepare(`INSERT INTO course_learning_state (user_id, course_id, target_version_id)
    VALUES (?, ?, ?) ON CONFLICT(user_id, course_id) DO UPDATE SET target_version_id = excluded.target_version_id`);
  for (const learner of learners) saveState.run(learner.user_id, logicalId, requiresRecompletion ? newVersionId : null);
  return db.prepare('SELECT * FROM course_versions WHERE id = ?').get(newVersionId);
}

export function cloneVersionToRevision(courseId, versionId, actor) {
  const logicalId = logicalCourseId(courseId) || courseId;
  const selected = db.prepare('SELECT * FROM course_versions WHERE id = ? AND course_id = ?').get(versionId, logicalId);
  if (!selected) return null;
  const current = db.prepare('SELECT * FROM course_revisions WHERE course_id = ?').get(logicalId);
  if (current) db.prepare('DELETE FROM courses WHERE id = ?').run(current.revision_course_id);
  const revisionId = cloneId();
  if (!copyPublishedContent(selected.storage_course_id, revisionId, logicalId, actor.id)) return null;
  db.prepare(`INSERT INTO course_revisions (course_id, revision_course_id, author_id) VALUES (?, ?, ?)
    ON CONFLICT(course_id) DO UPDATE SET revision_course_id = excluded.revision_course_id, author_id = excluded.author_id,
      review_status = 'draft', submitted_by = NULL, submitted_at = NULL, reviewed_by = NULL, reviewed_at = NULL, review_note = ''`)
    .run(logicalId, revisionId, actor.id);
  return { id: revisionId, logicalCourseId: logicalId };
}

export function canonicalCourse(courseId) {
  const id = logicalCourseId(courseId) || courseId;
  return db.prepare('SELECT * FROM courses WHERE id = ? AND logical_course_id IS NULL').get(id) ?? null;
}

