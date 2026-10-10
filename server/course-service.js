import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { fail, canViewCourse } from './http.js';
import { currentPublishedCourseForVersion, publishedVersion, publishedVersionForLogicalCourse } from './course-versioning.js';

function progressForStorage(logicalId, contentId, user, version) {
  const lessonRows = db.prepare(`SELECT l.id, COALESCE(l.stable_id, l.id) AS stable_id FROM lessons l
    JOIN course_modules m ON m.id = l.module_id WHERE m.course_id = ?`).all(contentId);
  const quizRows = db.prepare(`SELECT q.id, COALESCE(q.stable_id, q.id) AS stable_id FROM quizzes q
    JOIN course_modules m ON m.id = q.module_id WHERE m.course_id = ?`).all(contentId);
  if (!user) return { completedLessonIds: new Set(), passedQuizIds: new Set() };
  const state = db.prepare('SELECT target_version_id FROM course_learning_state WHERE user_id = ? AND course_id = ?').get(user.id, logicalId);
  const resetRequired = Boolean(version && state?.target_version_id === version.id);
  const lessonHistory = db.prepare(`SELECT l.id, COALESCE(l.stable_id, l.id) AS stable_id FROM lesson_progress p
    JOIN lessons l ON l.id = p.lesson_id JOIN course_modules m ON m.id = l.module_id
    JOIN courses c ON c.id = m.course_id WHERE p.user_id = ? AND (c.id = ? OR c.logical_course_id = ?)`)
    .all(user.id, logicalId, logicalId);
  const quizHistory = db.prepare(`SELECT DISTINCT q.id, COALESCE(q.stable_id, q.id) AS stable_id FROM quiz_attempts a
    JOIN quizzes q ON q.id = a.quiz_id JOIN course_modules m ON m.id = q.module_id JOIN courses c ON c.id = m.course_id
    WHERE a.user_id = ? AND a.passed = 1 AND (c.id = ? OR c.logical_course_id = ?)`)
    .all(user.id, logicalId, logicalId);
  const lessonHistoryIds = new Set(lessonHistory.map((saved) => saved.id));
  const lessonHistoryStableIds = new Set(lessonHistory.map((saved) => saved.stable_id));
  const quizHistoryIds = new Set(quizHistory.map((saved) => saved.id));
  const quizHistoryStableIds = new Set(quizHistory.map((saved) => saved.stable_id));
  const completedLessonIds = new Set(lessonRows.filter((active) => resetRequired
    ? lessonHistoryIds.has(active.id)
    : lessonHistoryStableIds.has(active.stable_id)).map((row) => row.id));
  const passedQuizIds = new Set(quizRows.filter((active) => resetRequired
    ? quizHistoryIds.has(active.id)
    : quizHistoryStableIds.has(active.stable_id)).map((row) => row.id));
  return { completedLessonIds, passedQuizIds };
}

function courseSummaryDetails(courses, user, preloadedVersionsByCourse, preloadedContentCoursesById) {
  if (!courses.length) return [];
  const logicalIdsByCourse = courses.map((course) => course.logical_course_id || course.id);
  const logicalIds = [...new Set(logicalIdsByCourse)];
  const logicalPlaceholders = logicalIds.map(() => '?').join(', ');
  const latestVersionsByCourse = preloadedVersionsByCourse ?? new Map(db.prepare(`
    SELECT v.course_id, v.id, v.storage_course_id, v.version_number
    FROM course_versions v
    JOIN (
      SELECT course_id, MAX(version_number) AS version_number
      FROM course_versions WHERE course_id IN (${logicalPlaceholders}) GROUP BY course_id
    ) latest ON latest.course_id = v.course_id AND latest.version_number = v.version_number
  `).all(...logicalIds).map((row) => [row.course_id, row]));
  const contentIdByCourse = new Map(logicalIds.map((id) => [id, latestVersionsByCourse.get(id)?.storage_course_id ?? id]));
  const contentIds = [...new Set(contentIdByCourse.values())];
  const contentPlaceholders = contentIds.map(() => '?').join(', ');
  const contentCoursesById = new Map(preloadedContentCoursesById);
  for (const [index, course] of courses.entries()) {
    const contentId = contentIdByCourse.get(logicalIdsByCourse[index]);
    if (course.id === contentId) contentCoursesById.set(contentId, course);
  }
  const missingContentIds = contentIds.filter((id) => !contentCoursesById.has(id));
  if (missingContentIds.length) {
    const missingContentPlaceholders = missingContentIds.map(() => '?').join(', ');
    for (const row of db.prepare(`SELECT * FROM courses WHERE id IN (${missingContentPlaceholders})`).all(...missingContentIds)) {
      contentCoursesById.set(row.id, row);
    }
  }
  const countsByCourse = new Map(db.prepare(`
    SELECT c.id,
      (SELECT COUNT(*) FROM course_modules m WHERE m.course_id = c.id) AS module_count,
      (SELECT COUNT(*) FROM lessons l JOIN course_modules m ON m.id = l.module_id WHERE m.course_id = c.id) AS lesson_count,
      (SELECT username FROM users WHERE id = c.created_by) AS owner
    FROM courses c WHERE c.id IN (${contentPlaceholders})
  `).all(...contentIds).map((row) => [row.id, row]));
  const lessonsByCourse = new Map();
  for (const row of db.prepare(`SELECT m.course_id, l.id, COALESCE(l.stable_id, l.id) AS stable_id
    FROM lessons l JOIN course_modules m ON m.id = l.module_id
    WHERE m.course_id IN (${contentPlaceholders})`).all(...contentIds)) {
    const lessons = lessonsByCourse.get(row.course_id) ?? [];
    lessons.push(row);
    lessonsByCourse.set(row.course_id, lessons);
  }
  const quizzesByCourse = new Map();
  for (const row of db.prepare(`SELECT m.course_id, q.id, COALESCE(q.stable_id, q.id) AS stable_id
    FROM quizzes q JOIN course_modules m ON m.id = q.module_id
    WHERE m.course_id IN (${contentPlaceholders})`).all(...contentIds)) {
    const quizzes = quizzesByCourse.get(row.course_id) ?? [];
    quizzes.push(row);
    quizzesByCourse.set(row.course_id, quizzes);
  }
  const learningStateByCourse = new Map();
  const lessonHistoryByCourse = new Map();
  const quizHistoryByCourse = new Map();
  if (user) {
    for (const row of db.prepare(`SELECT course_id, target_version_id, deadline_at FROM course_learning_state
      WHERE user_id = ? AND course_id IN (${logicalPlaceholders})`).all(user.id, ...logicalIds)) {
      learningStateByCourse.set(row.course_id, row);
    }
    for (const row of db.prepare(`SELECT COALESCE(c.logical_course_id, c.id) AS course_id, l.id,
        COALESCE(l.stable_id, l.id) AS stable_id
      FROM lesson_progress p JOIN lessons l ON l.id = p.lesson_id
      JOIN course_modules m ON m.id = l.module_id JOIN courses c ON c.id = m.course_id
      WHERE p.user_id = ? AND (c.id IN (${logicalPlaceholders}) OR c.logical_course_id IN (${logicalPlaceholders}))`)
      .all(user.id, ...logicalIds, ...logicalIds)) {
      const history = lessonHistoryByCourse.get(row.course_id) ?? { ids: new Set(), stableIds: new Set() };
      history.ids.add(row.id);
      history.stableIds.add(row.stable_id);
      lessonHistoryByCourse.set(row.course_id, history);
    }
    for (const row of db.prepare(`SELECT DISTINCT COALESCE(c.logical_course_id, c.id) AS course_id, q.id,
        COALESCE(q.stable_id, q.id) AS stable_id
      FROM quiz_attempts a JOIN quizzes q ON q.id = a.quiz_id
      JOIN course_modules m ON m.id = q.module_id JOIN courses c ON c.id = m.course_id
      WHERE a.user_id = ? AND a.passed = 1
        AND (c.id IN (${logicalPlaceholders}) OR c.logical_course_id IN (${logicalPlaceholders}))`)
      .all(user.id, ...logicalIds, ...logicalIds)) {
      const history = quizHistoryByCourse.get(row.course_id) ?? { ids: new Set(), stableIds: new Set() };
      history.ids.add(row.id);
      history.stableIds.add(row.stable_id);
      quizHistoryByCourse.set(row.course_id, history);
    }
  }
  return courses.map((course, index) => {
    const logicalId = logicalIdsByCourse[index];
    const contentId = contentIdByCourse.get(logicalId);
    const content = contentCoursesById.get(contentId) || course;
    const counts = countsByCourse.get(content.id);
    const version = latestVersionsByCourse.get(logicalId);
    const learningState = learningStateByCourse.get(logicalId);
    const resetRequired = Boolean(user && version && learningState?.target_version_id === version.id);
    const lessonHistory = lessonHistoryByCourse.get(logicalId);
    const quizHistory = quizHistoryByCourse.get(logicalId);
    const activeLessons = lessonsByCourse.get(content.id) ?? [];
    const activeQuizzes = quizzesByCourse.get(content.id) ?? [];
    const completedLessonIds = new Set(activeLessons.filter((row) => resetRequired
      ? lessonHistory?.ids.has(row.id)
      : lessonHistory?.stableIds.has(row.stable_id)).map((row) => row.id));
    const quizCount = activeQuizzes.length;
    const passedQuizIds = new Set(activeQuizzes.filter((row) => resetRequired
      ? quizHistory?.ids.has(row.id)
      : quizHistory?.stableIds.has(row.stable_id)).map((row) => row.id));
    const completedLessons = completedLessonIds.size;
    const passedQuizzes = passedQuizIds.size;
    const requiredItems = counts.lesson_count + quizCount;
    const completedItems = completedLessons + passedQuizzes;
    const progress = requiredItems > 0 ? Math.round((completedItems / requiredItems) * 100) : 0;
    const completed = requiredItems > 0 && completedItems === requiredItems;
    return {
      summary: {
        id: course.id,
        title: course.title,
        description: course.description,
        category: course.category,
        visibility: course.visibility,
        status: course.status,
        coverMediaId: course.cover_media_id,
        coverUrl: course.cover_media_id ? `/media/${course.cover_media_id}` : null,
        createdBy: course.created_by,
        owner: course.owner ?? counts.owner,
        updatedAt: course.updated_at,
        moduleCount: counts.module_count,
        lessonCount: counts.lesson_count,
        completedLessons,
        progress,
        completed,
        completionWindowDays: course.completion_window_days ?? null,
        versionNumber: version?.version_number ?? null,
        deadlineAt: learningState?.deadline_at ?? null,
      },
      contentId: content.id,
      completedLessonIds,
      passedQuizIds,
    };
  });
}

export function courseSummaries(courses, user, preloadedVersionsByCourse) {
  return courseSummaryDetails(courses, user, preloadedVersionsByCourse).map(({ summary }) => summary);
}

export function courseSummary(course, user, preloadedVersionsByCourse) {
  return courseSummaryDetails([course], user, preloadedVersionsByCourse)[0].summary;
}

export function getCoursePayload(course, user, { includeAnswers = false, storageCourseId } = {}) {
  const logicalId = course.logical_course_id || course.id;
  const editingCopy = Boolean(course.logical_course_id && includeAnswers);
  const version = publishedVersionForLogicalCourse(logicalId);
  const content = storageCourseId ? db.prepare('SELECT * FROM courses WHERE id = ?').get(storageCourseId)
    : editingCopy ? course : currentPublishedCourseForVersion(logicalId, version) || course;
  const rootCourse = course.id === logicalId ? course : db.prepare('SELECT * FROM courses WHERE id = ?').get(logicalId) || course;
  const summaryContentId = version?.storage_course_id || logicalId;
  const preloadedSummaryContent = content.id === summaryContentId ? new Map([[content.id, content]]) : undefined;
  const summaryDetails = courseSummaryDetails([rootCourse], user, new Map([[logicalId, version]]), preloadedSummaryContent)[0];
  const summary = summaryDetails.summary;
  const resultSummary = editingCopy ? { ...summary, title: course.title, description: course.description,
    category: course.category, visibility: course.visibility,
    completionWindowDays: course.completion_window_days ?? null,
    hasUnpublishedChanges: true,
    reviewStatus: db.prepare('SELECT review_status FROM course_revisions WHERE course_id = ?').get(logicalId)?.review_status || 'draft',
  } : summary;
  const contentId = content.id;
  const versionProgress = contentId === summaryDetails.contentId ? summaryDetails : progressForStorage(logicalId, contentId, user, version);
  const lessonResources = new Map();
  for (const resource of db.prepare(`
    SELECT lr.id, lr.lesson_id, lr.resource_type, lr.title, lr.href, lr.original_name
    FROM lesson_resources lr
    JOIN lessons l ON l.id = lr.lesson_id
    JOIN course_modules m ON m.id = l.module_id
    WHERE m.course_id = ?
    ORDER BY lr.lesson_id, lr.position, lr.id
  `).all(contentId)) {
    const resources = lessonResources.get(resource.lesson_id) ?? [];
    resources.push({
      id: resource.id,
      kind: resource.resource_type,
      title: resource.title,
      url: resource.resource_type === 'link' ? resource.href : `/media/resources/${resource.id}`,
      fileName: resource.original_name,
    });
    lessonResources.set(resource.lesson_id, resources);
  }
  const captionsByLesson = new Map();
  for (const caption of db.prepare(`
    SELECT lc.id, lc.lesson_id, lc.language, lc.label, lc.original_name
    FROM lesson_captions lc
    JOIN lessons l ON l.id = lc.lesson_id
    JOIN course_modules m ON m.id = l.module_id
    WHERE m.course_id = ?
    ORDER BY lc.lesson_id, lc.language
  `).all(contentId)) {
    const captions = captionsByLesson.get(caption.lesson_id) ?? [];
    captions.push({
      id: caption.id,
      language: caption.language,
      label: caption.label,
      url: `/media/captions/${caption.id}`,
      fileName: caption.original_name,
    });
    captionsByLesson.set(caption.lesson_id, captions);
  }
  const completedLessonIds = versionProgress.completedLessonIds;
  const quizChoicesByQuestion = new Map();
  for (const choice of db.prepare(`
    SELECT qc.id, qc.question_id, qc.choice_text, qc.is_correct
    FROM quiz_choices qc
    JOIN quiz_questions qq ON qq.id = qc.question_id
    JOIN quizzes q ON q.id = qq.quiz_id
    JOIN course_modules m ON m.id = q.module_id
    WHERE m.course_id = ?
    ORDER BY qq.position, qq.id, qc.position, qc.id
  `).all(contentId)) {
    const choices = quizChoicesByQuestion.get(choice.question_id) ?? [];
    choices.push(choice);
    quizChoicesByQuestion.set(choice.question_id, choices);
  }
  const moduleRows = db.prepare('SELECT * FROM course_modules WHERE course_id = ? ORDER BY position, id').all(contentId);
  const lessonsByModule = new Map();
  for (const lesson of db.prepare(`
    SELECT l.*, mf.original_name, mf.mime_type
    FROM lessons l
    JOIN course_modules m ON m.id = l.module_id
    LEFT JOIN media_files mf ON mf.id = l.media_id
    WHERE m.course_id = ?
    ORDER BY m.position, m.id, l.position, l.id
  `).all(contentId)) {
    const lessons = lessonsByModule.get(lesson.module_id) ?? [];
    lessons.push({
      id: lesson.id,
      title: lesson.title,
      description: lesson.description,
      transcript: lesson.transcript,
      position: lesson.position,
      mediaId: lesson.media_id,
      mediaUrl: lesson.media_id ? `/media/${lesson.media_id}` : null,
      videoName: lesson.original_name,
      hasVideo: Boolean(lesson.media_id),
      resources: lessonResources.get(lesson.id) ?? [],
      captions: captionsByLesson.get(lesson.id) ?? [],
      completed: completedLessonIds.has(lesson.id),
    });
    lessonsByModule.set(lesson.module_id, lessons);
  }

  const quizzesByModule = new Map();
  for (const quiz of db.prepare(`
    SELECT q.* FROM quizzes q
    JOIN course_modules m ON m.id = q.module_id
    WHERE m.course_id = ?
  `).all(contentId)) {
    quizzesByModule.set(quiz.module_id, quiz);
  }

  const questionsByQuiz = new Map();
  for (const question of db.prepare(`
    SELECT qq.* FROM quiz_questions qq
    JOIN quizzes q ON q.id = qq.quiz_id
    JOIN course_modules m ON m.id = q.module_id
    WHERE m.course_id = ?
    ORDER BY m.position, m.id, qq.position, qq.id
  `).all(contentId)) {
    const questions = questionsByQuiz.get(question.quiz_id) ?? [];
    questions.push({
      id: question.id,
      prompt: question.prompt,
      explanation: question.explanation,
      choices: (quizChoicesByQuestion.get(question.id) ?? []).map((choice) => ({
        id: choice.id,
        text: choice.choice_text,
        ...(includeAnswers ? { isCorrect: Boolean(choice.is_correct) } : {}),
      })),
    });
    questionsByQuiz.set(question.quiz_id, questions);
  }

  const latestAttemptsByQuiz = new Map();
  const passedQuizIds = new Set();
  if (user) {
    for (const attempt of db.prepare(`
      SELECT q.id AS quiz_id, a.id, a.score, a.passed, a.submitted_at,
        EXISTS (
          SELECT 1 FROM quiz_attempts p
          WHERE p.user_id = ? AND p.quiz_id = q.id AND p.passed = 1
        ) AS any_passed
      FROM course_modules m
      JOIN quizzes q ON q.module_id = m.id
      LEFT JOIN quiz_attempts a ON a.rowid = (
        SELECT newest.rowid FROM quiz_attempts newest
        WHERE newest.user_id = ? AND newest.quiz_id = q.id
        ORDER BY newest.submitted_at DESC, newest.rowid DESC LIMIT 1
      )
      WHERE m.course_id = ?
    `).all(user.id, user.id, contentId)) {
      if (attempt.id !== null) latestAttemptsByQuiz.set(attempt.quiz_id, attempt);
      if (attempt.any_passed) passedQuizIds.add(attempt.quiz_id);
    }
  }

  let anEarlierLessonIsIncomplete = false;
  const modules = moduleRows.map((module) => {
    const lessons = (lessonsByModule.get(module.id) ?? []).map((lesson) => {
      const locked = user?.role === 'learner' && anEarlierLessonIsIncomplete;
      if (user?.role === 'learner' && !completedLessonIds.has(lesson.id)) anEarlierLessonIsIncomplete = true;
      return locked ? {
        ...lesson,
        description: '',
        transcript: '',
        mediaId: null,
        mediaUrl: null,
        videoName: null,
        hasVideo: false,
        resources: [],
        captions: [],
        locked: true,
      } : { ...lesson, locked: false };
    });
    const quiz = quizzesByModule.get(module.id);
    let quizData = null;
    if (quiz) {
      const latestAttempt = latestAttemptsByQuiz.get(quiz.id);
      quizData = {
        id: quiz.id,
        title: quiz.title,
        passMark: quiz.pass_mark,
        questions: questionsByQuiz.get(quiz.id) ?? [],
        latestAttempt: latestAttempt ? { id: latestAttempt.id, score: latestAttempt.score, passed: Boolean(latestAttempt.passed), submittedAt: latestAttempt.submitted_at } : null,
        passed: versionProgress.passedQuizIds.has(quiz.id),
      };
    }
    return { id: module.id, title: module.title, position: module.position, lessons, quiz: quizData };
  });
  return { ...resultSummary, modules };
}

export function canLearnerAccess(course, user) {
  return canViewCourse(course, user);
}

export function enrollLearner(courseId, userId) {
  const logicalId = db.prepare('SELECT logical_course_id FROM courses WHERE id = ?').get(courseId)?.logical_course_id || courseId;
  db.prepare('INSERT OR IGNORE INTO enrollments (id, course_id, user_id) VALUES (?, ?, ?)')
    .run(randomUUID(), logicalId, userId);
  ensureCourseLearningState(logicalId, userId);
}

export function ensureCourseLearningStateWithStatus(courseId, userId, now = new Date()) {
  const course = db.prepare(`SELECT c.id, c.logical_course_id, c.completion_window_days,
      s.user_id, s.course_id, s.target_version_id, s.deadline_at, s.deadline_window_days, s.started_at
    FROM courses c LEFT JOIN course_learning_state s
      ON s.course_id = COALESCE(c.logical_course_id, c.id) AND s.user_id = ?
    WHERE c.id = ?`).get(userId, courseId);
  if (!course) return { state: null, created: false };
  const logicalId = course.logical_course_id || course.id;
  if (course.user_id !== null) {
    const { user_id, course_id, target_version_id, deadline_at, deadline_window_days, started_at } = course;
    return { state: { user_id, course_id, target_version_id, deadline_at, deadline_window_days, started_at }, created: false };
  }
  const version = publishedVersion(logicalId);
  const deadlineDays = course.completion_window_days;
  const deadlineAt = Number.isInteger(deadlineDays) && deadlineDays > 0
    ? new Date(now.getTime() + deadlineDays * 24 * 60 * 60 * 1000).toISOString()
    : null;
  const insert = db.prepare(`INSERT OR IGNORE INTO course_learning_state
      (user_id, course_id, target_version_id, deadline_at, deadline_window_days, started_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(userId, logicalId, version?.requires_recompletion ? version.id : null, deadlineAt, deadlineDays ?? null, now.toISOString());
  const state = db.prepare('SELECT * FROM course_learning_state WHERE user_id = ? AND course_id = ?').get(userId, logicalId);
  return { state, created: insert.changes > 0 };
}

export function ensureCourseLearningState(courseId, userId, now = new Date()) {
  return ensureCourseLearningStateWithStatus(courseId, userId, now).state;
}

export function assertPublishable(courseId) {
  const modules = db.prepare(`
    WITH module_rows AS (
      SELECT id, title, position FROM course_modules WHERE course_id = ?
    ),
    lesson_stats AS (
      SELECT l.module_id, COUNT(*) AS lesson_count,
        SUM(CASE WHEN l.media_id IS NULL THEN 1 ELSE 0 END) AS missing_media_count
      FROM lessons l JOIN module_rows m ON m.id = l.module_id GROUP BY l.module_id
    ),
    quiz_rows AS (
      SELECT q.id, q.module_id FROM quizzes q JOIN module_rows m ON m.id = q.module_id
    ),
    question_stats AS (
      SELECT qq.id, qq.quiz_id, COUNT(qc.id) AS choice_count, COALESCE(SUM(qc.is_correct), 0) AS correct_count
      FROM quiz_questions qq JOIN quiz_rows q ON q.id = qq.quiz_id
      LEFT JOIN quiz_choices qc ON qc.question_id = qq.id GROUP BY qq.id
    ),
    quiz_stats AS (
      SELECT q.id, q.module_id, COUNT(question.id) AS question_count,
        SUM(CASE WHEN question.choice_count < 2 OR question.correct_count != 1 THEN 1 ELSE 0 END) AS invalid_question_count
      FROM quiz_rows q LEFT JOIN question_stats question ON question.quiz_id = q.id GROUP BY q.id
    )
    SELECT m.id, m.title, COALESCE(lesson.lesson_count, 0) AS lesson_count,
      COALESCE(lesson.missing_media_count, 0) AS missing_media_count,
      quiz.id AS quiz_id, COALESCE(quiz_stats.question_count, 0) AS question_count,
      COALESCE(quiz_stats.invalid_question_count, 0) AS invalid_question_count
    FROM module_rows m
    LEFT JOIN lesson_stats lesson ON lesson.module_id = m.id
    LEFT JOIN quiz_rows quiz ON quiz.module_id = m.id
    LEFT JOIN quiz_stats ON quiz_stats.id = quiz.id
    ORDER BY m.position
  `).all(courseId);
  if (!modules.length) fail(400, 'Add at least one module before publishing.', 'course_incomplete');
  for (const module of modules) {
    if (!module.lesson_count) fail(400, `Add a lesson to “${module.title}” before publishing.`, 'course_incomplete');
    if (module.missing_media_count) fail(400, `Upload a video for every lesson in “${module.title}” before publishing.`, 'course_incomplete');
    if (module.quiz_id && !module.question_count) fail(400, `Add at least one question to the quiz in “${module.title}” before publishing.`, 'course_incomplete');
    if (module.invalid_question_count) {
      fail(400, 'Each quiz question needs at least two choices and exactly one correct answer.', 'quiz_incomplete');
    }
  }
}

export function courseFromLesson(lessonId) {
  return db.prepare(`
    SELECT c.*, l.id AS lesson_id, l.module_id, l.title AS lesson_title, l.description AS lesson_description,
      l.transcript AS lesson_transcript, l.media_id
    FROM lessons l JOIN course_modules m ON m.id = l.module_id
    JOIN courses c ON c.id = m.course_id WHERE l.id = ?
  `).get(lessonId);
}

export function isLessonUnlocked(lessonId, user) {
  if (user?.role !== 'learner') return true;
  const selected = courseFromLesson(lessonId);
  if (!selected || selected.status !== 'published') return false;
  const logicalId = selected.logical_course_id || selected.id;
  const version = publishedVersion(logicalId);
  const contentId = version?.storage_course_id || logicalId;
  const orderedLessons = db.prepare(`SELECT l.id, COALESCE(l.stable_id, l.id) AS stable_id
    FROM lessons l JOIN course_modules m ON m.id = l.module_id
    WHERE m.course_id = ? ORDER BY m.position, m.id, l.position, l.id`).all(contentId);
  const selectedIndex = orderedLessons.findIndex((lesson) => lesson.id === lessonId);
  if (selectedIndex < 0) return false;
  const state = db.prepare('SELECT target_version_id FROM course_learning_state WHERE user_id = ? AND course_id = ?')
    .get(user.id, logicalId);
  const resetRequired = Boolean(version && state?.target_version_id === version.id);
  const history = db.prepare(`SELECT l.id, COALESCE(l.stable_id, l.id) AS stable_id
    FROM lesson_progress p JOIN lessons l ON l.id = p.lesson_id
    JOIN course_modules m ON m.id = l.module_id JOIN courses c ON c.id = m.course_id
    WHERE p.user_id = ? AND (c.id = ? OR c.logical_course_id = ?)`).all(user.id, logicalId, logicalId);
  const completedIds = new Set(history.map((lesson) => lesson.id));
  const completedStableIds = new Set(history.map((lesson) => lesson.stable_id));
  return orderedLessons.slice(0, selectedIndex).every((lesson) => resetRequired
    ? completedIds.has(lesson.id)
    : completedStableIds.has(lesson.stable_id));
}

export function moduleCourse(moduleId) {
  return db.prepare(`SELECT c.*, m.id AS module_id, m.title AS module_title FROM course_modules m JOIN courses c ON c.id = m.course_id WHERE m.id = ?`).get(moduleId);
}

export function quizCourse(quizId) {
  return db.prepare(`SELECT c.*, q.id AS quiz_id, q.module_id FROM quizzes q JOIN course_modules m ON m.id = q.module_id JOIN courses c ON c.id = m.course_id WHERE q.id = ?`).get(quizId);
}
