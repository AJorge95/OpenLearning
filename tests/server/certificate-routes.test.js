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
  SESSION_SECRET: 'isolated-certificate-route-tests', TRUST_PROXY: 'false', PORT: '3000',
  MAX_UPLOAD_BYTES: '2147483648', REQUEST_TIMEOUT_MS: '300000',
};
const previousConfig = new Map(Object.keys(isolatedConfig).map((key) => [key, process.env[key]]));
let fixtureDirectory;
let database;
let server;

function createFixtureDirectory() {
  const tempBase = path.resolve(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(tempBase, 'openlearning-certificate-routes-'));
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== tempBase || !path.basename(resolved).startsWith('openlearning-certificate-routes-')) {
    throw new Error('Refusing to use an unexpected temporary directory.');
  }
  return resolved;
}

function removeFixtureDirectory(directory) {
  if (!directory) return;
  const tempBase = path.resolve(os.tmpdir());
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== tempBase || !path.basename(resolved).startsWith('openlearning-certificate-routes-')) {
    throw new Error('Refusing to remove an unexpected temporary directory.');
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

function apiUrl(pathname) {
  const address = server.address();
  assert(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}/api${pathname}`;
}

function userHeaders(userId) {
  return { 'x-test-user': userId, connection: 'close' };
}

async function assertApiError(response, status, code) {
  assert.equal(response.status, status);
  assert.equal((await response.json()).code, code);
}

before(async () => {
  fixtureDirectory = createFixtureDirectory();
  Object.assign(process.env, {
    ...isolatedConfig,
    DATA_DIR: fixtureDirectory,
    DB_PATH: path.join(fixtureDirectory, 'openlearning.sqlite'),
    MEDIA_ROOT: path.join(fixtureDirectory, 'course-media'),
  });

  const [{ db: testDatabase, setSetting }, { courseRouter }, { errorHandler }] = await Promise.all([
    import('../../server/db.js'),
    import('../../server/routes-courses.js'),
    import('../../server/http.js'),
  ]);
  database = testDatabase;
  setSetting('platform_name', 'OpenLearning Training');

  database.exec(`
    INSERT INTO users (id, username, email, first_name, last_name, password_hash, role) VALUES
      ('certificate-route-admin', 'certificate_route_admin', 'admin@example.invalid', 'Avery', 'Admin', 'not-used', 'admin'),
      ('certificate-route-owner', 'certificate_route_owner', 'owner@example.invalid', 'Taylor', 'Nguyen', 'not-used', 'learner'),
      ('certificate-route-other', 'certificate_route_other', 'other@example.invalid', 'Morgan', 'Reed', 'not-used', 'learner'),
      ('certificate-route-no-name', 'certificate_route_no_name', 'legacy@example.invalid', '', '', 'not-used', 'learner');
    INSERT INTO courses (id, title, status, created_by, updated_by) VALUES
      ('certificate-route-complete', 'Completed course', 'published', 'certificate-route-admin', 'certificate-route-admin'),
      ('certificate-route-incomplete', 'Incomplete course', 'published', 'certificate-route-admin', 'certificate-route-admin'),
      ('certificate-route-no-name-course', 'Legacy profile course', 'published', 'certificate-route-admin', 'certificate-route-admin');
    INSERT INTO course_modules (id, course_id, title, position) VALUES
      ('certificate-route-complete-module', 'certificate-route-complete', 'Module', 0),
      ('certificate-route-incomplete-module', 'certificate-route-incomplete', 'Module', 0),
      ('certificate-route-no-name-module', 'certificate-route-no-name-course', 'Module', 0);
    INSERT INTO lessons (id, module_id, title, position) VALUES
      ('certificate-route-complete-lesson', 'certificate-route-complete-module', 'Lesson', 0),
      ('certificate-route-incomplete-lesson', 'certificate-route-incomplete-module', 'Lesson', 0),
      ('certificate-route-no-name-lesson', 'certificate-route-no-name-module', 'Lesson', 0);
    INSERT INTO course_versions (id, course_id, storage_course_id, version_number, published_by, change_note) VALUES
      ('certificate-route-complete-version', 'certificate-route-complete', 'certificate-route-complete', 1, 'certificate-route-admin', 'Initial publication'),
      ('certificate-route-incomplete-version', 'certificate-route-incomplete', 'certificate-route-incomplete', 1, 'certificate-route-admin', 'Initial publication'),
      ('certificate-route-no-name-version', 'certificate-route-no-name-course', 'certificate-route-no-name-course', 1, 'certificate-route-admin', 'Initial publication');
    INSERT INTO lesson_progress (user_id, lesson_id) VALUES
      ('certificate-route-owner', 'certificate-route-complete-lesson'),
      ('certificate-route-no-name', 'certificate-route-no-name-lesson');
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

test('certificate route issues once for a completed learner and restricts saved lookup to its owner', async () => {
  const issuedResponse = await fetch(apiUrl('/certificates/certificate-route-complete'), {
    headers: userHeaders('certificate-route-owner'),
  });
  assert.equal(issuedResponse.status, 200);
  const { certificate } = await issuedResponse.json();
  assert.equal(certificate.recipientName, 'Taylor Nguyen');
  assert.equal(certificate.recipientEmail, 'owner@example.invalid');
  assert.equal(certificate.courseTitle, 'Completed course');
  assert.equal(certificate.courseVersionId, 'certificate-route-complete-version');
  assert.match(certificate.certificateCode, /^OL-[A-F0-9]{32}$/);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM course_certificates WHERE user_id = ?')
    .get('certificate-route-owner').count, 1);

  const savedResponse = await fetch(apiUrl(`/certificates/${certificate.id}`), {
    headers: userHeaders('certificate-route-owner'),
  });
  assert.equal(savedResponse.status, 200);
  assert.deepEqual((await savedResponse.json()).certificate, certificate);

  const anotherLearnerResponse = await fetch(apiUrl(`/certificates/${certificate.id}`), {
    headers: userHeaders('certificate-route-other'),
  });
  await assertApiError(anotherLearnerResponse, 404, 'not_found');

  const administratorResponse = await fetch(apiUrl(`/certificates/${certificate.id}`), {
    headers: userHeaders('certificate-route-admin'),
  });
  await assertApiError(administratorResponse, 403, 'forbidden');
});

test('certificate route distinguishes incomplete courses from missing profile names', async () => {
  const incompleteResponse = await fetch(apiUrl('/certificates/certificate-route-incomplete'), {
    headers: userHeaders('certificate-route-owner'),
  });
  await assertApiError(incompleteResponse, 409, 'course_incomplete');

  const missingNameResponse = await fetch(apiUrl('/certificates/certificate-route-no-name-course'), {
    headers: userHeaders('certificate-route-no-name'),
  });
  await assertApiError(missingNameResponse, 409, 'certificate_name_required');

  assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM course_certificates
    WHERE course_id IN ('certificate-route-incomplete', 'certificate-route-no-name-course')`).get().count, 0);
});

test('certificate route still requires an authenticated learner session', async () => {
  const response = await fetch(apiUrl('/certificates/certificate-route-complete'), {
    headers: { connection: 'close' },
  });
  await assertApiError(response, 401, 'unauthorized');
});
