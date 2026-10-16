import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { createBackup } from '../../scripts/backup.js';

const fixturePrefix = 'openlearning-backup-script-';
const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scriptPath = path.join(projectDirectory, 'scripts', 'backup.js');
let fixtureDirectory;
let databasePath;
let mediaRoot;
let backupRoot;
let database;
let mediaPath;
let mediaContents;

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

function runBackup(destinationRoot, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: projectDirectory,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DATA_DIR: path.join(fixtureDirectory, 'default-data'),
        DB_PATH: databasePath,
        MEDIA_ROOT: mediaRoot,
        BACKUP_DIR: destinationRoot,
        SESSION_SECRET: 'isolated-backup-script-test-secret',
        SETUP_TOKEN: '',
        TRUST_PROXY: 'false',
        PORT: '6173',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

before(async () => {
  fixtureDirectory = createFixtureDirectory();
  databasePath = path.join(fixtureDirectory, 'database-override', 'learning.sqlite');
  mediaRoot = path.join(fixtureDirectory, 'media-override', 'uploads');
  backupRoot = path.join(fixtureDirectory, 'backup-output');
  mediaPath = path.join(mediaRoot, 'course-one', 'cover.png');
  mediaContents = Buffer.from('backup-script media fixture');

  await fs.mkdir(path.dirname(databasePath), { recursive: true });
  await fs.mkdir(path.dirname(mediaPath), { recursive: true });
  database = new Database(databasePath);
  database.pragma('journal_mode = WAL');
  database.exec('CREATE TABLE backup_fixture (value TEXT NOT NULL); INSERT INTO backup_fixture VALUES (\'configured database path\');');
  await fs.writeFile(mediaPath, mediaContents);
});

after(() => {
  if (database?.open) database.close();
  removeFixtureDirectory(fixtureDirectory);
});

test('backup command snapshots configured SQLite and media paths into a fresh directory', async () => {
  const result = await runBackup(backupRoot);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^Backup created at /);

  const backupDirectories = await fs.readdir(backupRoot, { withFileTypes: true });
  assert.equal(backupDirectories.length, 1);
  assert.ok(backupDirectories[0].isDirectory());
  const backupDirectory = path.join(backupRoot, backupDirectories[0].name);
  const backupDatabase = new Database(path.join(backupDirectory, 'openlearning.sqlite'), { readonly: true, fileMustExist: true });
  try {
    assert.deepEqual(backupDatabase.pragma('integrity_check'), [{ integrity_check: 'ok' }]);
    assert.equal(backupDatabase.prepare('SELECT value FROM backup_fixture').get().value, 'configured database path');
  } finally {
    backupDatabase.close();
  }
  assert.deepEqual(await fs.readFile(path.join(backupDirectory, 'course-media', 'course-one', 'cover.png')), mediaContents);
  const manifest = JSON.parse(await fs.readFile(path.join(backupDirectory, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.mediaFiles, [{
    path: 'course-one/cover.png',
    bytes: mediaContents.length,
    sha256: createHash('sha256').update(mediaContents).digest('hex'),
  }]);
});

test('database-only and media-only backups contain only the selected data components', async () => {
  const databaseOnly = await createBackup({ appConfig: { dbPath: databasePath, mediaRoot }, destinationRoot: path.join(fixtureDirectory, 'database-only'), scope: 'database' });
  const mediaOnly = await createBackup({ appConfig: { dbPath: databasePath, mediaRoot }, destinationRoot: path.join(fixtureDirectory, 'media-only'), scope: 'media' });

  assert.deepEqual((await fs.readdir(databaseOnly)).sort(), ['manifest.json', 'openlearning.sqlite']);
  const databaseManifest = JSON.parse(await fs.readFile(path.join(databaseOnly, 'manifest.json'), 'utf8'));
  assert.equal(databaseManifest.scope, 'database');
  assert.equal(databaseManifest.database, 'openlearning.sqlite');
  assert.equal(databaseManifest.mediaDirectory, null);
  assert.equal(databaseManifest.mediaFiles, null);
  assert.deepEqual((await fs.readdir(mediaOnly)).sort(), ['course-media', 'manifest.json']);
  assert.deepEqual(await fs.readFile(path.join(mediaOnly, 'course-media', 'course-one', 'cover.png')), mediaContents);
  const mediaManifest = JSON.parse(await fs.readFile(path.join(mediaOnly, 'manifest.json'), 'utf8'));
  assert.equal(mediaManifest.scope, 'media');
  assert.equal(mediaManifest.database, null);
  assert.equal(mediaManifest.mediaFileCount, 1);
  assert.equal(mediaManifest.mediaBytes, mediaContents.length);
  assert.deepEqual(mediaManifest.mediaFiles, [{
    path: 'course-one/cover.png',
    bytes: mediaContents.length,
    sha256: createHash('sha256').update(mediaContents).digest('hex'),
  }]);
});

test('backup help prints usage without creating a backup', async () => {
  const helpDestination = path.join(fixtureDirectory, 'help-output');
  const result = await runBackup(helpDestination, ['--help']);

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Usage: npm run backup/);
  await assert.rejects(fs.stat(helpDestination), { code: 'ENOENT' });
});

test('backup command rejects an output directory inside the media root without creating it', async () => {
  const unsafeDestination = path.join(mediaRoot, 'backup-output');
  const result = await runBackup(unsafeDestination);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /BACKUP_DIR must resolve outside the configured media root/);
  await assert.rejects(fs.stat(unsafeDestination), { code: 'ENOENT' });
});

test('backup command rejects an output root that aliases the media root through a directory link', async () => {
  const linkedDestination = path.join(fixtureDirectory, 'backup-to-media');
  await fs.symlink(mediaRoot, linkedDestination, process.platform === 'win32' ? 'junction' : 'dir');

  await assert.rejects(createBackup({
    appConfig: { dbPath: databasePath, mediaRoot },
    destinationRoot: linkedDestination,
  }), /BACKUP_DIR must resolve outside the configured media root/);
  assert.deepEqual(await fs.readdir(mediaRoot), ['course-one']);
});

test('backup command removes partial output if the media copy fails', async () => {
  const failedBackupRoot = path.join(fixtureDirectory, 'failed-backup-output');

  await assert.rejects(createBackup({
    appConfig: { dbPath: databasePath, mediaRoot },
    destinationRoot: failedBackupRoot,
    copyMedia: async () => { throw new Error('media copy failed'); },
  }), /media copy failed/);
  assert.deepEqual(await fs.readdir(failedBackupRoot), []);
});

test('backup command rejects and removes a database snapshot that fails SQLite quick_check', async () => {
  const failedBackupRoot = path.join(fixtureDirectory, 'failed-database-verification');
  let openedDatabaseCount = 0;
  let verificationClosed = false;
  let mediaCopyAttempted = false;

  class FailingVerificationDatabase {
    constructor() {
      this.open = true;
      this.isBackup = openedDatabaseCount > 0;
      openedDatabaseCount += 1;
    }

    pragma(statement) {
      if (statement === 'busy_timeout = 5000') return undefined;
      assert.equal(statement, 'quick_check');
      return [{ quick_check: 'database disk image is malformed' }];
    }

    async backup(destination) {
      await fs.writeFile(destination, 'invalid database snapshot');
    }

    close() {
      this.open = false;
      if (this.isBackup) verificationClosed = true;
    }
  }

  await assert.rejects(createBackup({
    appConfig: { dbPath: databasePath, mediaRoot },
    destinationRoot: failedBackupRoot,
    DatabaseClass: FailingVerificationDatabase,
    copyMedia: async () => { mediaCopyAttempted = true; },
  }), /SQLite backup verification failed/);

  assert.equal(verificationClosed, true);
  assert.equal(mediaCopyAttempted, false);
  assert.deepEqual(await fs.readdir(failedBackupRoot), []);
});
