import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { fail, canViewCourse } from './http.js';

export function courseSummaries(courses, user) {
  if (!courses.length) return [];
  const ids = courses.map((course) => course.id);
  const placeholders = ids.map(() => '?').join(', ');
  const countsByCourse = new Map(db.prepare(`
    SELECT c.id,
      (SELECT COUNT(*) FROM course_modules m WHERE m.course_id = c.id) AS module_count,
      (SELECT COUNT(*) FROM lessons l JOIN course_modules m ON m.id = l.module_id WHERE m.course_id = c.id) AS lesson_count,
      (SELECT username FROM users WHERE id = c.created_by) AS owner
    FROM courses c WHERE c.id IN (${placeholders})
  `).all(...ids).map((row) => [row.id, row]));
  const completedLessonsByCourse = new Map();
  const quizCountsByCourse = new Map();
  if (user) {
    for (const row of db.prepare(`
      SELECT m.course_id, COUNT(*) AS count FROM lesson_progress p
      JOIN lessons l ON l.id = p.lesson_id
      JOIN course_modules m ON m.id = l.module_id
      WHERE p.user_id = ? AND m.course_id IN (${placeholders}) GROUP BY m.course_id
    `).all(user.id, ...ids)) {
      completedLessonsByCourse.set(row.course_id, row.count);
    }
    for (const row of db.prepare(`
      SELECT m.course_id, COUNT(*) AS total,
        SUM(CASE WHEN EXISTS (
          SELECT 1 FROM quiz_attempts a WHERE a.quiz_id = q.id AND a.user_id = ? AND a.passed = 1
        ) THEN 1 ELSE 0 END) AS passed
      FROM quizzes q JOIN course_modules m ON m.id = q.module_id
      WHERE m.course_id IN (${placeholders}) GROUP BY m.course_id
    `).all(user.id, ...ids)) {
      quizCountsByCourse.set(row.course_id, row);
    }
  }
  return courses.map((course) => {
    const counts = countsByCourse.get(course.id);
    const completedLessons = completedLessonsByCourse.get(course.id) ?? 0;
    const quizCounts = quizCountsByCourse.get(course.id) ?? { total: 0, passed: 0 };
    const quizCount = quizCounts.total;
    const passedQuizzes = quizCounts.passed || 0;
    const requiredItems = counts.lesson_count + quizCount;
    const completedItems = completedLessons + passedQuizzes;
    const progress = requiredItems > 0 ? Math.round((completedItems / requiredItems) * 100) : 0;
    const completed = requiredItems > 0 && completedItems === requiredItems;
    return {
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
    };
  });
}

export function courseSummary(course, user) {
  return courseSummaries([course], user)[0];
}

export function getCoursePayload(course, user, { includeAnswers = false } = {}) {
  const summary = courseSummary(course, user);
  const lessonResources = new Map();
  for (const resource of db.prepare(`
    SELECT lr.id, lr.lesson_id, lr.resource_type, lr.title, lr.href, lr.original_name
    FROM lesson_resources lr
    JOIN lessons l ON l.id = lr.lesson_id
    JOIN course_modules m ON m.id = l.module_id
    WHERE m.course_id = ?
    ORDER BY lr.lesson_id, lr.position, lr.id
  `).all(course.id)) {
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
  const completedLessonIds = user
    ? new Set(db.prepare(`
        SELECT lp.lesson_id
        FROM lesson_progress lp
        JOIN lessons l ON l.id = lp.lesson_id
        JOIN course_modules m ON m.id = l.module_id
        WHERE lp.user_id = ? AND m.course_id = ?
      `).all(user.id, course.id).map((row) => row.lesson_id))
    : new Set();
  const quizChoicesByQuestion = new Map();
  for (const choice of db.prepare(`
    SELECT qc.id, qc.question_id, qc.choice_text, qc.is_correct
    FROM quiz_choices qc
    JOIN quiz_questions qq ON qq.id = qc.question_id
    JOIN quizzes q ON q.id = qq.quiz_id
    JOIN course_modules m ON m.id = q.module_id
    WHERE m.course_id = ?
    ORDER BY qq.position, qq.id, qc.position, qc.id
  `).all(course.id)) {
    const choices = quizChoicesByQuestion.get(choice.question_id) ?? [];
    choices.push(choice);
    quizChoicesByQuestion.set(choice.question_id, choices);
  }
  const modules = db.prepare('SELECT * FROM course_modules WHERE course_id = ? ORDER BY position, id').all(course.id).map((module) => {
    const lessons = db.prepare(`
      SELECT l.*, mf.original_name, mf.mime_type
      FROM lessons l LEFT JOIN media_files mf ON mf.id = l.media_id
      WHERE l.module_id = ? ORDER BY l.position, l.id
    `).all(module.id).map((lesson) => ({
      id: lesson.id,
      title: lesson.title,
      description: lesson.description,
      position: lesson.position,
      mediaId: lesson.media_id,
      mediaUrl: lesson.media_id ? `/media/${lesson.media_id}` : null,
      videoName: lesson.original_name,
      hasVideo: Boolean(lesson.media_id),
      resources: lessonResources.get(lesson.id) ?? [],
      completed: completedLessonIds.has(lesson.id),
    }));
    const quiz = db.prepare('SELECT * FROM quizzes WHERE module_id = ?').get(module.id);
    let quizData = null;
    if (quiz) {
      const questions = db.prepare('SELECT * FROM quiz_questions WHERE quiz_id = ? ORDER BY position, id').all(quiz.id).map((question) => ({
        id: question.id,
        prompt: question.prompt,
        explanation: question.explanation,
        choices: (quizChoicesByQuestion.get(question.id) ?? []).map((choice) => ({
          id: choice.id,
          text: choice.choice_text,
          ...(includeAnswers ? { isCorrect: Boolean(choice.is_correct) } : {}),
        })),
      }));
      const latestAttempt = user
        ? db.prepare('SELECT id, score, passed, submitted_at FROM quiz_attempts WHERE quiz_id = ? AND user_id = ? ORDER BY submitted_at DESC, rowid DESC LIMIT 1').get(quiz.id, user.id)
        : null;
      const anyPassed = user
        ? db.prepare('SELECT 1 FROM quiz_attempts WHERE quiz_id = ? AND user_id = ? AND passed = 1 LIMIT 1').get(quiz.id, user.id) !== undefined
        : false;
      quizData = {
        id: quiz.id,
        title: quiz.title,
        passMark: quiz.pass_mark,
        questions,
        latestAttempt: latestAttempt ? { id: latestAttempt.id, score: latestAttempt.score, passed: Boolean(latestAttempt.passed), submittedAt: latestAttempt.submitted_at } : null,
        passed: anyPassed,
      };
    }
    return { id: module.id, title: module.title, position: module.position, lessons, quiz: quizData };
  });
  return { ...summary, modules };
}

export function canLearnerAccess(course, user) {
  return canViewCourse(course, user);
}

export function enrollLearner(courseId, userId) {
  db.prepare('INSERT OR IGNORE INTO enrollments (id, course_id, user_id) VALUES (?, ?, ?)')
    .run(randomUUID(), courseId, userId);
}

export function assertPublishable(courseId) {
  const modules = db.prepare('SELECT * FROM course_modules WHERE course_id = ? ORDER BY position').all(courseId);
  if (!modules.length) fail(400, 'Add at least one module before publishing.', 'course_incomplete');
  for (const module of modules) {
    const lessons = db.prepare('SELECT id, media_id FROM lessons WHERE module_id = ? ORDER BY position').all(module.id);
    if (!lessons.length) fail(400, `Add a lesson to “${module.title}” before publishing.`, 'course_incomplete');
    if (lessons.some((lesson) => !lesson.media_id)) fail(400, `Upload a video for every lesson in “${module.title}” before publishing.`, 'course_incomplete');
    const quiz = db.prepare('SELECT id FROM quizzes WHERE module_id = ?').get(module.id);
    if (quiz) {
      const questions = db.prepare('SELECT id FROM quiz_questions WHERE quiz_id = ?').all(quiz.id);
      if (!questions.length) fail(400, `Add at least one question to the quiz in “${module.title}” before publishing.`, 'course_incomplete');
      for (const question of questions) {
        const choices = db.prepare('SELECT is_correct FROM quiz_choices WHERE question_id = ?').all(question.id);
        if (choices.length < 2 || choices.filter((choice) => choice.is_correct).length !== 1) {
          fail(400, 'Each quiz question needs at least two choices and exactly one correct answer.', 'quiz_incomplete');
        }
      }
    }
  }
}

export function courseFromLesson(lessonId) {
  return db.prepare(`
    SELECT c.*, l.id AS lesson_id, l.module_id, l.title AS lesson_title, l.description AS lesson_description, l.media_id
    FROM lessons l JOIN course_modules m ON m.id = l.module_id
    JOIN courses c ON c.id = m.course_id WHERE l.id = ?
  `).get(lessonId);
}

export function moduleCourse(moduleId) {
  return db.prepare(`SELECT c.*, m.id AS module_id FROM course_modules m JOIN courses c ON c.id = m.course_id WHERE m.id = ?`).get(moduleId);
}

export function quizCourse(quizId) {
  return db.prepare(`SELECT c.*, q.id AS quiz_id, q.module_id FROM quizzes q JOIN course_modules m ON m.id = q.module_id JOIN courses c ON c.id = m.course_id WHERE q.id = ?`).get(quizId);
}
