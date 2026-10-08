import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { config } from './config.js';
import { fail, requireAuth, requireStaff, requireCourseManager, requireCourseViewer } from './http.js';
import { assertPublishable, canLearnerAccess, courseFromLesson, courseSummary, enrollLearner, getCoursePayload, moduleCourse, quizCourse } from './course-service.js';

export const courseRouter = Router();
courseRouter.use(requireAuth);

function textField(value, label, max, { required = false } = {}) {
  const result = String(value ?? '').trim();
  if (required && !result) fail(400, `${label} is required.`, 'validation_error');
  if (result.length > max) fail(400, `${label} must be ${max} characters or fewer.`, 'validation_error');
  return result;
}

function intField(value, label, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) fail(400, `${label} must be between ${min} and ${max}.`, 'validation_error');
  return number;
}

function courseFileDirectory(courseId) {
  const root = path.resolve(config.mediaRoot);
  const candidate = path.resolve(root, courseId);
  if (!candidate.startsWith(`${root}${path.sep}`)) fail(400, 'Invalid course identifier.', 'invalid_path');
  return candidate;
}

function accessiblePublishedCourses(user, filters = {}) {
  const clauses = ["c.status = 'published'"];
  const params = [];
  if (filters.query) {
    clauses.push('(c.title LIKE ? OR c.description LIKE ? OR c.category LIKE ?)');
    const query = `%${filters.query}%`;
    params.push(query, query, query);
  }
  if (filters.category && filters.category !== 'All courses') {
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
  return db.prepare(`SELECT c.* FROM courses c WHERE ${clauses.join(' AND ')} ORDER BY ${orderBy} LIMIT 100`).all(...params);
}

courseRouter.get('/courses', (req, res) => {
  const query = textField(req.query.q, 'Search', 120);
  const category = textField(req.query.category, 'Category', 100);
  const sort = req.query.sort === 'title' ? 'title' : 'recent';
  const courses = accessiblePublishedCourses(req.currentUser, { query, category, sort });
  const categories = db.prepare(`
    SELECT DISTINCT c.category FROM courses c WHERE c.status = 'published' AND (
      c.visibility = 'public' OR ? IN ('admin', 'moderator') OR
      EXISTS (SELECT 1 FROM course_grants g WHERE g.course_id = c.id AND g.user_id = ?)
    ) ORDER BY c.category COLLATE NOCASE
  `).all(req.currentUser.role, req.currentUser.id).map((row) => row.category);
  res.json({ courses: courses.map((course) => courseSummary(course, req.currentUser)), categories });
});

courseRouter.get('/my-learning', (req, res) => {
  const rows = db.prepare(`
    SELECT c.* FROM enrollments e JOIN courses c ON c.id = e.course_id
    WHERE e.user_id = ? AND c.status = 'published'
      AND (c.visibility = 'public' OR ? IN ('admin', 'moderator') OR
        EXISTS (SELECT 1 FROM course_grants g WHERE g.course_id = c.id AND g.user_id = ?))
    ORDER BY e.enrolled_at DESC
  `).all(req.currentUser.id, req.currentUser.role, req.currentUser.id);
  res.json({ courses: rows.map((course) => courseSummary(course, req.currentUser)) });
});

courseRouter.get('/manage/courses', requireStaff, (req, res) => {
  const query = textField(req.query.q, 'Search', 120);
  const status = ['draft', 'published', 'archived'].includes(req.query.status) ? req.query.status : 'all';
  const clauses = [];
  const params = [];
  if (status !== 'all') { clauses.push('c.status = ?'); params.push(status); }
  if (query) {
    clauses.push('(c.title LIKE ? OR c.description LIKE ? OR c.category LIKE ?)');
    const escaped = `%${query}%`;
    params.push(escaped, escaped, escaped);
  }
  const rows = db.prepare(`
    SELECT c.*, u.username AS owner FROM courses c JOIN users u ON u.id = c.created_by
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY c.updated_at DESC LIMIT 200
  `).all(...params);
  res.json({ courses: rows.map((course) => ({ ...courseSummary(course, req.currentUser), owner: course.owner })) });
});

courseRouter.get('/courses/:courseId', (req, res) => {
  const course = requireCourseViewer(req.params.courseId, req.currentUser);
  if (course.status === 'published') enrollLearner(course.id, req.currentUser.id);
  res.json({ course: getCoursePayload(course, req.currentUser) });
});

courseRouter.get('/manage/courses/:courseId', requireStaff, (req, res) => {
  const course = requireCourseManager(req.params.courseId, req.currentUser);
  res.json({ course: getCoursePayload(course, req.currentUser, { includeAnswers: true }) });
});

courseRouter.post('/courses/:courseId/enroll', (req, res) => {
  const course = requireCourseViewer(req.params.courseId, req.currentUser);
  if (!canLearnerAccess(course, req.currentUser) || course.status !== 'published') fail(403, 'You do not have access to this course.', 'course_access_denied');
  enrollLearner(course.id, req.currentUser.id);
  res.status(201).json({ ok: true });
});

courseRouter.post('/manage/courses', requireStaff, (req, res) => {
  const title = textField(req.body?.title || 'Untitled course', 'Course title', 160, { required: true });
  const description = textField(req.body?.description, 'Description', 6000);
  const category = textField(req.body?.category || 'General', 'Category', 100, { required: true });
  const visibility = req.body?.visibility === 'private' ? 'private' : 'public';
  const id = randomUUID();
  db.prepare(`INSERT INTO courses (id, title, description, category, visibility, status, created_by, updated_by)
    VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`)
    .run(id, title, description, category, visibility, req.currentUser.id, req.currentUser.id);
  res.status(201).json({ course: getCoursePayload(db.prepare('SELECT * FROM courses WHERE id = ?').get(id), req.currentUser, { includeAnswers: true }) });
});

courseRouter.patch('/manage/courses/:courseId', requireStaff, (req, res) => {
  const current = requireCourseManager(req.params.courseId, req.currentUser);
  const title = req.body?.title === undefined ? current.title : textField(req.body.title, 'Course title', 160, { required: true });
  const description = req.body?.description === undefined ? current.description : textField(req.body.description, 'Description', 6000);
  const category = req.body?.category === undefined ? current.category : textField(req.body.category, 'Category', 100, { required: true });
  const visibility = req.body?.visibility === undefined ? current.visibility : req.body.visibility;
  const status = req.body?.status === undefined ? current.status : req.body.status;
  if (!['public', 'private'].includes(visibility)) fail(400, 'Visibility must be public or private.', 'validation_error');
  if (!['draft', 'published', 'archived'].includes(status)) fail(400, 'Choose a valid course status.', 'validation_error');
  if (status === 'published') assertPublishable(current.id);
  db.prepare(`UPDATE courses SET title = ?, description = ?, category = ?, visibility = ?, status = ?,
      updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(title, description, category, visibility, status, req.currentUser.id, current.id);
  const updated = db.prepare('SELECT * FROM courses WHERE id = ?').get(current.id);
  res.json({ course: getCoursePayload(updated, req.currentUser, { includeAnswers: true }) });
});

courseRouter.delete('/manage/courses/:courseId', requireStaff, (req, res) => {
  const course = requireCourseManager(req.params.courseId, req.currentUser);
  if (course.status !== 'archived') fail(409, 'Archive this course before permanently deleting it.', 'archive_required');
  const directory = courseFileDirectory(course.id);
  db.prepare('DELETE FROM courses WHERE id = ?').run(course.id);
  fs.rmSync(directory, { recursive: true, force: true });
  res.status(204).end();
});

courseRouter.post('/manage/courses/:courseId/modules', requireStaff, (req, res) => {
  const course = requireCourseManager(req.params.courseId, req.currentUser);
  const title = textField(req.body?.title, 'Module title', 160, { required: true });
  const position = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM course_modules WHERE course_id = ?').get(course.id).next;
  const id = randomUUID();
  db.prepare('INSERT INTO course_modules (id, course_id, title, position) VALUES (?, ?, ?, ?)').run(id, course.id, title, position);
  db.prepare('UPDATE courses SET updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.currentUser.id, course.id);
  res.status(201).json({ module: { id, courseId: course.id, title, position } });
});

courseRouter.patch('/manage/modules/:moduleId', requireStaff, (req, res) => {
  const module = moduleCourse(req.params.moduleId);
  if (!module) fail(404, 'Module not found.', 'not_found');
  requireCourseManager(module.id, req.currentUser);
  const title = textField(req.body?.title, 'Module title', 160, { required: true });
  db.prepare('UPDATE course_modules SET title = ? WHERE id = ?').run(title, module.module_id);
  db.prepare('UPDATE courses SET updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.currentUser.id, module.id);
  res.json({ ok: true });
});

courseRouter.delete('/manage/modules/:moduleId', requireStaff, (req, res) => {
  const module = moduleCourse(req.params.moduleId);
  if (!module) fail(404, 'Module not found.', 'not_found');
  requireCourseManager(module.id, req.currentUser);
  const media = db.prepare(`SELECT mf.id, mf.file_name FROM media_files mf WHERE mf.course_id = ? AND mf.id IN (
    SELECT l.media_id FROM lessons l WHERE l.module_id = ? AND l.media_id IS NOT NULL
  )`).all(module.id, module.module_id);
  db.prepare('DELETE FROM course_modules WHERE id = ?').run(module.module_id);
  for (const item of media) {
    db.prepare('DELETE FROM media_files WHERE id = ?').run(item.id);
    fs.rmSync(path.join(courseFileDirectory(module.id), item.file_name), { force: true });
  }
  db.prepare('UPDATE courses SET updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.currentUser.id, module.id);
  res.status(204).end();
});

courseRouter.post('/manage/modules/:moduleId/lessons', requireStaff, (req, res) => {
  const module = moduleCourse(req.params.moduleId);
  if (!module) fail(404, 'Module not found.', 'not_found');
  requireCourseManager(module.id, req.currentUser);
  const title = textField(req.body?.title, 'Lesson title', 160, { required: true });
  const position = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM lessons WHERE module_id = ?').get(module.module_id).next;
  const id = randomUUID();
  db.prepare('INSERT INTO lessons (id, module_id, title, position) VALUES (?, ?, ?, ?)').run(id, module.module_id, title, position);
  db.prepare('UPDATE courses SET updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.currentUser.id, module.id);
  res.status(201).json({ lesson: { id, moduleId: module.module_id, title, position, hasVideo: false } });
});

courseRouter.patch('/manage/lessons/:lessonId', requireStaff, (req, res) => {
  const lesson = courseFromLesson(req.params.lessonId);
  if (!lesson) fail(404, 'Lesson not found.', 'not_found');
  requireCourseManager(lesson.id, req.currentUser);
  const title = req.body?.title === undefined ? lesson.lesson_title : textField(req.body.title, 'Lesson title', 160, { required: true });
  const description = req.body?.description === undefined ? lesson.lesson_description : textField(req.body.description, 'Lesson description', 2000);
  db.prepare('UPDATE lessons SET title = ?, description = ? WHERE id = ?').run(title, description, lesson.lesson_id);
  db.prepare('UPDATE courses SET updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.currentUser.id, lesson.id);
  res.json({ ok: true });
});

courseRouter.delete('/manage/lessons/:lessonId', requireStaff, (req, res) => {
  const lesson = courseFromLesson(req.params.lessonId);
  if (!lesson) fail(404, 'Lesson not found.', 'not_found');
  requireCourseManager(lesson.id, req.currentUser);
  const media = lesson.media_id ? db.prepare('SELECT file_name FROM media_files WHERE id = ?').get(lesson.media_id) : null;
  db.prepare('DELETE FROM lessons WHERE id = ?').run(lesson.lesson_id);
  if (media) {
    db.prepare('DELETE FROM media_files WHERE id = ?').run(lesson.media_id);
    fs.rmSync(path.join(courseFileDirectory(lesson.id), media.file_name), { force: true });
  }
  db.prepare('UPDATE courses SET updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.currentUser.id, lesson.id);
  res.status(204).end();
});

courseRouter.post('/manage/modules/:moduleId/move', requireStaff, (req, res) => {
  const module = moduleCourse(req.params.moduleId);
  if (!module) fail(404, 'Module not found.', 'not_found');
  requireCourseManager(module.id, req.currentUser);
  const direction = req.body?.direction;
  if (!['up', 'down'].includes(direction)) fail(400, 'Choose up or down.', 'validation_error');
  const modules = db.prepare('SELECT id, position FROM course_modules WHERE course_id = ? ORDER BY position, id').all(module.id);
  const index = modules.findIndex((item) => item.id === module.module_id);
  const other = modules[index + (direction === 'up' ? -1 : 1)];
  if (other) {
    const move = db.transaction(() => {
      db.prepare('UPDATE course_modules SET position = -1 WHERE id IN (?, ?)').run(module.module_id, other.id);
      db.prepare('UPDATE course_modules SET position = ? WHERE id = ?').run(other.position, module.module_id);
      db.prepare('UPDATE course_modules SET position = ? WHERE id = ?').run(modules[index].position, other.id);
    });
    move();
  }
  res.json({ ok: true });
});

courseRouter.post('/manage/lessons/:lessonId/move', requireStaff, (req, res) => {
  const lesson = courseFromLesson(req.params.lessonId);
  if (!lesson) fail(404, 'Lesson not found.', 'not_found');
  requireCourseManager(lesson.id, req.currentUser);
  const direction = req.body?.direction;
  if (!['up', 'down'].includes(direction)) fail(400, 'Choose up or down.', 'validation_error');
  const lessons = db.prepare('SELECT id, position FROM lessons WHERE module_id = ? ORDER BY position, id').all(lesson.module_id);
  const index = lessons.findIndex((item) => item.id === lesson.lesson_id);
  const other = lessons[index + (direction === 'up' ? -1 : 1)];
  if (other) {
    const move = db.transaction(() => {
      db.prepare('UPDATE lessons SET position = -1 WHERE id IN (?, ?)').run(lesson.lesson_id, other.id);
      db.prepare('UPDATE lessons SET position = ? WHERE id = ?').run(other.position, lesson.lesson_id);
      db.prepare('UPDATE lessons SET position = ? WHERE id = ?').run(lessons[index].position, other.id);
    });
    move();
  }
  res.json({ ok: true });
});

courseRouter.put('/manage/modules/:moduleId/quiz', requireStaff, (req, res) => {
  const module = moduleCourse(req.params.moduleId);
  if (!module) fail(404, 'Module not found.', 'not_found');
  requireCourseManager(module.id, req.currentUser);
  const title = textField(req.body?.title || 'Module quiz', 'Quiz title', 160, { required: true });
  const passMark = intField(req.body?.passMark ?? 70, 'Pass mark', 1, 100);
  const questions = Array.isArray(req.body?.questions) ? req.body.questions : [];
  if (questions.length > 50) fail(400, 'A quiz can contain up to 50 questions.', 'validation_error');
  const quizId = db.prepare('SELECT id FROM quizzes WHERE module_id = ?').get(module.module_id)?.id || randomUUID();
  const saveQuiz = db.transaction(() => {
    db.prepare(`INSERT INTO quizzes (id, module_id, title, pass_mark) VALUES (?, ?, ?, ?)
      ON CONFLICT(module_id) DO UPDATE SET title = excluded.title, pass_mark = excluded.pass_mark, updated_at = CURRENT_TIMESTAMP`)
      .run(quizId, module.module_id, title, passMark);
    const actualQuizId = db.prepare('SELECT id FROM quizzes WHERE module_id = ?').get(module.module_id).id;
    db.prepare('DELETE FROM quiz_questions WHERE quiz_id = ?').run(actualQuizId);
    questions.forEach((question, qIndex) => {
      const prompt = textField(question.prompt, 'Question', 1000, { required: true });
      const explanation = textField(question.explanation, 'Explanation', 1000);
      const choices = Array.isArray(question.choices) ? question.choices : [];
      if (choices.length > 6) fail(400, 'A question can have up to six answer choices.', 'validation_error');
      const questionId = randomUUID();
      db.prepare('INSERT INTO quiz_questions (id, quiz_id, prompt, explanation, position) VALUES (?, ?, ?, ?, ?)')
        .run(questionId, actualQuizId, prompt, explanation, qIndex);
      choices.forEach((choice, cIndex) => {
        const choiceText = textField(choice.text, 'Answer choice', 500, { required: true });
        db.prepare('INSERT INTO quiz_choices (id, question_id, choice_text, is_correct, position) VALUES (?, ?, ?, ?, ?)')
          .run(randomUUID(), questionId, choiceText, choice.isCorrect ? 1 : 0, cIndex);
      });
    });
    db.prepare('UPDATE courses SET updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.currentUser.id, module.id);
  });
  saveQuiz();
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(module.id);
  res.json({ course: getCoursePayload(course, req.currentUser, { includeAnswers: true }) });
});

courseRouter.delete('/manage/modules/:moduleId/quiz', requireStaff, (req, res) => {
  const module = moduleCourse(req.params.moduleId);
  if (!module) fail(404, 'Module not found.', 'not_found');
  requireCourseManager(module.id, req.currentUser);
  db.prepare('DELETE FROM quizzes WHERE module_id = ?').run(module.module_id);
  db.prepare('UPDATE courses SET updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.currentUser.id, module.id);
  res.status(204).end();
});

courseRouter.get('/manage/courses/:courseId/access', requireStaff, (req, res) => {
  const course = requireCourseManager(req.params.courseId, req.currentUser);
  if (course.visibility !== 'private') fail(409, 'Only private courses use access grants.', 'public_course');
  const query = textField(req.query.q, 'Search', 100);
  const users = db.prepare(`
    SELECT u.id, u.username, u.role, u.disabled, g.id AS grant_id, g.granted_at, gu.username AS granted_by
    FROM users u LEFT JOIN course_grants g ON g.user_id = u.id AND g.course_id = ?
    LEFT JOIN users gu ON gu.id = g.granted_by
    WHERE u.role = 'learner' AND (? = '' OR u.username LIKE ?)
    ORDER BY CASE WHEN g.id IS NULL THEN 1 ELSE 0 END, u.username COLLATE NOCASE LIMIT 200
  `).all(course.id, query, `%${query}%`);
  res.json({ users: users.map((user) => ({ id: user.id, username: user.username, disabled: Boolean(user.disabled), granted: Boolean(user.grant_id), grantedAt: user.granted_at, grantedBy: user.granted_by })) });
});

courseRouter.put('/manage/courses/:courseId/access/:userId', requireStaff, (req, res) => {
  const course = requireCourseManager(req.params.courseId, req.currentUser);
  if (course.visibility !== 'private') fail(409, 'Only private courses use access grants.', 'public_course');
  const learner = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'learner' AND disabled = 0").get(req.params.userId);
  if (!learner) fail(404, 'Active learner not found.', 'learner_not_found');
  db.prepare('INSERT OR IGNORE INTO course_grants (id, course_id, user_id, granted_by) VALUES (?, ?, ?, ?)')
    .run(randomUUID(), course.id, learner.id, req.currentUser.id);
  res.status(204).end();
});

courseRouter.delete('/manage/courses/:courseId/access/:userId', requireStaff, (req, res) => {
  const course = requireCourseManager(req.params.courseId, req.currentUser);
  if (course.visibility !== 'private') fail(409, 'Only private courses use access grants.', 'public_course');
  db.prepare('DELETE FROM course_grants WHERE course_id = ? AND user_id = ?').run(course.id, req.params.userId);
  res.status(204).end();
});

courseRouter.put('/lessons/:lessonId/completion', (req, res) => {
  const lesson = courseFromLesson(req.params.lessonId);
  if (!lesson) fail(404, 'Lesson not found.', 'not_found');
  requireCourseViewer(lesson.id, req.currentUser);
  if (lesson.status !== 'published' || !lesson.media_id) fail(404, 'Lesson video is not available.', 'not_found');
  enrollLearner(lesson.id, req.currentUser.id);
  db.prepare('INSERT OR IGNORE INTO lesson_progress (user_id, lesson_id) VALUES (?, ?)').run(req.currentUser.id, lesson.lesson_id);
  res.json({ completed: true });
});

courseRouter.delete('/lessons/:lessonId/completion', (req, res) => {
  const lesson = courseFromLesson(req.params.lessonId);
  if (!lesson) fail(404, 'Lesson not found.', 'not_found');
  requireCourseViewer(lesson.id, req.currentUser);
  db.prepare('DELETE FROM lesson_progress WHERE user_id = ? AND lesson_id = ?').run(req.currentUser.id, lesson.lesson_id);
  res.json({ completed: false });
});

courseRouter.post('/quizzes/:quizId/attempts', (req, res) => {
  const quiz = quizCourse(req.params.quizId);
  if (!quiz) fail(404, 'Quiz not found.', 'not_found');
  requireCourseViewer(quiz.id, req.currentUser);
  if (quiz.status !== 'published') fail(404, 'Quiz is not available.', 'not_found');
  enrollLearner(quiz.id, req.currentUser.id);
  const questions = db.prepare('SELECT * FROM quiz_questions WHERE quiz_id = ? ORDER BY position, id').all(quiz.quiz_id);
  if (!questions.length) fail(400, 'This quiz has no questions yet.', 'quiz_empty');
  const answers = req.body?.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) fail(400, 'Choose an answer for every question.', 'answers_required');
  const answerIds = Object.keys(answers);
  if (answerIds.length !== questions.length) fail(400, 'Choose an answer for every question.', 'answers_required');
  let correct = 0;
  const snapshot = [];
  for (const question of questions) {
    const choices = db.prepare('SELECT id, choice_text, is_correct FROM quiz_choices WHERE question_id = ? ORDER BY position').all(question.id);
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
  if (answerIds.some((id) => !questions.some((question) => question.id === id))) fail(400, 'One of the selected answers is invalid.', 'invalid_answer');
  const score = Math.round((correct / questions.length) * 100);
  const passMark = db.prepare('SELECT pass_mark FROM quizzes WHERE id = ?').get(quiz.quiz_id).pass_mark;
  const passed = score >= passMark;
  const attemptId = randomUUID();
  db.prepare(`INSERT INTO quiz_attempts (id, quiz_id, user_id, score, passed, answers_json, question_snapshot_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(attemptId, quiz.quiz_id, req.currentUser.id, score, passed ? 1 : 0, JSON.stringify(answers), JSON.stringify(snapshot));
  res.status(201).json({ attempt: { id: attemptId, score, passed, passMark, questions: snapshot } });
});

courseRouter.get('/quizzes/:quizId/attempts/:attemptId', (req, res) => {
  const attempt = db.prepare('SELECT * FROM quiz_attempts WHERE id = ? AND quiz_id = ? AND user_id = ?')
    .get(req.params.attemptId, req.params.quizId, req.currentUser.id);
  if (!attempt) fail(404, 'Quiz result not found.', 'not_found');
  res.json({ attempt: {
    id: attempt.id,
    score: attempt.score,
    passed: Boolean(attempt.passed),
    submittedAt: attempt.submitted_at,
    questions: JSON.parse(attempt.question_snapshot_json),
  } });
});

