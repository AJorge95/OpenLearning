import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { config } from '../server/config.js';
import { copyMediaTree } from '../server/media-backup.js';
import { createBackup } from './backup.js';

const manifestLimitBytes = 32 * 1024 * 1024;
const mediaHashPattern = /^[a-f0-9]{64}$/;

function isWithin(parentPath, childPath) {
  const relativePath = path.relative(parentPath, childPath);
  return relativePath === ''
    || (relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath));
}

function pathsOverlap(firstPath, secondPath) {
  return isWithin(firstPath, secondPath) || isWithin(secondPath, firstPath);
}

async function resolveCanonicalPath(filePath) {
  const absolutePath = path.resolve(filePath);
  try {
    return await fs.realpath(absolutePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const parentPath = path.dirname(absolutePath);
    if (parentPath === absolutePath) throw error;
    return path.join(await resolveCanonicalPath(parentPath), path.basename(absolutePath));
  }
}

async function hashFile(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function validateMediaManifest(manifest) {
  if (!Array.isArray(manifest.mediaFiles)
    || !Number.isSafeInteger(manifest.mediaFileCount)
    || manifest.mediaFileCount < 0
    || !Number.isSafeInteger(manifest.mediaBytes)
    || manifest.mediaBytes < 0
    || manifest.mediaFiles.length !== manifest.mediaFileCount) {
    throw new Error('The backup manifest has invalid media file totals.');
  }

  const files = new Map();
  let byteCount = 0;
  for (const file of manifest.mediaFiles) {
    if (!file || typeof file.path !== 'string' || file.path.length === 0 || file.path.includes('\\')
      || path.posix.isAbsolute(file.path) || path.posix.normalize(file.path) !== file.path
      || file.path.split('/').some((part) => part === '' || part === '.' || part === '..')
      || !Number.isSafeInteger(file.bytes) || file.bytes < 0
      || typeof file.sha256 !== 'string' || !mediaHashPattern.test(file.sha256)
      || files.has(file.path)) {
      throw new Error('The backup manifest contains an invalid or duplicate media file entry.');
    }
    files.set(file.path, { bytes: file.bytes, sha256: file.sha256 });
    byteCount += file.bytes;
    if (!Number.isSafeInteger(byteCount)) throw new Error('The backup manifest media size exceeds the supported limit.');
  }
  if (byteCount !== manifest.mediaBytes) throw new Error('The backup manifest media byte total does not match its file entries.');
  return files;
}

async function inspectMediaTree(directory, relativePath = '') {
  const files = new Map();
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    const relativeFilePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`The backup media contains a symbolic link: ${relativeFilePath}.`);
    if (entry.isDirectory()) {
      for (const [nestedPath, details] of await inspectMediaTree(absolutePath, relativeFilePath)) files.set(nestedPath, details);
    } else if (entry.isFile()) {
      const stats = await fs.stat(absolutePath);
      files.set(relativeFilePath, { bytes: stats.size, sha256: await hashFile(absolutePath) });
    } else {
      throw new Error(`The backup media contains an unsupported file system entry: ${relativeFilePath}.`);
    }
  }
  return files;
}

function compareMediaInventories(expected, actual) {
  if (expected.size !== actual.size) throw new Error('The backup media file count does not match its manifest.');
  for (const [filePath, expectedDetails] of expected) {
    const actualDetails = actual.get(filePath);
    if (!actualDetails || actualDetails.bytes !== expectedDetails.bytes || actualDetails.sha256 !== expectedDetails.sha256) {
      throw new Error(`Backup media verification failed for ${filePath}.`);
    }
  }
}

async function readFullBackup(backupPath) {
  const canonicalDirectory = await fs.realpath(path.resolve(backupPath));
  const directoryStats = await fs.stat(canonicalDirectory);
  if (!directoryStats.isDirectory()) throw new Error('Choose a full backup directory.');

  const manifestPath = path.join(canonicalDirectory, 'manifest.json');
  const manifestStats = await fs.lstat(manifestPath);
  if (!manifestStats.isFile() || manifestStats.isSymbolicLink() || manifestStats.size > manifestLimitBytes) {
    throw new Error('The backup manifest is missing, unsafe, or larger than 32 MiB.');
  }
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`The backup manifest is not valid JSON: ${error.message}`);
  }
  if (!manifest || manifest.scope !== 'full' || manifest.database !== 'openlearning.sqlite'
    || manifest.mediaDirectory !== 'course-media') {
    throw new Error('Restore requires a full OpenLearning backup containing both the database and course media.');
  }

  const databasePath = path.join(canonicalDirectory, 'openlearning.sqlite');
  const databaseStats = await fs.lstat(databasePath);
  const mediaPath = path.join(canonicalDirectory, 'course-media');
  const mediaStats = await fs.lstat(mediaPath);
  if (!databaseStats.isFile() || databaseStats.isSymbolicLink() || !mediaStats.isDirectory() || mediaStats.isSymbolicLink()) {
    throw new Error('The full backup is missing a regular SQLite database file or course media directory.');
  }

  const expectedMedia = validateMediaManifest(manifest);
  compareMediaInventories(expectedMedia, await inspectMediaTree(mediaPath));
  verifyDatabase(databasePath);
  return { directory: canonicalDirectory, databasePath, mediaPath, manifest };
}

function verifyDatabase(databasePath) {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const quickCheck = database.pragma('quick_check');
    if (quickCheck.length === 0 || quickCheck.some((row) => row.quick_check !== 'ok')) {
      throw new Error('The backup SQLite database failed its integrity check.');
    }
    const hasApplicationSettings = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'app_settings'").get();
    const hasSchemaMigrations = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get();
    if (!hasApplicationSettings || !hasSchemaMigrations) throw new Error('The SQLite file is not an OpenLearning database.');
  } finally {
    if (database.open) database.close();
  }
}

function migrateStagedDatabase(databasePath, stageDirectory) {
  const mediaRoot = path.join(stageDirectory, 'migration-media');
  const result = spawnSync(process.execPath, [path.join(config.projectDir, 'server', 'migrate.js')], {
    cwd: config.projectDir,
    env: {
      ...process.env,
      DATA_DIR: stageDirectory,
      DB_PATH: databasePath,
      MEDIA_ROOT: mediaRoot,
    },
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    timeout: 120_000,
  });
  if (result.error) throw new Error(`Could not prepare the backup database: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim().slice(-2000);
    throw new Error(`The backup database could not be migrated for this OpenLearning version.${detail ? ` ${detail}` : ''}`);
  }
  verifyDatabase(databasePath);
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    if (database.pragma('foreign_key_check').length) throw new Error('The migrated backup database has foreign-key violations.');
  } finally {
    if (database.open) database.close();
  }
}

async function checkpointStagedDatabase(databasePath) {
  const database = new Database(databasePath, { fileMustExist: true });
  try {
    const checkpoint = database.pragma('wal_checkpoint(TRUNCATE)')[0];
    if (checkpoint?.busy) throw new Error('The staged backup database could not be checkpointed before installation.');
  } finally {
    if (database.open) database.close();
  }
  await removeIfPresent(`${databasePath}-wal`);
  await removeIfPresent(`${databasePath}-shm`);
  verifyDatabase(databasePath);
}

async function storagePathExists(filePath, kind) {
  try {
    const stats = await fs.lstat(filePath);
    if (stats.isSymbolicLink() || (kind === 'file' ? !stats.isFile() : !stats.isDirectory())) {
      throw new Error(`The configured ${kind === 'file' ? 'database path' : 'media root'} must be a regular ${kind}, not a symbolic link.`);
    }
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function moveIfPresent(sourcePath, destinationPath, kind = 'file') {
  try {
    const stats = await fs.lstat(sourcePath);
    if (stats.isSymbolicLink() || (kind === 'file' ? !stats.isFile() : !stats.isDirectory())) {
      throw new Error(`Refusing to move an unexpected restore target at ${sourcePath}.`);
    }
    await fs.rename(sourcePath, destinationPath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function assertApplicationStopped(port = config.port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(1500) });
    await response.body?.cancel();
    throw new Error(`A service is still responding on OpenLearning's configured port (HTTP ${response.status}). Stop it before restoring a backup.`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('A service is still responding')) throw error;
    if (error?.cause?.code === 'ECONNREFUSED') return;
    throw new Error('Could not confirm that OpenLearning is stopped on its configured port. Stop the application and try again.', { cause: error });
  }
}

async function removeIfPresent(filePath, options = {}) {
  await fs.rm(filePath, { force: true, ...options });
}

async function restoreBackup(backupPath, { appConfig = config, backup = createBackup } = {}) {
  const source = await readFullBackup(backupPath);
  const databasePath = path.resolve(appConfig.dbPath);
  const mediaRoot = path.resolve(appConfig.mediaRoot);
  const canonicalDatabasePath = await resolveCanonicalPath(databasePath);
  const canonicalMediaRoot = await resolveCanonicalPath(mediaRoot);
  if (pathsOverlap(canonicalDatabasePath, canonicalMediaRoot)
    || pathsOverlap(source.directory, canonicalDatabasePath)
    || pathsOverlap(source.directory, canonicalMediaRoot)) {
    throw new Error('The selected backup, database path, and media root must be separate paths.');
  }

  await assertApplicationStopped();
  const databaseExists = await storagePathExists(databasePath, 'file');
  const mediaExists = await storagePathExists(mediaRoot, 'directory');
  let preRestoreBackup = null;
  let preRestoreBackupError = null;
  if (databaseExists && mediaExists) {
    try {
      preRestoreBackup = await backup({ appConfig, scope: 'full' });
    } catch (error) {
      preRestoreBackupError = error instanceof Error ? error.message : String(error);
    }
  } else {
    preRestoreBackupError = 'A complete current database and media directory were not both present.';
  }
  const operationId = randomUUID();
  const databaseParent = path.dirname(databasePath);
  const mediaParent = path.dirname(mediaRoot);
  let databaseStageDirectory = null;
  let mediaStageDirectory = null;
  let stagedDatabasePath;
  let stagedMediaRoot;
  const oldDatabasePath = `${databasePath}.openlearning-restore-${operationId}`;
  const oldDatabaseWalPath = `${databasePath}-wal.openlearning-restore-${operationId}`;
  const oldDatabaseShmPath = `${databasePath}-shm.openlearning-restore-${operationId}`;
  const oldMediaRoot = `${mediaRoot}.openlearning-restore-${operationId}`;
  const expectedMedia = validateMediaManifest(source.manifest);
  let databaseMoved = false;
  let databaseWalMoved = false;
  let databaseShmMoved = false;
  let mediaMoved = false;
  let databaseInstalled = false;
  let mediaInstalled = false;
  let preserveStaging = false;

  try {
    await Promise.all([fs.mkdir(databaseParent, { recursive: true }), fs.mkdir(mediaParent, { recursive: true })]);
    databaseStageDirectory = await fs.mkdtemp(path.join(databaseParent, '.openlearning-restore-database-'));
    mediaStageDirectory = await fs.mkdtemp(path.join(mediaParent, '.openlearning-restore-media-'));
    stagedDatabasePath = path.join(databaseStageDirectory, 'openlearning.sqlite');
    stagedMediaRoot = path.join(mediaStageDirectory, 'course-media');
    await fs.copyFile(source.databasePath, stagedDatabasePath);
    await copyMediaTree(source.mediaPath, stagedMediaRoot);
    compareMediaInventories(expectedMedia, await inspectMediaTree(stagedMediaRoot));
    migrateStagedDatabase(stagedDatabasePath, databaseStageDirectory);
    await checkpointStagedDatabase(stagedDatabasePath);

    databaseMoved = await moveIfPresent(databasePath, oldDatabasePath);
    databaseWalMoved = await moveIfPresent(`${databasePath}-wal`, oldDatabaseWalPath);
    databaseShmMoved = await moveIfPresent(`${databasePath}-shm`, oldDatabaseShmPath);
    mediaMoved = await moveIfPresent(mediaRoot, oldMediaRoot, 'directory');
    await fs.rename(stagedDatabasePath, databasePath);
    databaseInstalled = true;
    await fs.rename(stagedMediaRoot, mediaRoot);
    mediaInstalled = true;

    verifyDatabase(databasePath);
    compareMediaInventories(expectedMedia, await inspectMediaTree(mediaRoot));
  } catch (cause) {
    const rollbackErrors = [];
    const rollback = async (operation) => {
      try { await operation(); } catch (error) { rollbackErrors.push(error); }
    };
    if (databaseInstalled) {
      await rollback(() => removeIfPresent(`${databasePath}-wal`));
      await rollback(() => removeIfPresent(`${databasePath}-shm`));
    }
    if (mediaInstalled) await rollback(() => fs.rename(mediaRoot, stagedMediaRoot));
    if (databaseInstalled) await rollback(() => fs.rename(databasePath, stagedDatabasePath));
    if (databaseShmMoved) await rollback(() => fs.rename(oldDatabaseShmPath, `${databasePath}-shm`));
    if (databaseWalMoved) await rollback(() => fs.rename(oldDatabaseWalPath, `${databasePath}-wal`));
    if (databaseMoved) await rollback(() => fs.rename(oldDatabasePath, databasePath));
    if (mediaMoved) await rollback(() => fs.rename(oldMediaRoot, mediaRoot));
    if (rollbackErrors.length) {
      preserveStaging = true;
      throw new AggregateError([cause, ...rollbackErrors], `Restore failed and the previous installation could not be fully put back. Pre-restore backup: ${preRestoreBackup}. Preserve the remaining .openlearning-restore-* paths for recovery.`);
    }
    throw new Error(`Restore failed; the previous database and media directory were put back. Pre-restore backup: ${preRestoreBackup}. ${cause.message}`, { cause });
  } finally {
    if (!preserveStaging) {
      if (databaseStageDirectory) await removeIfPresent(databaseStageDirectory, { recursive: true });
      if (mediaStageDirectory) await removeIfPresent(mediaStageDirectory, { recursive: true });
    }
  }

  const preservedPaths = [];
  if (preRestoreBackup) {
    await removeIfPresent(oldDatabasePath);
    await removeIfPresent(oldDatabaseWalPath);
    await removeIfPresent(oldDatabaseShmPath);
    await removeIfPresent(oldMediaRoot, { recursive: true });
  } else {
    if (databaseMoved) preservedPaths.push(oldDatabasePath);
    if (databaseWalMoved) preservedPaths.push(oldDatabaseWalPath);
    if (databaseShmMoved) preservedPaths.push(oldDatabaseShmPath);
    if (mediaMoved) preservedPaths.push(oldMediaRoot);
  }
  return { backupDirectory: source.directory, preRestoreBackup, preRestoreBackupError, preservedPaths };
}

function printUsage() {
  console.log('Usage: npm run restore -- <full-backup-directory>');
  console.log('Restore the verified SQLite database and course media from a full OpenLearning backup.');
  console.log('Stop the application first. A verified backup of current data is created when possible; otherwise existing files are preserved beside their configured paths.');
}

async function main(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    printUsage();
    return;
  }
  if (args.length !== 1 || args[0].startsWith('-')) {
    printUsage();
    throw new Error('Provide exactly one full backup directory.');
  }
  const result = await restoreBackup(args[0]);
  console.log(`Restored full backup from ${result.backupDirectory}`);
  if (result.preRestoreBackup) {
    console.log(`The previous installation was preserved at ${result.preRestoreBackup}`);
  } else if (result.preservedPaths.length) {
    console.log(`A verified pre-restore backup could not be created (${result.preRestoreBackupError}). Existing files were kept at: ${result.preservedPaths.join(', ')}`);
  } else {
    console.log('No previous database or media directory was present to preserve.');
  }
  console.log('Restart OpenLearning to apply the restored data.');
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Restore failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

export {
  compareMediaInventories,
  inspectMediaTree,
  migrateStagedDatabase,
  readFullBackup,
  restoreBackup,
  validateMediaManifest,
  verifyDatabase,
};
