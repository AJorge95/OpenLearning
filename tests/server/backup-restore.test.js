import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import Database from 'better-sqlite3';

const fixturePrefix = 'openlearning-backup-restore-';
const environmentKeys = ['NODE_ENV', 'DATA_DIR', 'DB_PATH', 'MEDIA_ROOT'];
const originalEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
let fixtureDirectory;
let config;
let database;

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
  const defaultDataDirectory = path.join(fixtureDirectory, 'configured-data');
  const databasePath = path.join(fixtureDirectory, 'database-override', 'learning.sqlite');
  const mediaRoot = path.join(fixtureDirectory, 'media-override', 'uploads');
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATA_DIR: defaultDataDirectory,
    DB_PATH: databasePath,
    MEDIA_ROOT: mediaRoot,
  });
  ({ config } = await import('../../server/config.js'));
  ({ db: database } = await import('../../server/db.js'));
});

after(() => {
  if (database?.open) database.close();
  removeFixtureDirectory(fixtureDirectory);
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('SQLite online backup restores an installation using independent database and media paths', async () => {
  assert.equal(config.dbPath, path.join(fixtureDirectory, 'database-override', 'learning.sqlite'));
  assert.equal(config.mediaRoot, path.join(fixtureDirectory, 'media-override', 'uploads'));
  assert.notEqual(path.dirname(config.dbPath), config.dataDir);
  assert.notEqual(config.mediaRoot, path.join(config.dataDir, 'course-media'));

  const adminId = 'backup-restore-admin';
  const courseId = 'backup-restore-course';
  const mediaId = 'backup-restore-cover';
  const fileName = '11111111-1111-4111-8111-111111111111.png';
  const mediaContents = Buffer.from('isolated cover media fixture');
  database.prepare(`INSERT INTO users (id, username, password_hash, role)
    VALUES (?, 'backup_restore_admin', 'unused-test-hash', 'admin')`).run(adminId);
  database.prepare(`INSERT INTO courses (id, title, status, created_by, updated_by)
    VALUES (?, 'Backup restore fixture', 'published', ?, ?)`).run(courseId, adminId, adminId);
  database.prepare(`INSERT INTO media_files
    (id, course_id, original_name, file_name, mime_type, byte_size, media_kind)
    VALUES (?, ?, 'cover.png', ?, 'image/png', ?, 'cover')`).run(mediaId, courseId, fileName, mediaContents.length);
  database.prepare('UPDATE courses SET cover_media_id = ? WHERE id = ?').run(mediaId, courseId);
  database.prepare("UPDATE app_settings SET value = 'Backup fixture platform' WHERE key = 'platform_name'").run();
  await fs.mkdir(path.join(config.mediaRoot, courseId), { recursive: true });
  await fs.writeFile(path.join(config.mediaRoot, courseId, fileName), mediaContents);

  const backupDirectory = path.join(fixtureDirectory, 'backup');
  const databaseBackup = path.join(backupDirectory, 'openlearning.sqlite');
  const mediaBackup = path.join(backupDirectory, 'course-media');
  await fs.mkdir(backupDirectory, { recursive: true });

  // Match the documented workflow: SQLite's online backup plus a paused media-tree copy.
  await database.backup(databaseBackup);
  await fs.cp(config.mediaRoot, mediaBackup, { recursive: true });

  database.close();
  database = null;
  await fs.rm(config.dbPath, { force: true });
  await fs.rm(`${config.dbPath}-wal`, { force: true });
  await fs.rm(`${config.dbPath}-shm`, { force: true });
  await fs.rm(config.mediaRoot, { recursive: true, force: true });

  await fs.mkdir(path.dirname(config.dbPath), { recursive: true });
  await fs.mkdir(path.dirname(config.mediaRoot), { recursive: true });
  await fs.copyFile(databaseBackup, config.dbPath);
  await fs.cp(mediaBackup, config.mediaRoot, { recursive: true });

  const restoredDatabase = new Database(config.dbPath);
  try {
    assert.deepEqual(restoredDatabase.pragma('integrity_check'), [{ integrity_check: 'ok' }]);
    assert.equal(restoredDatabase.prepare('SELECT value FROM app_settings WHERE key = ?').get('platform_name').value,
      'Backup fixture platform');
    assert.equal(restoredDatabase.prepare('SELECT title FROM courses WHERE id = ?').get(courseId).title,
      'Backup restore fixture');
    assert.equal(restoredDatabase.prepare('SELECT file_name FROM media_files WHERE id = ?').get(mediaId).file_name,
      fileName);
    assert.deepEqual(await fs.readFile(path.join(config.mediaRoot, courseId, fileName)), mediaContents);
  } finally {
    restoredDatabase.close();
  }
});
