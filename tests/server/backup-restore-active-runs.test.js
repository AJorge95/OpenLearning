import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

const fixturePrefix = 'openlearning-backup-restore-active-';
const environmentKeys = ['NODE_ENV', 'DATA_DIR', 'DB_PATH', 'MEDIA_ROOT', 'BACKUP_DIR'];
const originalEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
let fixtureDirectory;
let config;
let database;
let createBackup;
let restoreBackupRun;

function createFixtureDirectory() {
  const temporaryRoot = path.resolve(os.tmpdir());
  const directory = fsSync.mkdtempSync(path.join(temporaryRoot, fixturePrefix));
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== temporaryRoot
    || !path.basename(resolvedDirectory).startsWith(fixturePrefix)) {
    throw new Error('Refusing to use an unexpected temporary directory.');
  }
  return resolvedDirectory;
}

function removeFixtureDirectory(directory) {
  if (!directory) return;
  const temporaryRoot = path.resolve(os.tmpdir());
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== temporaryRoot
    || !path.basename(resolvedDirectory).startsWith(fixturePrefix)) {
    throw new Error('Refusing to remove an unexpected temporary directory.');
  }
  fsSync.rmSync(resolvedDirectory, { recursive: true, force: true });
}

before(async () => {
  fixtureDirectory = createFixtureDirectory();
  const dataDirectory = path.join(fixtureDirectory, 'data');
  const databasePath = path.join(fixtureDirectory, 'database', 'learning.sqlite');
  const mediaRoot = path.join(fixtureDirectory, 'media', 'uploads');
  const backupRoot = path.join(fixtureDirectory, 'backups');
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATA_DIR: dataDirectory,
    DB_PATH: databasePath,
    MEDIA_ROOT: mediaRoot,
    BACKUP_DIR: backupRoot,
  });
  ({ config } = await import('../../server/config.js'));
  ({ db: database } = await import('../../server/db.js'));
  ({ createBackup } = await import('../../scripts/backup.js'));
  ({ restoreBackupRun } = await import('../../server/backup-restore.js'));
});

after(() => {
  if (database?.open) database.close();
  removeFixtureDirectory(fixtureDirectory);
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('restoring a full backup fails queued runs that cannot resume from its snapshot', async () => {
  const restoreJobId = randomUUID();
  const queuedJobId = randomUUID();
  const restoreRunId = randomUUID();
  const queuedRunId = randomUUID();
  const adminId = randomUUID();
  const destinationPath = path.join(fixtureDirectory, 'backups');
  const mediaFile = path.join(config.mediaRoot, 'course', 'lesson.bin');
  const originalMedia = Buffer.from('media present in the restore point');

  await fs.mkdir(path.dirname(mediaFile), { recursive: true });
  await fs.writeFile(mediaFile, originalMedia);
  database.prepare(`INSERT INTO users (id, username, password_hash, role)
    VALUES (?, 'backup_restore_active_admin', 'unused-test-hash', 'admin')`).run(adminId);
  const insertJob = database.prepare(`INSERT INTO backup_jobs
    (id, name, scope, frequency, weekday, run_time_utc, destination_path, retention_count, enabled)
    VALUES (?, ?, 'full', 'daily', NULL, '02:00', ?, 14, 1)`);
  insertJob.run(restoreJobId, 'Restore point job', destinationPath);
  insertJob.run(queuedJobId, 'Queued job', destinationPath);
  const createdAt = new Date().toISOString();
  database.prepare(`INSERT INTO backup_runs (id, job_id, job_name, scope, destination_path,
    trigger_type, status, started_at, created_at)
    VALUES (?, ?, 'Restore point job', 'full', ?, 'manual', 'running', ?, ?)`)
    .run(restoreRunId, restoreJobId, destinationPath, createdAt, createdAt);
  database.prepare(`INSERT INTO backup_runs (id, job_id, job_name, scope, destination_path,
    trigger_type, status, created_at)
    VALUES (?, ?, 'Queued job', 'full', ?, 'scheduled', 'pending', ?)`)
    .run(queuedRunId, queuedJobId, destinationPath, createdAt);
  database.prepare("UPDATE app_settings SET value = 'Value in restore point' WHERE key = 'platform_name'").run();

  const backupPath = await createBackup({
    appConfig: config,
    destinationRoot: destinationPath,
    scope: 'full',
    jobId: restoreJobId,
    runId: restoreRunId,
  });
  database.prepare(`UPDATE backup_runs SET status = 'success', finished_at = ?, backup_path = ? WHERE id = ?`)
    .run(new Date().toISOString(), backupPath, restoreRunId);

  database.prepare("UPDATE app_settings SET value = 'Changed after backup' WHERE key = 'platform_name'").run();
  await fs.writeFile(mediaFile, Buffer.from('changed after backup'));

  const result = await restoreBackupRun(restoreRunId, { id: adminId, username: 'backup_restore_active_admin' });

  assert.equal(result.runId, restoreRunId);
  assert.equal(database.prepare("SELECT value FROM app_settings WHERE key = 'platform_name'").get().value,
    'Value in restore point');
  assert.deepEqual(await fs.readFile(mediaFile), originalMedia);
  assert.equal(database.prepare('SELECT status FROM backup_runs WHERE id = ?').get(restoreRunId).status, 'success');

  const queuedRun = database.prepare('SELECT status, finished_at, error_message FROM backup_runs WHERE id = ?').get(queuedRunId);
  assert.equal(queuedRun.status, 'failed');
  assert.ok(queuedRun.finished_at);
  assert.match(queuedRun.error_message, /could not resume after restoration/i);
});
