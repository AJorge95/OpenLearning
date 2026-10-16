import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { config } from '../server/config.js';
import { copyMediaTree } from '../server/media-backup.js';

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

function timestampedDirectoryName(date) {
  return `${date.toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
}

function verifyDatabaseBackup(databasePath, DatabaseClass) {
  const backupDatabase = new DatabaseClass(databasePath, { readonly: true, fileMustExist: true });
  try {
    // Match the reset workflow: do not call a snapshot verified unless SQLite confirms its structure.
    const checkResults = backupDatabase.pragma('quick_check');
    if (checkResults.length === 0 || checkResults.some((row) => row.quick_check !== 'ok')) {
      throw new Error('SQLite backup verification failed.');
    }
  } finally {
    if (backupDatabase.open) backupDatabase.close();
  }
}

async function removeDatabaseSidecars(databasePath) {
  await Promise.all(['-wal', '-shm'].map((suffix) => fs.rm(`${databasePath}${suffix}`, { force: true })));
}

export async function createBackup({
  appConfig = config,
  destinationRoot = path.resolve(process.cwd(), process.env.BACKUP_DIR?.trim() || './backup'),
  scope = 'full',
  jobId = null,
  runId = null,
  DatabaseClass = Database,
  copyMedia = copyMediaTree,
  now = new Date(),
} = {}) {
  if (!['full', 'database', 'media'].includes(scope)) throw new Error('Backup scope must be full, database, or media.');
  const databasePath = await fs.realpath(path.resolve(appConfig.dbPath));
  const mediaRoot = await fs.realpath(path.resolve(appConfig.mediaRoot));
  const backupRoot = await resolveCanonicalPath(destinationRoot);
  const backupDirectory = path.join(backupRoot, timestampedDirectoryName(now));
  const databaseBackupPath = path.join(backupDirectory, 'openlearning.sqlite');
  const mediaBackupPath = path.join(backupDirectory, 'course-media');
  const includesDatabase = scope !== 'media';
  const includesMedia = scope !== 'database';

  // Canonical paths ensure symlinked backup roots cannot bypass the recursive-copy guard.
  if (pathsOverlap(mediaRoot, backupDirectory)) {
    throw new Error('BACKUP_DIR must resolve outside the configured media root.');
  }
  if ((includesDatabase && pathsOverlap(databasePath, backupDirectory))
    || (includesMedia && pathsOverlap(mediaRoot, backupDirectory))
    || pathsOverlap(databaseBackupPath, mediaBackupPath)) {
    throw new Error('Backup output paths must be separate from the source database and each other.');
  }

  if (includesMedia) {
    const mediaDetails = await fs.stat(mediaRoot);
    if (!mediaDetails.isDirectory()) throw new Error('The configured media root is not a directory.');
  }

  let sourceDatabase;
  let backupDirectoryCreated = false;
  let mediaStats = { fileCount: 0, byteCount: 0, files: [] };
  try {
    if (includesDatabase) {
      sourceDatabase = new DatabaseClass(databasePath, { readonly: true, fileMustExist: true });
      sourceDatabase.pragma('busy_timeout = 5000');
    }

    await fs.mkdir(backupRoot, { recursive: true });
    await fs.mkdir(backupDirectory);
    backupDirectoryCreated = true;

    const createdBackupDirectory = await fs.realpath(backupDirectory);
    if (pathsOverlap(mediaRoot, createdBackupDirectory)
      || (includesDatabase && pathsOverlap(databasePath, createdBackupDirectory))) {
      throw new Error('Backup output paths must remain separate from the configured storage paths.');
    }

    if (includesDatabase) {
      await sourceDatabase.backup(databaseBackupPath);
      sourceDatabase.close();
      sourceDatabase = null;
      verifyDatabaseBackup(databaseBackupPath, DatabaseClass);
    }
    if (includesMedia) mediaStats = await copyMedia(mediaRoot, mediaBackupPath);
    if (includesDatabase && runId) {
      const snapshot = new DatabaseClass(databaseBackupPath);
      try {
        snapshot.prepare(`UPDATE backup_runs SET status = 'success', finished_at = ?, backup_path = ?
          WHERE id = ? AND status = 'running'`).run(new Date().toISOString(), backupDirectory, runId);
      } finally {
        if (snapshot.open) snapshot.close();
      }
    }
    if (includesDatabase && runId) verifyDatabaseBackup(databaseBackupPath, DatabaseClass);
    if (includesDatabase) await removeDatabaseSidecars(databaseBackupPath);
    const manifest = {
      createdAt: now.toISOString(),
      scope,
      jobId,
      runId,
      database: includesDatabase ? 'openlearning.sqlite' : null,
      mediaDirectory: includesMedia ? 'course-media' : null,
      mediaFileCount: includesMedia ? mediaStats.fileCount : null,
      mediaBytes: includesMedia ? mediaStats.byteCount : null,
      mediaFiles: includesMedia ? mediaStats.files : null,
    };
    await fs.writeFile(path.join(backupDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    return backupDirectory;
  } catch (cause) {
    if (backupDirectoryCreated) {
      try {
        await fs.rm(backupDirectory, { recursive: true, force: true });
      } catch (cleanupError) {
        throw new AggregateError([cause, cleanupError], 'Backup failed and incomplete output could not be removed.');
      }
    }
    throw cause;
  } finally {
    if (sourceDatabase?.open) sourceDatabase.close();
  }
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log('Usage: npm run backup [-- --help]');
    console.log('Create a timestamped SQLite and media backup under BACKUP_DIR (default: ./backup).');
  } else if (args.length > 0) {
    console.error(`Unrecognized backup argument: ${args[0]}`);
    process.exitCode = 1;
  } else {
    createBackup()
      .then((backupDirectory) => console.log(`Backup created at ${backupDirectory}`))
      .catch((error) => {
        console.error(`Backup failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      });
  }
}
