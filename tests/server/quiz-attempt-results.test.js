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

  const app = express();
  app.use((req, _res, next) => {
    req.currentUser = database.prepare('SELECT id, username, role, disabled FROM users WHERE id = ?')
      .get(req.get('x-test-user'));
    next();
  });
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
  assert.equal(attempt.id, 'attempt-1');
  assert.equal(attempt.passed, false);
  assert.equal(attempt.questions[0].selectedChoiceId, 'choice-2');
  assert.equal(attempt.questions[0].correctChoiceId, 'choice-1');

  const otherUserResponse = await fetch(`${baseUrl}/quizzes/quiz-1/attempts/attempt-1`, {
    headers: { 'x-test-user': 'learner-2', connection: 'close' },
  });
  assert.equal(otherUserResponse.status, 404);
  assert.deepEqual(await otherUserResponse.json(), { error: 'Quiz result not found.', code: 'not_found' });
});
