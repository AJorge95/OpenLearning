import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import express from 'express';
import { after, before, test } from 'node:test';

const isolatedConfig = {
  NODE_ENV: 'test', DATA_DIR: '', DB_PATH: '', MEDIA_ROOT: '',
  SESSION_SECRET: 'isolated-course-final-exam-tests', TRUST_PROXY: 'false', PORT: '3000',
  MAX_UPLOAD_BYTES: '2147483648', REQUEST_TIMEOUT_MS: '300000',
};
const previousConfig = new Map(Object.keys(isolatedConfig).map((key) => [key, process.env[key]]));
let fixtureDirectory;
let database;
let server;
let courseSummary;

function createFixtureDirectory() {
  const tempBase = path.resolve(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(tempBase, 'openlearning-course-final-exam-'));
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== tempBase || !path.basename(resolvedDirectory).startsWith('openlearning-course-final-exam-')) {
    throw new Error('Refusing to use an unexpected temporary directory.');
  }
  return resolvedDirectory;
}

function removeFixtureDirectory(directory) {
  if (!directory) return;
  const tempBase = path.resolve(os.tmpdir());
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== tempBase || !path.basename(resolvedDirectory).startsWith('openlearning-course-final-exam-')) {
    throw new Error('Refusing to remove an unexpected temporary directory.');
  }
  fs.rmSync(resolvedDirectory, { recursive: true, force: true });
}

function baseUrl() {
  const address = server.address();
  assert(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}/api`;
}

async function request(pathname, { user = 'exam-admin', method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl()}${pathname}`, {
    method,
    headers: {
      'x-test-user': user,
      connection: 'close',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = response.status === 204 ? null : await response.json();
  return { response, data };
}

function questionPayload(index, prompt = `Question ${index}?`) {
  return {
    prompt,
    explanation: `Explanation ${index}`,
    choices: [
      { text: `Correct ${index}`, isCorrect: true },
      { text: `Incorrect ${index}`, isCorrect: false },
    ],
  };
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
  const [{ courseRouter }, { errorHandler }, courseService] = await Promise.all([
    import('../../server/routes-courses.js'),
    import('../../server/http.js'),
    import('../../server/course-service.js'),
  ]);
  courseSummary = courseService.courseSummary;
  database.exec(`
    INSERT INTO users (id, username, password_hash, role, first_name, last_name) VALUES
      ('exam-admin', 'exam_admin', 'not-used', 'admin', 'Course', 'Author'),
      ('exam-learner', 'exam_learner', 'not-used', 'learner', 'Exam', 'Learner'),
      ('exam-outsider', 'exam_outsider', 'not-used', 'learner', 'Other', 'Learner');
    INSERT INTO courses (id, title, status, visibility, created_by, updated_by)
      VALUES ('exam-only-course', 'Certification practice', 'draft', 'public', 'exam-admin', 'exam-admin');
    INSERT INTO courses (id, title, status, visibility, created_by, updated_by)
      VALUES ('practice-course', 'Practice course', 'published', 'public', 'exam-admin', 'exam-admin');
    INSERT INTO course_modules (id, course_id, title, position) VALUES ('practice-module', 'practice-course', 'Practice module', 0);
    INSERT INTO lessons (id, module_id, title, position) VALUES ('practice-lesson', 'practice-module', 'Practice lesson', 0);
    INSERT INTO lesson_progress (user_id, lesson_id) VALUES ('exam-learner', 'practice-lesson');
    INSERT INTO quizzes (id, course_id, title, pass_mark, questions_per_attempt, required_for_completion)
      VALUES ('practice-final-exam', 'practice-course', 'Optional practice exam', 70, 0, 0);
    INSERT INTO quiz_questions (id, quiz_id, prompt, explanation, position)
      VALUES ('practice-question', 'practice-final-exam', 'Practice question?', 'Practice explanation', 0);
    INSERT INTO quiz_choices (id, question_id, choice_text, is_correct, position) VALUES
      ('practice-correct', 'practice-question', 'Correct', 1, 0),
      ('practice-wrong', 'practice-question', 'Incorrect', 0, 1);
  `);

  const app = express();
  app.use((req, _res, next) => {
    req.currentUser = database.prepare('SELECT id, username, role, disabled FROM users WHERE id = ?').get(req.get('x-test-user'));
    next();
  });
  app.use(express.json());
  app.use('/api', courseRouter);
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

test('authors can build a paginated bank above 50 questions and publish an exam-only course', async () => {
  const settings = await request('/manage/courses/exam-only-course/final-exam', {
    method: 'PUT',
    body: { title: 'Certification exam', passMark: 70, questionsPerAttempt: 0, requiredForCompletion: true },
  });
  assert.equal(settings.response.status, 200);
  assert.equal(settings.data.course.finalExam.questionsPerAttempt, 0);
  assert.equal(settings.data.course.finalExam.requiredForCompletion, true);

  const invalidCount = await request('/manage/courses/exam-only-course/final-exam', {
    method: 'PUT', body: { questionsPerAttempt: -1 },
  });
  assert.equal(invalidCount.response.status, 400);
  assert.equal(invalidCount.data.code, 'validation_error');

  const forbidden = await request('/manage/courses/exam-only-course/final-exam/questions', { user: 'exam-learner' });
  assert.equal(forbidden.response.status, 403);

  for (let index = 1; index <= 62; index += 1) {
    const payload = questionPayload(index, index === 62 ? 'Question 62 uses 100% completion?' : undefined);
    if (index === 62) payload.choices[1].text = 'Incorrect_choice_62';
    const created = await request('/manage/courses/exam-only-course/final-exam/questions', {
      method: 'POST', body: payload,
    });
    assert.equal(created.response.status, 201, `question ${index} should be saved independently`);
  }
  const pageOne = await request('/manage/courses/exam-only-course/final-exam/questions?page=1');
  const pageFour = await request('/manage/courses/exam-only-course/final-exam/questions?page=4');
  assert.equal(pageOne.data.total, 62);
  assert.equal(pageOne.data.questions.length, 20);
  assert.equal(pageFour.data.questions.length, 2);
  assert.equal(pageOne.data.questions[0].choices.filter((choice) => choice.isCorrect).length, 1);

  const promptMatch = await request('/manage/courses/exam-only-course/final-exam/questions?q=qUeStIoN%2062');
  assert.equal(promptMatch.data.total, 1);
  assert.equal(promptMatch.data.questions[0].position, 61);
  const choiceMatch = await request('/manage/courses/exam-only-course/final-exam/questions?q=Incorrect_choice_62');
  assert.equal(choiceMatch.data.total, 1);
  assert.equal(choiceMatch.data.questions[0].prompt, 'Question 62 uses 100% completion?');
  const literalPercentMatch = await request('/manage/courses/exam-only-course/final-exam/questions?q=100%25');
  assert.equal(literalPercentMatch.data.total, 1);
  const literalUnderscoreMatch = await request('/manage/courses/exam-only-course/final-exam/questions?q=Incorrect%5Fchoice');
  assert.equal(literalUnderscoreMatch.data.total, 1);
  const emptyMatch = await request('/manage/courses/exam-only-course/final-exam/questions?q=not-found');
  assert.equal(emptyMatch.data.total, 0);
  assert.equal(emptyMatch.data.questions.length, 0);

  const firstQuestion = pageOne.data.questions[0];
  const updated = await request(`/manage/courses/exam-only-course/final-exam/questions/${firstQuestion.id}`, {
    method: 'PUT', body: questionPayload(1, 'Updated question 1?'),
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.data.question.prompt, 'Updated question 1?');
  const lastQuestion = pageFour.data.questions.at(-1);
  const removed = await request(`/manage/courses/exam-only-course/final-exam/questions/${lastQuestion.id}`, { method: 'DELETE' });
  assert.equal(removed.response.status, 204);

  const tooManyPerAttempt = await request('/manage/courses/exam-only-course/final-exam', {
    method: 'PUT', body: { questionsPerAttempt: 62 },
  });
  assert.equal(tooManyPerAttempt.response.status, 200);
  const rejectedPublish = await request('/manage/courses/exam-only-course', { method: 'PATCH', body: { status: 'published' } });
  assert.equal(rejectedPublish.response.status, 400);
  assert.equal(rejectedPublish.data.code, 'quiz_incomplete');

  const readySettings = await request('/manage/courses/exam-only-course/final-exam', {
    method: 'PUT', body: { questionsPerAttempt: 60 },
  });
  assert.equal(readySettings.response.status, 200);
  const published = await request('/manage/courses/exam-only-course', { method: 'PATCH', body: { status: 'published' } });
  assert.equal(published.response.status, 200);
  assert.equal(published.data.course.finalExam.questionCount, 61);
  assert.equal(published.data.course.modules.length, 0);

  const revised = await request('/manage/courses/exam-only-course', {
    method: 'PATCH', body: { status: 'published', title: 'Certification exam revised' },
  });
  assert.equal(revised.response.status, 200);
  assert.equal(revised.data.course.finalExam.questionCount, 61);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM course_versions WHERE course_id = ?').get('exam-only-course').count, 2);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM quiz_questions WHERE quiz_id = ?').get(revised.data.course.finalExam.id).count, 61);
});

test('final exam attempts randomize once, hide the key, score snapshots, resume after reload, and certify only required completion', async () => {
  const catalog = await request('/courses/exam-only-course', { user: 'exam-learner' });
  assert.equal(catalog.response.status, 200);
  const examId = catalog.data.course.finalExam.id;
  assert.equal(catalog.data.course.finalExam.questions.length, 0);

  const started = await request(`/quizzes/${examId}/attempts/start`, { user: 'exam-learner', method: 'POST', body: {} });
  assert.equal(started.response.status, 201);
  assert.equal(started.data.questions.length, 60);
  assert.equal(new Set(started.data.questions.map((question) => question.id)).size, 60);
  for (const question of started.data.questions) {
    assert.equal('explanation' in question, false);
    assert.equal('correctChoiceId' in question, false);
    assert.ok(question.choices.every((choice) => !('isCorrect' in choice)));
  }

  const resume = await request(`/quizzes/${examId}/attempts/start`, {
    user: 'exam-learner', method: 'POST', body: { resumeOnly: true },
  });
  assert.equal(resume.data.attemptSessionId, started.data.attemptSessionId);
  assert.deepEqual(resume.data.questions.map((question) => question.id), started.data.questions.map((question) => question.id));
  const secondStart = await request(`/quizzes/${examId}/attempts/start`, { user: 'exam-learner', method: 'POST', body: {} });
  assert.equal(secondStart.data.attemptSessionId, started.data.attemptSessionId);

  const failAnswers = Object.fromEntries(started.data.questions.map((question, index) => {
    const correct = database.prepare('SELECT id FROM quiz_choices WHERE question_id = ? AND is_correct = 1').get(question.id).id;
    const incorrect = database.prepare('SELECT id FROM quiz_choices WHERE question_id = ? AND is_correct = 0').get(question.id).id;
    return [question.id, index < 40 ? correct : incorrect];
  }));
  const failedAttempt = await request(`/quizzes/${examId}/attempts`, {
    user: 'exam-learner', method: 'POST', body: { attemptSessionId: started.data.attemptSessionId, answers: failAnswers },
  });
  assert.equal(failedAttempt.response.status, 201);
  assert.deepEqual({ score: failedAttempt.data.attempt.score, correctCount: failedAttempt.data.attempt.correctCount,
    questionCount: failedAttempt.data.attempt.questionCount, passed: failedAttempt.data.attempt.passed },
  { score: 67, correctCount: 40, questionCount: 60, passed: false });
  assert.equal(failedAttempt.data.certificate, null);

  const nextAttempt = await request(`/quizzes/${examId}/attempts/start`, { user: 'exam-learner', method: 'POST', body: {} });
  assert.notEqual(nextAttempt.data.attemptSessionId, started.data.attemptSessionId);
  const passAnswers = Object.fromEntries(nextAttempt.data.questions.map((question) => [
    question.id,
    database.prepare('SELECT id FROM quiz_choices WHERE question_id = ? AND is_correct = 1').get(question.id).id,
  ]));
  const passedAttempt = await request(`/quizzes/${examId}/attempts`, {
    user: 'exam-learner', method: 'POST', body: { attemptSessionId: nextAttempt.data.attemptSessionId, answers: passAnswers },
  });
  assert.equal(passedAttempt.data.attempt.passed, true);
  assert.equal(passedAttempt.data.attempt.score, 100);
  assert.ok(passedAttempt.data.certificate);

  const afterPass = await request('/courses/exam-only-course', { user: 'exam-learner' });
  assert.equal(afterPass.data.course.progress, 100);
  assert.equal(afterPass.data.course.completed, true);
  const analytics = await request('/manage/courses/exam-only-course/analytics');
  assert.equal(analytics.response.status, 200);
  assert.equal(analytics.data.summary.quizCount, 1);
  assert.equal(analytics.data.summary.quizAttempts, 2);
  assert.equal(analytics.data.summary.completedLearnerCount, 1);
  assert.equal(analytics.data.quizMetrics[0].moduleTitle, 'Final exam');
  assert.equal(analytics.data.quizMetrics[0].learnersPassed, 1);
  assert.equal(analytics.data.quizMetrics[0].requiredForCompletion, true);
  const learnerDetails = await request('/manage/courses/exam-only-course/analytics/learners/exam-learner');
  assert.equal(learnerDetails.data.quizProgress[0].attempts, 2);
  assert.equal(learnerDetails.data.quizProgress[0].passed, true);
});

test('a practice final exam is excluded from course completion and does not issue a certificate', async () => {
  const practiceCourse = database.prepare('SELECT * FROM courses WHERE id = ?').get('practice-course');
  const learner = database.prepare('SELECT id, username, role, disabled FROM users WHERE id = ?').get('exam-learner');
  const before = courseSummary(practiceCourse, learner);
  assert.equal(before.progress, 100);
  assert.equal(before.completed, true);

  const started = await request('/quizzes/practice-final-exam/attempts/start', { user: 'exam-learner', method: 'POST', body: {} });
  assert.equal(started.response.status, 201);
  const practiceAnswers = Object.fromEntries(started.data.questions.map((question) => [question.id, 'practice-correct']));
  const submitted = await request('/quizzes/practice-final-exam/attempts', {
    user: 'exam-learner', method: 'POST', body: { attemptSessionId: started.data.attemptSessionId, answers: practiceAnswers },
  });
  assert.equal(submitted.data.attempt.passed, true, JSON.stringify(submitted.data));
  assert.equal(submitted.data.certificate, null);
  const after = courseSummary(practiceCourse, learner);
  assert.equal(after.progress, before.progress);
  assert.equal(after.completed, before.completed);
  assert.equal(database.prepare('SELECT 1 FROM course_certificates WHERE user_id = ? AND course_id = ?').get('exam-learner', 'practice-course'), undefined);
  const analytics = await request('/manage/courses/practice-course/analytics');
  assert.equal(analytics.data.quizMetrics[0].learnersPassed, 1);
  assert.equal(analytics.data.quizMetrics[0].requiredForCompletion, false);
});
