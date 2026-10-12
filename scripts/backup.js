import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { config } from '../server/config.js';

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

export async function createBackup({
  appConfig = config,
  destinationRoot = path.resolve(process.cwd(), process.env.BACKUP_DIR?.trim() || './backup'),
  DatabaseClass = Database,
  copyMedia = fs.cp,
  now = new Date(),
} = {}) {
  const databasePath = await fs.realpath(path.resolve(appConfig.dbPath));
  const mediaRoot = await fs.realpath(path.resolve(appConfig.mediaRoot));
  const backupRoot = await resolveCanonicalPath(destinationRoot);
  const backupDirectory = path.join(backupRoot, timestampedDirectoryName(now));
  const databaseBackupPath = path.join(backupDirectory, 'openlearning.sqlite');
  const mediaBackupPath = path.join(backupDirectory, 'course-media');

  // Canonical paths ensure symlinked backup roots cannot bypass the recursive-copy guard.
  if (pathsOverlap(mediaRoot, backupDirectory)) {
    throw new Error('BACKUP_DIR must resolve outside the configured media root.');
  }
  if (pathsOverlap(databasePath, databaseBackupPath) || pathsOverlap(databaseBackupPath, mediaBackupPath)) {
    throw new Error('Backup output paths must be separate from the source database and each other.');
  }

  const mediaDetails = await fs.stat(mediaRoot);
  if (!mediaDetails.isDirectory()) throw new Error('The configured media root is not a directory.');

  let sourceDatabase;
  let backupDirectoryCreated = false;
  try {
    sourceDatabase = new DatabaseClass(databasePath, { readonly: true, fileMustExist: true });
    sourceDatabase.pragma('busy_timeout = 5000');

    await fs.mkdir(backupRoot, { recursive: true });
    await fs.mkdir(backupDirectory);
    backupDirectoryCreated = true;

    const createdBackupDirectory = await fs.realpath(backupDirectory);
    if (pathsOverlap(mediaRoot, createdBackupDirectory) || pathsOverlap(databasePath, createdBackupDirectory)) {
      throw new Error('Backup output paths must remain separate from the configured storage paths.');
    }

    await sourceDatabase.backup(databaseBackupPath);
    sourceDatabase.close();
    sourceDatabase = null;
    await copyMedia(mediaRoot, mediaBackupPath, { recursive: true, errorOnExist: true, force: false });
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
