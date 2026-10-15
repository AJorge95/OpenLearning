import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import express from 'express';
import test, { after, before } from 'node:test';

const environment = {
  NODE_ENV: 'test', DATA_DIR: '', DB_PATH: '', MEDIA_ROOT: '',
  SESSION_SECRET: 'isolated-admin-backups-tests-use-a-local-secret', TRUST_PROXY: 'false', PORT: '3000',
  MAX_UPLOAD_BYTES: '2147483648', REQUEST_TIMEOUT_MS: '300000', BACKUP_DIR: '',
};
const previousEnvironment = new Map(Object.keys(environment).map((key) => [key, process.env[key]]));
let fixtureDirectory;
let mediaRoot;
let destinationRoot;
let database;
let server;
let waitForBackupSchedulerIdle;
let nextBackupAt;

function createFixtureDirectory() {
  const tempBase = path.resolve(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(tempBase, 'openlearning-admin-backups-'));
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== tempBase || !path.basename(resolvedDirectory).startsWith('openlearning-admin-backups-')) {
    throw new Error('Refusing to use an unexpected temporary directory.');
  }
  return resolvedDirectory;
}

function removeFixtureDirectory(directory) {
  if (!directory) return;
  const tempBase = path.resolve(os.tmpdir());
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== tempBase || !path.basename(resolvedDirectory).startsWith('openlearning-admin-backups-')) {
    throw new Error('Refusing to remove an unexpected temporary directory.');
  }
  fs.rmSync(resolvedDirectory, { recursive: true, force: true });
}

function apiUrl(pathname) {
  const address = server.address();
  assert(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}/api/admin${pathname}`;
}

async function waitForRun(runId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(apiUrl('/backups'), { headers: { 'x-test-role': 'admin' } });
    const dashboard = await response.json();
    const run = dashboard.runs.find((item) => item.id === runId);
    if (run && ['success', 'failed'].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Backup job did not finish within the test timeout.');
}

before(async () => {
  fixtureDirectory = createFixtureDirectory();
  mediaRoot = path.join(fixtureDirectory, 'course-media');
  destinationRoot = path.join(fixtureDirectory, 'backups');
  Object.assign(process.env, {
    ...environment,
    DATA_DIR: fixtureDirectory,
    DB_PATH: path.join(fixtureDirectory, 'openlearning.sqlite'),
    MEDIA_ROOT: mediaRoot,
  });
  await fsp.mkdir(mediaRoot, { recursive: true });
  await fsp.mkdir(destinationRoot, { recursive: true });
  ({ db: database } = await import('../../server/db.js'));
  database.prepare(`INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)`)
    .run('backup-test-admin', 'backup-test-admin', 'test-only-hash', 'admin');
  ({ waitForBackupSchedulerIdle, nextBackupAt } = await import('../../server/backup-scheduler.js'));
  const [{ adminRouter }, { errorHandler }] = await Promise.all([
    import('../../server/routes-admin.js'), import('../../server/http.js'),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const role = req.get('x-test-role');
    req.currentUser = role ? { id: `backup-test-${role}`, username: role, role, disabled: false } : null;
    next();
  });
  app.use('/api/admin', adminRouter);
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
  await waitForBackupSchedulerIdle?.();
  if (database?.open) database.close();
  removeFixtureDirectory(fixtureDirectory);
  for (const [key, value] of previousEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('backup configuration and run history are admin-only', async () => {
  const anonymousResponse = await fetch(apiUrl('/backups'));
  assert.equal(anonymousResponse.status, 401);
  const learnerResponse = await fetch(apiUrl('/backups'), { headers: { 'x-test-role': 'learner' } });
  assert.equal(learnerResponse.status, 403);
  const adminResponse = await fetch(apiUrl('/backups'), { headers: { 'x-test-role': 'admin' } });
  assert.equal(adminResponse.status, 200);
  assert.deepEqual(await adminResponse.json(), {
    jobs: [], runs: [], backupInProgress: false, mediaWritesPaused: false,
    defaultDestinationPath: path.resolve(process.cwd(), 'backup'),
  });
});

test('daily and weekly schedules calculate their next UTC occurrence', () => {
  assert.equal(nextBackupAt({ frequency: 'daily', runTimeUtc: '02:00' }, new Date('2026-10-15T03:00:00.000Z')).toISOString(), '2026-10-16T02:00:00.000Z');
  assert.equal(nextBackupAt({ frequency: 'weekly', weekday: 5, runTimeUtc: '03:30' }, new Date('2026-10-15T03:00:00.000Z')).toISOString(), '2026-10-16T03:30:00.000Z');
  assert.equal(nextBackupAt({ frequency: 'weekly', weekday: 5, runTimeUtc: '03:30' }, new Date('2026-10-16T04:00:00.000Z')).toISOString(), '2026-10-23T03:30:00.000Z');
});

test('admins can create, run, inspect, update, and remove a backup job without deleting its artifact', async () => {
  const payload = {
    name: 'Nightly database', scope: 'database', frequency: 'daily', weekday: null,
    runTimeUtc: '02:00', destinationPath: destinationRoot, retentionCount: 14, enabled: true,
  };
  const createResponse = await fetch(apiUrl('/backups/jobs'), {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-test-role': 'admin' }, body: JSON.stringify(payload),
  });
  assert.equal(createResponse.status, 201, createResponse.status === 201 ? '' : await createResponse.text());
  const { job } = await createResponse.json();
  assert.equal(job.name, payload.name);
  assert.equal(job.scope, 'database');
  assert.equal(job.destinationPath, await fsp.realpath(destinationRoot));

  const runResponse = await fetch(apiUrl(`/backups/jobs/${job.id}/run`), { method: 'POST', headers: { 'x-test-role': 'admin' } });
  assert.equal(runResponse.status, 202);
  const { run: queuedRun } = await runResponse.json();
  const completedRun = await waitForRun(queuedRun.id);
  assert.equal(completedRun.status, 'success');
  assert.ok(completedRun.backupPath);
  assert.deepEqual((await fsp.readdir(completedRun.backupPath)).sort(), ['manifest.json', 'openlearning.sqlite']);
  const embeddedDatabase = await import('better-sqlite3');
  const snapshot = new embeddedDatabase.default(path.join(completedRun.backupPath, 'openlearning.sqlite'), { readonly: true, fileMustExist: true });
  try {
    assert.equal(snapshot.prepare('SELECT status FROM backup_runs WHERE id = ?').get(queuedRun.id).status, 'success');
  } finally { snapshot.close(); }

  const updatePayload = { ...payload, name: 'Weekly database', frequency: 'weekly', weekday: 5, runTimeUtc: '03:30', enabled: false };
  const updateResponse = await fetch(apiUrl(`/backups/jobs/${job.id}`), {
    method: 'PUT', headers: { 'content-type': 'application/json', 'x-test-role': 'admin' }, body: JSON.stringify(updatePayload),
  });
  assert.equal(updateResponse.status, 200);
  assert.equal((await updateResponse.json()).job.frequency, 'weekly');

  const removeResponse = await fetch(apiUrl(`/backups/jobs/${job.id}`), { method: 'DELETE', headers: { 'x-test-role': 'admin' } });
  assert.equal(removeResponse.status, 200);
  assert.deepEqual(await removeResponse.json(), { removed: true, backupsKept: true });
  assert.equal(fs.existsSync(completedRun.backupPath), true);
  const historyResponse = await fetch(apiUrl('/backups'), { headers: { 'x-test-role': 'admin' } });
  assert.equal((await historyResponse.json()).runs[0].id, queuedRun.id);
});

test('backup job validation rejects a destination that overlaps course media', async () => {
  const response = await fetch(apiUrl('/backups/jobs'), {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-test-role': 'admin' },
    body: JSON.stringify({ name: 'Unsafe', scope: 'media', frequency: 'daily', weekday: null, runTimeUtc: '03:00', destinationPath: mediaRoot, retentionCount: 14, enabled: true }),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'backup_destination_overlap');
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM backup_jobs').get().count, 0);
});
