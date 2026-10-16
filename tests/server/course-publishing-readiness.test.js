import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const isolatedConfig = {
  NODE_ENV: 'test',
  DATA_DIR: '',
  DB_PATH: '',
  MEDIA_ROOT: '',
  SESSION_SECRET: 'isolated-course-publishing-readiness-tests',
  TRUST_PROXY: 'false',
  PORT: '3000',
  MAX_UPLOAD_BYTES: '2147483648',
  REQUEST_TIMEOUT_MS: '300000',
};
const previousConfig = new Map(Object.keys(isolatedConfig).map((key) => [key, process.env[key]]));
let fixtureDirectory;
let database;
let assertPublishable;
let ApiError;

function createFixtureDirectory() {
  const temporaryRoot = path.resolve(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(temporaryRoot, 'openlearning-course-publishing-readiness-'));
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== temporaryRoot
    || !path.basename(resolvedDirectory).startsWith('openlearning-course-publishing-readiness-')) {
    throw new Error('Refusing to use an unexpected temporary directory.');
  }
  return resolvedDirectory;
}

function removeFixtureDirectory(directory) {
  if (!directory) return;
  const temporaryRoot = path.resolve(os.tmpdir());
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== temporaryRoot
    || !path.basename(resolvedDirectory).startsWith('openlearning-course-publishing-readiness-')) {
    throw new Error('Refusing to remove an unexpected temporary directory.');
  }
  fs.rmSync(resolvedDirectory, { recursive: true, force: true });
}

function addCourse(courseId, moduleId) {
  database.prepare(`INSERT INTO courses (id, title, created_by, updated_by)
    VALUES (?, ?, 'publishing-admin', 'publishing-admin')`).run(courseId, courseId);
  if (moduleId) {
    database.prepare('INSERT INTO course_modules (id, course_id, title, position) VALUES (?, ?, ?, 0)')
      .run(moduleId, courseId, `${courseId} module`);
  }
}

function addLessonWithVideo(courseId, moduleId, { mediaId = `${courseId}-video`, lessonId = `${courseId}-lesson`, attachMedia = true } = {}) {
  database.prepare(`INSERT INTO media_files (id, course_id, original_name, file_name, mime_type, byte_size, media_kind)
    VALUES (?, ?, ?, ?, 'video/mp4', 1, 'video')`).run(mediaId, courseId, `${mediaId}.mp4`, `${mediaId}.mp4`);
  database.prepare('INSERT INTO lessons (id, module_id, title, position, media_id) VALUES (?, ?, ?, 0, ?)')
    .run(lessonId, moduleId, lessonId, attachMedia ? mediaId : null);
}

function addQuiz(moduleId, quizId, { choices = [], correctChoices = 1 } = {}) {
  database.prepare('INSERT INTO quizzes (id, module_id, title) VALUES (?, ?, ?)').run(quizId, moduleId, quizId);
  if (!choices.length) return;
  const questionId = `${quizId}-question`;
  database.prepare('INSERT INTO quiz_questions (id, quiz_id, prompt, position) VALUES (?, ?, ?, 0)')
    .run(questionId, quizId, 'Choose the correct answer.');
  const insertChoice = database.prepare(`INSERT INTO quiz_choices
    (id, question_id, choice_text, is_correct, position) VALUES (?, ?, ?, ?, ?)`);
  choices.forEach((choice, index) => {
    insertChoice.run(`${questionId}-choice-${index}`, questionId, choice, index < correctChoices ? 1 : 0, index);
  });
}

function addFinalExam(courseId, { requiredForCompletion = true, questionsPerAttempt = 0, questionCount = 1 } = {}) {
  const quizId = `${courseId}-final-exam`;
  database.prepare(`INSERT INTO quizzes
    (id, course_id, title, questions_per_attempt, required_for_completion) VALUES (?, ?, 'Final exam', ?, ?)`)
    .run(quizId, courseId, questionsPerAttempt, requiredForCompletion ? 1 : 0);
  const insertQuestion = database.prepare('INSERT INTO quiz_questions (id, quiz_id, prompt, position) VALUES (?, ?, ?, ?)');
  const insertChoice = database.prepare(`INSERT INTO quiz_choices
    (id, question_id, choice_text, is_correct, position) VALUES (?, ?, ?, ?, ?)`);
  for (let index = 0; index < questionCount; index += 1) {
    const questionId = `${quizId}-question-${index}`;
    insertQuestion.run(questionId, quizId, `Question ${index + 1}`, index);
    insertChoice.run(`${questionId}-choice-1`, questionId, 'Correct', 1, 0);
    insertChoice.run(`${questionId}-choice-2`, questionId, 'Incorrect', 0, 1);
  }
}

function expectPublishError(courseId, code, message) {
  assert.throws(() => assertPublishable(courseId), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 400);
    assert.equal(error.code, code);
    assert.equal(error.message, message);
    return true;
  });
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
  ({ assertPublishable } = await import('../../server/course-service.js'));
  ({ ApiError } = await import('../../server/http.js'));

  database.prepare("INSERT INTO users (id, username, password_hash, role) VALUES ('publishing-admin', 'publishing_admin', 'not-used', 'admin')").run();
  addCourse('publish-no-module');
  addCourse('publish-no-lesson', 'publish-no-lesson-module');
  addCourse('publish-missing-video', 'publish-missing-video-module');
  // An uploaded but unattached video must not satisfy the lesson-media prerequisite.
  addLessonWithVideo('publish-missing-video', 'publish-missing-video-module', { attachMedia: false });
  addCourse('publish-empty-quiz', 'publish-empty-quiz-module');
  addLessonWithVideo('publish-empty-quiz', 'publish-empty-quiz-module');
  addQuiz('publish-empty-quiz-module', 'publish-empty-quiz');
  addCourse('publish-invalid-question', 'publish-invalid-question-module');
  addLessonWithVideo('publish-invalid-question', 'publish-invalid-question-module');
  addQuiz('publish-invalid-question-module', 'publish-invalid-question', { choices: ['Only choice'] });
  addCourse('publish-multiple-correct', 'publish-multiple-correct-module');
  addLessonWithVideo('publish-multiple-correct', 'publish-multiple-correct-module');
  addQuiz('publish-multiple-correct-module', 'publish-multiple-correct', { choices: ['First', 'Second'], correctChoices: 2 });
  addCourse('publish-valid', 'publish-valid-module');
  addLessonWithVideo('publish-valid', 'publish-valid-module');
  addQuiz('publish-valid-module', 'publish-valid-quiz', { choices: ['Correct', 'Incorrect'] });
  addCourse('publish-exam-only');
  addFinalExam('publish-exam-only', { questionsPerAttempt: 1 });
  addCourse('publish-practice-only');
  addFinalExam('publish-practice-only', { requiredForCompletion: false });
  addCourse('publish-too-small-bank');
  addFinalExam('publish-too-small-bank', { questionsPerAttempt: 2, questionCount: 1 });
});

after(() => {
  if (database?.open) database.close();
  removeFixtureDirectory(fixtureDirectory);
  for (const [key, value] of previousConfig) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('publishing requires learning content and at least one lesson in each module', () => {
  expectPublishError('publish-no-module', 'course_incomplete', 'Add at least one module or a final exam before publishing.');
  expectPublishError('publish-no-lesson', 'course_incomplete', 'Add a lesson to “publish-no-lesson module” before publishing.');
});

test('publishing requires video media for every lesson', () => {
  expectPublishError('publish-missing-video', 'course_incomplete', 'Upload a video for every lesson in “publish-missing-video module” before publishing.');
});

test('publishing requires quiz questions with at least two choices and exactly one correct answer', () => {
  expectPublishError('publish-empty-quiz', 'course_incomplete', 'Add at least one question to the quiz in “publish-empty-quiz module” before publishing.');
  expectPublishError('publish-invalid-question', 'quiz_incomplete', 'Each quiz question needs at least two choices and exactly one correct answer.');
  expectPublishError('publish-multiple-correct', 'quiz_incomplete', 'Each quiz question needs at least two choices and exactly one correct answer.');
});

test('publishing accepts a course with complete lesson and quiz content', () => {
  assert.doesNotThrow(() => assertPublishable('publish-valid'));
});

test('publishing accepts a required exam-only course and rejects practice-only or undersized exams', () => {
  assert.doesNotThrow(() => assertPublishable('publish-exam-only'));
  expectPublishError('publish-practice-only', 'course_incomplete', 'A course with only a final exam must require a passing score to complete the course.');
  expectPublishError('publish-too-small-bank', 'quiz_incomplete', 'Add enough final exam questions to match the selected number of questions per attempt.');
});
