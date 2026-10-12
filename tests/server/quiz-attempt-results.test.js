import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import express from 'express';
import { after, before, test } from 'node:test';

const isolatedConfig = {
  NODE_ENV: 'test',
  DATA_DIR: '',
  DB_PATH: '',
  MEDIA_ROOT: '',
  SESSION_SECRET: 'isolated-quiz-attempt-result-tests',
  TRUST_PROXY: 'false',
  PORT: '3000',
  MAX_UPLOAD_BYTES: '2147483648',
  REQUEST_TIMEOUT_MS: '300000',
};
const previousConfig = new Map(Object.keys(isolatedConfig).map((key) => [key, process.env[key]]));
let fixtureDirectory;
let database;
let server;

function createFixtureDirectory() {
  const tempBase = path.resolve(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(tempBase, 'openlearning-quiz-results-'));
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== tempBase
    || !path.basename(resolvedDirectory).startsWith('openlearning-quiz-results-')) {
    throw new Error('Refusing to use an unexpected temporary directory.');
  }
  return resolvedDirectory;
}

function removeFixtureDirectory(directory) {
  if (!directory) return;
  const tempBase = path.resolve(os.tmpdir());
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== tempBase
    || !path.basename(resolvedDirectory).startsWith('openlearning-quiz-results-')) {
    throw new Error('Refusing to remove an unexpected temporary directory.');
  }
  fs.rmSync(resolvedDirectory, { recursive: true, force: true });
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
  const [{ courseRouter }, { errorHandler }] = await Promise.all([
    import('../../server/routes-courses.js'),
    import('../../server/http.js'),
  ]);
  database.exec(`
    INSERT INTO users (id, username, password_hash, role) VALUES
      ('admin-1', 'admin', 'not-used', 'admin'),
      ('learner-1', 'learner', 'not-used', 'learner'),
      ('learner-2', 'other-learner', 'not-used', 'learner');
    INSERT INTO courses (id, title, status, created_by, updated_by)
      VALUES ('course-1', 'Course one', 'published', 'admin-1', 'admin-1');
    INSERT INTO course_modules (id, course_id, title, position)
      VALUES ('module-1', 'course-1', 'Module one', 0);
    INSERT INTO quizzes (id, module_id, title, pass_mark)
      VALUES ('quiz-1', 'module-1', 'Quiz one', 70);
    INSERT INTO quiz_questions (id, quiz_id, prompt, position)
      VALUES ('question-1', 'quiz-1', 'Question one?', 0);
    INSERT INTO quiz_choices (id, question_id, choice_text, is_correct, position) VALUES
      ('choice-1', 'question-1', 'Correct answer', 1, 0),
      ('choice-2', 'question-1', 'Another answer', 0, 1);
    INSERT INTO courses (id, title, status, created_by, updated_by)
      VALUES ('course-2', 'Course two', 'published', 'admin-1', 'admin-1');
    INSERT INTO course_modules (id, course_id, title, position) VALUES
      ('module-2', 'course-2', 'Module two', 0),
      ('module-3', 'course-2', 'Module three', 1);
    INSERT INTO quizzes (id, module_id, title, pass_mark) VALUES
      ('quiz-2', 'module-2', 'Quiz two', 70),
      ('quiz-3', 'module-3', 'Quiz three', 70);
    INSERT INTO quiz_questions (id, quiz_id, prompt, position) VALUES
      ('question-2', 'quiz-2', 'Question two?', 0),
      ('question-3', 'quiz-3', 'Question three?', 0);
    INSERT INTO quiz_choices (id, question_id, choice_text, is_correct, position) VALUES
      ('choice-3', 'question-2', 'Answer for quiz two', 1, 0),
      ('choice-4', 'question-3', 'Answer for quiz three', 1, 0);
  `);
  const questions = [{
    id: 'question-1',
    prompt: 'Question one?',
    explanation: 'Review the key idea.',
    correctChoiceId: 'choice-1',
    choices: [
      { id: 'choice-1', text: 'Correct answer' },
      { id: 'choice-2', text: 'Another answer' },
    ],
    selectedChoiceId: 'choice-2',
  }];
  database.prepare(`INSERT INTO quiz_attempts
    (id, quiz_id, user_id, score, passed, answers_json, question_snapshot_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run('attempt-1', 'quiz-1', 'learner-1', 0, 0, JSON.stringify({ 'question-1': 'choice-2' }), JSON.stringify(questions));
  database.prepare(`INSERT INTO quiz_attempts
    (id, quiz_id, user_id, score, passed, answers_json, question_snapshot_json) VALUES
      ('attempt-2', 'quiz-2', 'learner-1', 100, 1, '{}', '[]'),
      ('attempt-3', 'quiz-3', 'learner-1', 0, 0, '{}', '[]')`).run();

  const app = express();
  app.use((req, _res, next) => {
    req.currentUser = database.prepare('SELECT id, username, role, disabled FROM users WHERE id = ?')
      .get(req.get('x-test-user'));
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

test('course payload points to the learner latest attempt and its detail remains user-scoped', async () => {
  const address = server.address();
  assert(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}/api`;
  const headers = { 'x-test-user': 'learner-1', connection: 'close' };

  const courseResponse = await fetch(`${baseUrl}/courses/course-1`, { headers });
  assert.equal(courseResponse.status, 200);
  const { course } = await courseResponse.json();
  assert.deepEqual(course.modules[0].quiz.latestAttempt, {
    id: 'attempt-1',
    score: 0,
    passed: false,
    submittedAt: course.modules[0].quiz.latestAttempt.submittedAt,
  });

  const resultResponse = await fetch(`${baseUrl}/quizzes/quiz-1/attempts/attempt-1`, { headers });
  assert.equal(resultResponse.status, 200);
  const { attempt } = await resultResponse.json();
  assert.deepEqual(attempt, {
    id: 'attempt-1',
    score: 0,
    correctCount: 0,
    questionCount: 1,
    passed: false,
    submittedAt: course.modules[0].quiz.latestAttempt.submittedAt,
  });

  const otherUserResponse = await fetch(`${baseUrl}/quizzes/quiz-1/attempts/attempt-1`, {
    headers: { 'x-test-user': 'learner-2', connection: 'close' },
  });
  assert.equal(otherUserResponse.status, 404);
  assert.deepEqual(await otherUserResponse.json(), { error: 'Quiz result not found.', code: 'not_found' });
});

test('course payload can omit quiz questions without losing quiz status', async () => {
  const address = server.address();
  assert(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}/api`;
  const headers = { 'x-test-user': 'learner-1', connection: 'close' };

  const fullResponse = await fetch(`${baseUrl}/courses/course-1`, { headers });
  assert.equal(fullResponse.status, 200);
  const fullText = await fullResponse.text();
  const fullCourse = JSON.parse(fullText).course;
  assert.equal(fullCourse.modules[0].quiz.questions[0].prompt, 'Question one?');
  assert.deepEqual(fullCourse.modules[0].quiz.questions[0].choices.map((choice) => choice.text), ['Correct answer', 'Another answer']);

  const compactResponse = await fetch(`${baseUrl}/courses/course-1?includeQuizQuestions=0`, { headers });
  assert.equal(compactResponse.status, 200);
  const compactText = await compactResponse.text();
  const compactCourse = JSON.parse(compactText).course;
  assert.deepEqual(compactCourse.modules[0].quiz.questions, []);
  assert.deepEqual(compactCourse.modules[0].quiz.latestAttempt, fullCourse.modules[0].quiz.latestAttempt);
  assert.equal(compactCourse.modules[0].quiz.passed, fullCourse.modules[0].quiz.passed);
  assert.ok(compactText.length < fullText.length);

  const invalidResponse = await fetch(`${baseUrl}/courses/course-1?includeQuizQuestions=no`, { headers });
  assert.equal(invalidResponse.status, 400);
  assert.deepEqual(await invalidResponse.json(), {
    error: 'Choose a valid quiz question option.', code: 'validation_error',
  });
});

test('course payload can omit latest attempts without querying or losing quiz pass state', async () => {
  const address = server.address();
  assert(address && typeof address !== 'string');
  const originalPrepare = database.prepare;
  let latestAttemptQueryCount = 0;
  database.prepare = (sql) => {
    if (sql.includes('SELECT q.id AS quiz_id, a.id, a.score, a.passed, a.submitted_at')) latestAttemptQueryCount += 1;
    return originalPrepare.call(database, sql);
  };

  let response;
  let payload;
  try {
    response = await fetch(`http://127.0.0.1:${address.port}/api/courses/course-1?includeLatestAttempts=0`, {
      headers: { 'x-test-user': 'learner-1', connection: 'close' },
    });
    payload = await response.json();
  } finally {
    database.prepare = originalPrepare;
  }

  assert.equal(response.status, 200);
  assert.equal(latestAttemptQueryCount, 0);
  assert.equal(payload.course.modules[0].quiz.latestAttempt, null);
  assert.equal(payload.course.modules[0].quiz.passed, false);

  const invalidResponse = await fetch(`http://127.0.0.1:${address.port}/api/courses/course-1?includeLatestAttempts=yes`, {
    headers: { 'x-test-user': 'learner-1', connection: 'close' },
  });
  assert.equal(invalidResponse.status, 400);
  assert.deepEqual(await invalidResponse.json(), {
    error: 'Choose a valid quiz attempt option.', code: 'validation_error',
  });
});

test('quiz-specific course payload keeps progress but omits other quiz questions and attempts', async () => {
  const address = server.address();
  assert(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}/api`;
  const headers = { 'x-test-user': 'learner-1', connection: 'close' };

  const fullResponse = await fetch(`${baseUrl}/courses/course-2`, { headers });
  assert.equal(fullResponse.status, 200);
  const fullText = await fullResponse.text();
  const fullCourse = JSON.parse(fullText).course;
  assert.deepEqual(fullCourse.modules.map((module) => module.quiz.questions[0].prompt), ['Question two?', 'Question three?']);

  const quizResponse = await fetch(`${baseUrl}/courses/course-2?quizId=quiz-2`, { headers });
  assert.equal(quizResponse.status, 200);
  const quizText = await quizResponse.text();
  const quizCourse = JSON.parse(quizText).course;
  assert.equal(quizCourse.modules[0].quiz.questions[0].prompt, 'Question two?');
  assert.deepEqual(quizCourse.modules[1].quiz.questions, []);
  assert.deepEqual(quizCourse.modules[0].quiz.latestAttempt, fullCourse.modules[0].quiz.latestAttempt);
  assert.equal(quizCourse.modules[1].quiz.latestAttempt, null);
  assert.deepEqual(quizCourse.modules.map((module) => module.quiz.passed), fullCourse.modules.map((module) => module.quiz.passed));
  assert.equal(quizCourse.progress, fullCourse.progress);
  assert.ok(quizText.length < fullText.length);

  const unavailableQuiz = await fetch(`${baseUrl}/courses/course-2?quizId=missing-quiz`, { headers });
  assert.equal(unavailableQuiz.status, 404);
  assert.deepEqual(await unavailableQuiz.json(), { error: 'Quiz not found.', code: 'not_found' });

  const invalidQuiz = await fetch(`${baseUrl}/courses/course-2?quizId=`, { headers });
  assert.equal(invalidQuiz.status, 400);
  assert.deepEqual(await invalidQuiz.json(), { error: 'Choose a valid quiz.', code: 'validation_error' });
});

test('quiz submission returns aggregate results only and requires an answer for every question', async () => {
  const address = server.address();
  assert(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}/api`;
  const headers = { 'x-test-user': 'learner-2', connection: 'close', 'content-type': 'application/json' };

  const incompleteResponse = await fetch(`${baseUrl}/quizzes/quiz-1/attempts`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ answers: {} }),
  });
  assert.equal(incompleteResponse.status, 400);
  assert.deepEqual(await incompleteResponse.json(), {
    error: 'Choose an answer for every question.',
    code: 'answers_required',
  });

  const unknownQuestionResponse = await fetch(`${baseUrl}/quizzes/quiz-1/attempts`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ answers: { 'question-1': 'choice-2', 'unknown-question': 'choice-1' } }),
  });
  assert.equal(unknownQuestionResponse.status, 400);
  assert.deepEqual(await unknownQuestionResponse.json(), {
    error: 'One of the selected answers is invalid.',
    code: 'invalid_answer',
  });
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM quiz_attempts WHERE user_id = ?').get('learner-2').count, 0);

  const submitResponse = await fetch(`${baseUrl}/quizzes/quiz-1/attempts`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ answers: { 'question-1': 'choice-2' } }),
  });
  assert.equal(submitResponse.status, 201);
  const { attempt: submittedAttempt } = await submitResponse.json();
  assert.equal(submittedAttempt.score, 0);
  assert.equal(submittedAttempt.correctCount, 0);
  assert.equal(submittedAttempt.questionCount, 1);
  assert.equal(submittedAttempt.passed, false);
  assert.equal(typeof submittedAttempt.id, 'string');
  assert.equal(typeof submittedAttempt.submittedAt, 'string');
  assert.equal(Object.hasOwn(submittedAttempt, 'questions'), false);

  const resultResponse = await fetch(`${baseUrl}/quizzes/quiz-1/attempts/${submittedAttempt.id}`, { headers });
  assert.equal(resultResponse.status, 200);
  const { attempt: reloadedAttempt } = await resultResponse.json();
  assert.deepEqual(reloadedAttempt, submittedAttempt);
  assert.equal(JSON.stringify(reloadedAttempt).includes('correctChoiceId'), false);
  assert.equal(JSON.stringify(reloadedAttempt).includes('selectedChoiceId'), false);

  const passedResponse = await fetch(`${baseUrl}/quizzes/quiz-1/attempts`, {
    method: 'POST',
    headers: { ...headers, 'x-test-user': 'learner-1' },
    body: JSON.stringify({ answers: { 'question-1': 'choice-1' } }),
  });
  assert.equal(passedResponse.status, 201);
  const { attempt: passedAttempt } = await passedResponse.json();
  assert.equal(passedAttempt.score, 100);
  assert.equal(passedAttempt.correctCount, 1);
  assert.equal(passedAttempt.questionCount, 1);
  assert.equal(passedAttempt.passed, true);
  assert.equal(Object.hasOwn(passedAttempt, 'questions'), false);
});
