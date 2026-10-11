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
  SESSION_SECRET: 'isolated-lesson-completion-tests', TRUST_PROXY: 'false', PORT: '3000',
  MAX_UPLOAD_BYTES: '2147483648', REQUEST_TIMEOUT_MS: '300000',
};
const previousConfig = new Map(Object.keys(isolatedConfig).map((key) => [key, process.env[key]]));
let fixtureDirectory;
let database;
let server;

function createFixtureDirectory() {
  const tempBase = path.resolve(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(tempBase, 'openlearning-lesson-completion-'));
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== tempBase || !path.basename(resolved).startsWith('openlearning-lesson-completion-')) {
    throw new Error('Refusing to use an unexpected temporary directory.');
  }
  return resolved;
}

function removeFixtureDirectory(directory) {
  if (!directory) return;
  const tempBase = path.resolve(os.tmpdir());
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== tempBase || !path.basename(resolved).startsWith('openlearning-lesson-completion-')) {
    throw new Error('Refusing to remove an unexpected temporary directory.');
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

function apiUrl(pathname) {
  const address = server.address();
  assert(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}/api${pathname}`;
}

function learnerHeaders() {
  return { 'x-test-user': 'lesson-completion-learner', connection: 'close' };
}

before(async () => {
  fixtureDirectory = createFixtureDirectory();
  Object.assign(process.env, {
    ...isolatedConfig,
    DATA_DIR: fixtureDirectory,
    DB_PATH: path.join(fixtureDirectory, 'openlearning.sqlite'),
    MEDIA_ROOT: path.join(fixtureDirectory, 'course-media'),
  });

  const [{ db: testDatabase }, { courseRouter }, { errorHandler }] = await Promise.all([
    import('../../server/db.js'),
    import('../../server/routes-courses.js'),
    import('../../server/http.js'),
  ]);
  database = testDatabase;
  database.exec(`
    INSERT INTO users (id, username, password_hash, role) VALUES
      ('lesson-completion-admin', 'lesson_completion_admin', 'not-used', 'admin'),
      ('lesson-completion-learner', 'lesson_completion_learner', 'not-used', 'learner');
    INSERT INTO courses (id, title, status, visibility, created_by, updated_by) VALUES
      ('lesson-completion-prerequisite', 'Prerequisite course', 'published', 'private', 'lesson-completion-admin', 'lesson-completion-admin'),
      ('lesson-completion-target', 'Next course', 'published', 'private', 'lesson-completion-admin', 'lesson-completion-admin');
    INSERT INTO course_modules (id, course_id, title, position) VALUES
      ('lesson-completion-prerequisite-module', 'lesson-completion-prerequisite', 'Module', 0),
      ('lesson-completion-target-module', 'lesson-completion-target', 'Module', 0);
    INSERT INTO lessons (id, module_id, title, position) VALUES
      ('lesson-completion-prerequisite-lesson', 'lesson-completion-prerequisite-module', 'Required lesson', 0),
      ('lesson-completion-target-lesson', 'lesson-completion-target-module', 'Target lesson', 0);
    INSERT INTO learning_paths (id, title, status, created_by, updated_by)
      VALUES ('lesson-completion-path', 'Sequential learning path', 'published', 'lesson-completion-admin', 'lesson-completion-admin');
    INSERT INTO learning_path_courses (id, path_id, course_id, position, requires_previous) VALUES
      ('lesson-completion-path-step-one', 'lesson-completion-path', 'lesson-completion-prerequisite', 0, 0),
      ('lesson-completion-path-step-two', 'lesson-completion-path', 'lesson-completion-target', 1, 1);
    INSERT INTO learning_path_enrollments (id, path_id, user_id, enrollment_source, assigned_by)
      VALUES ('lesson-completion-path-enrollment', 'lesson-completion-path', 'lesson-completion-learner', 'assigned', 'lesson-completion-admin');
    INSERT INTO lesson_progress (user_id, lesson_id)
      VALUES ('lesson-completion-learner', 'lesson-completion-prerequisite-lesson');
  `);

  const app = express();
  app.use((req, _res, next) => {
    req.currentUser = database.prepare(`SELECT id, username, email, first_name, last_name, role, disabled
      FROM users WHERE id = ?`).get(req.get('x-test-user'));
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

test('undoing a completed prerequisite re-locks later private path courses', async () => {
  const targetBeforeUndo = await fetch(apiUrl('/courses/lesson-completion-target'), { headers: learnerHeaders() });
  assert.equal(targetBeforeUndo.status, 200);
  assert.equal((await targetBeforeUndo.json()).course.id, 'lesson-completion-target');

  const undoResponse = await fetch(apiUrl('/lessons/lesson-completion-prerequisite-lesson/completion'), {
    method: 'DELETE', headers: learnerHeaders(),
  });
  assert.equal(undoResponse.status, 200);
  assert.deepEqual(await undoResponse.json(), { completed: false });
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM lesson_progress WHERE user_id = ? AND lesson_id = ?')
    .get('lesson-completion-learner', 'lesson-completion-prerequisite-lesson').count, 0);

  const prerequisiteAfterUndo = await fetch(apiUrl('/courses/lesson-completion-prerequisite'), { headers: learnerHeaders() });
  assert.equal(prerequisiteAfterUndo.status, 200);

  const targetAfterUndo = await fetch(apiUrl('/courses/lesson-completion-target'), { headers: learnerHeaders() });
  assert.equal(targetAfterUndo.status, 403);
  assert.equal((await targetAfterUndo.json()).code, 'course_access_denied');
});
