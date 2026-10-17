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
  SESSION_SECRET: 'isolated-course-group-tests',
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
  const temporaryRoot = path.resolve(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(temporaryRoot, 'openlearning-course-groups-'));
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== temporaryRoot
    || !path.basename(resolvedDirectory).startsWith('openlearning-course-groups-')) {
    throw new Error('Refusing to use an unexpected temporary directory.');
  }
  return resolvedDirectory;
}

function removeFixtureDirectory(directory) {
  if (!directory) return;
  const temporaryRoot = path.resolve(os.tmpdir());
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== temporaryRoot
    || !path.basename(resolvedDirectory).startsWith('openlearning-course-groups-')) {
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

  database.exec([
    "INSERT INTO users (id, username, password_hash, role, disabled) VALUES",
    "  ('group-admin', 'group_admin', 'not-used', 'admin', 0),",
    "  ('group-moderator', 'group_moderator', 'not-used', 'moderator', 0),",
    "  ('group-learner', 'group_learner', 'not-used', 'learner', 0);",
    "INSERT INTO courses (id, title, category, status, created_by, updated_by) VALUES",
    "  ('group-course-a', 'Course A', 'General', 'published', 'group-admin', 'group-admin'),",
    "  ('group-course-b', 'Course B', 'Safety', 'draft', 'group-admin', 'group-admin');",
  ].join('\n'));

  const app = express();
  app.use(express.json());
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

function apiUrl(pathname) {
  const address = server.address();
  assert(address && typeof address !== 'string');
  return 'http://127.0.0.1:' + address.port + '/api' + pathname;
}

async function request(method, pathname, userId, body) {
  const headers = { 'x-test-user': userId, connection: 'close' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  return fetch(apiUrl(pathname), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('course-group management is staff-only and preserves CRUD invariants', async () => {
  const anonymous = await request('GET', '/manage/course-groups');
  assert.equal(anonymous.status, 401);

  const learner = await request('GET', '/manage/course-groups', 'group-learner');
  assert.equal(learner.status, 403);

  const createResponse = await request('POST', '/manage/course-groups', 'group-admin', {
    name: 'Onboarding',
    description: 'Required training',
  });
  assert.equal(createResponse.status, 201);
  const { group } = await createResponse.json();
  assert.deepEqual({ name: group.name, description: group.description, courses: group.courses }, {
    name: 'Onboarding',
    description: 'Required training',
    courses: [],
  });

  const duplicateResponse = await request('POST', '/manage/course-groups', 'group-moderator', {
    name: 'onboarding',
    description: 'Duplicate should be rejected',
  });
  assert.equal(duplicateResponse.status, 409);
  assert.deepEqual(await duplicateResponse.json(), {
    error: 'A course group with this name already exists.',
    code: 'course_group_exists',
  });

  const assignment = await request('PUT', '/manage/course-groups/' + group.id + '/courses/group-course-a', 'group-moderator');
  assert.equal(assignment.status, 201);
  assert.deepEqual(await assignment.json(), {
    course: { id: 'group-course-a', title: 'Course A', category: 'General', status: 'published' },
  });

  const duplicateAssignment = await request('PUT', '/manage/course-groups/' + group.id + '/courses/group-course-a', 'group-admin');
  assert.equal(duplicateAssignment.status, 409);
  assert.deepEqual(await duplicateAssignment.json(), {
    error: 'This course is already in the group.',
    code: 'course_group_course_exists',
  });

  const listing = await request('GET', '/manage/course-groups', 'group-admin');
  assert.equal(listing.status, 200);
  const listedGroups = await listing.json();
  assert.deepEqual(listedGroups.groups.map((entry) => ({
    id: entry.id,
    name: entry.name,
    courses: entry.courses,
  })), [{
    id: group.id,
    name: 'Onboarding',
    courses: [{ id: 'group-course-a', title: 'Course A', category: 'General', status: 'published' }],
  }]);

  const learnerAssignment = await request('PUT', '/manage/course-groups/' + group.id + '/courses/group-course-b', 'group-learner');
  assert.equal(learnerAssignment.status, 403);

  const removal = await request('DELETE', '/manage/course-groups/' + group.id + '/courses/group-course-a', 'group-moderator');
  assert.equal(removal.status, 204);
  assert.equal(await removal.text(), '');

  const repeatedRemoval = await request('DELETE', '/manage/course-groups/' + group.id + '/courses/group-course-a', 'group-admin');
  assert.equal(repeatedRemoval.status, 404);

  const missingCourse = await request('PUT', '/manage/course-groups/' + group.id + '/courses/missing-course', 'group-admin');
  assert.equal(missingCourse.status, 404);

  const finalListing = await request('GET', '/manage/course-groups', 'group-admin');
  assert.equal(finalListing.status, 200);
  assert.deepEqual((await finalListing.json()).groups[0].courses, []);
});
