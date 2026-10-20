import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { db } from './db.js';
import { fail } from './http.js';
import { writeAuditLog, writeSystemLog } from './log-store.js';
import { copyMediaTree } from './media-backup.js';
import { waitForStartupMediaCleanup } from './media-maintenance.js';
import { markBackupRestoreRecoveryRequired, refreshBackupSchedulesNow, withBackupRestoreLock } from './backup-scheduler.js';
import { createBackup } from '../scripts/backup.js';
import {
  compareMediaInventories,
  inspectMediaTree,
  migrateStagedDatabase,
  readFullBackup,
  validateMediaManifest,
  verifyDatabase,
} from '../scripts/restore.js';

const restoreJournalPath = path.join(config.dataDir, '.backup-restore-journal.json');
const restoreMarkerKey = '__openlearning_backup_restore_operation_id';
const uuidPattern = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;

function isWithin(parentPath, childPath) {
  const relativePath = path.relative(parentPath, childPath);
  return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath));
}

function pathsOverlap(firstPath, secondPath) {
  return isWithin(firstPath, secondPath) || isWithin(secondPath, firstPath);
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function getPathKind(filePath) {
  try {
    const stats = await fs.lstat(filePath);
    if (stats.isSymbolicLink()) throw new Error(`Refusing to use a symbolic link at ${filePath}.`);
    return stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : 'other';
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeRestoreJournal(operationId) {
  await fs.mkdir(config.dataDir, { recursive: true });
  const temporaryPath = `${restoreJournalPath}.${operationId}.tmp`;
  const handle = await fs.open(temporaryPath, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify({ version: 1, operationId, databasePath: path.resolve(config.dbPath), mediaRoot: path.resolve(config.mediaRoot) })}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temporaryPath, restoreJournalPath);
}

async function readRestoreJournal() {
  let content;
  try {
    const stats = await fs.lstat(restoreJournalPath);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > 1024) {
      throw new Error('The interrupted backup restoration journal is unsafe; refusing to serve the application.');
    }
    content = await fs.readFile(restoreJournalPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  let journal;
  try {
    journal = JSON.parse(content);
  } catch (error) {
    throw new Error('The interrupted backup restoration journal is invalid; refusing to serve the application.', { cause: error });
  }
  if (journal?.version !== 1 || typeof journal.operationId !== 'string' || !uuidPattern.test(journal.operationId)
    || journal.databasePath !== path.resolve(config.dbPath) || journal.mediaRoot !== path.resolve(config.mediaRoot)) {
    throw new Error('The interrupted backup restoration journal is invalid; refusing to serve the application.');
  }
  return journal;
}

function restoreMediaPaths(operationId) {
  return {
    mediaRoot: path.resolve(config.mediaRoot),
    stagedMediaRoot: `${path.resolve(config.mediaRoot)}.openlearning-restore-stage-${operationId}`,
    oldMediaRoot: `${path.resolve(config.mediaRoot)}.openlearning-restore-old-${operationId}`,
  };
}

function restoreDatabaseStageDirectory(operationId) {
  return path.join(path.dirname(config.dbPath), `.openlearning-restore-database-${operationId}`);
}

async function clearRestoreMarker(operationId) {
  db.prepare('DELETE FROM app_settings WHERE key = ? AND value = ?').run(restoreMarkerKey, operationId);
}

async function recoverJournal(journal) {
  const { mediaRoot, stagedMediaRoot, oldMediaRoot } = restoreMediaPaths(journal.operationId);
  const stagedDatabaseDirectory = restoreDatabaseStageDirectory(journal.operationId);
  const marker = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(restoreMarkerKey)?.value;
  const mediaKind = await getPathKind(mediaRoot);
  const stagedKind = await getPathKind(stagedMediaRoot);
  const oldKind = await getPathKind(oldMediaRoot);
  const stagedDatabaseKind = await getPathKind(stagedDatabaseDirectory);
  if ((stagedKind && stagedKind !== 'directory') || (oldKind && oldKind !== 'directory')
    || (stagedDatabaseKind && stagedDatabaseKind !== 'directory')) {
    throw new Error('An interrupted backup restoration has an unexpected temporary file; refusing to serve the application.');
  }

  if (marker === journal.operationId) {
    if (mediaKind !== 'directory') {
      throw new Error('The restored database is present but its course media directory is missing; refusing to serve the application.');
    }
    if (oldKind) await fs.rm(oldMediaRoot, { recursive: true, force: true });
    if (stagedKind) await fs.rm(stagedMediaRoot, { recursive: true, force: true });
    if (stagedDatabaseKind) await fs.rm(stagedDatabaseDirectory, { recursive: true, force: true });
    await fs.rm(restoreJournalPath, { force: true });
    await clearRestoreMarker(journal.operationId);
    return 'completed';
  }

  if (oldKind === 'directory') {
    if (mediaKind && mediaKind !== 'directory') {
      throw new Error('The media path has an unexpected file type after an interrupted restoration; refusing to serve the application.');
    }
    if (mediaKind) await fs.rm(mediaRoot, { recursive: true, force: true });
    await fs.rename(oldMediaRoot, mediaRoot);
  } else if (mediaKind !== 'directory') {
    throw new Error('The previous course media could not be recovered after an interrupted restoration; refusing to serve the application.');
  }
  if (stagedKind) await fs.rm(stagedMediaRoot, { recursive: true, force: true });
  if (stagedDatabaseKind) await fs.rm(stagedDatabaseDirectory, { recursive: true, force: true });
  await fs.rm(restoreJournalPath, { force: true });
  return 'rolled_back';
}

export async function recoverInterruptedBackupRestore() {
  const journal = await readRestoreJournal();
  if (!journal) {
    db.prepare('DELETE FROM app_settings WHERE key = ?').run(restoreMarkerKey);
    return null;
  }
  const outcome = await recoverJournal(journal);
  writeSystemLog('warn', 'backup-restore', `Recovered an interrupted backup restoration (${outcome}).`, {
    operationId: journal.operationId,
  });
  return outcome;
}

function tableNames(schema) {
  return db.prepare(`SELECT name FROM ${schema}.sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all().map((row) => row.name);
}

function tableColumns(schema, tableName) {
  return db.prepare(`PRAGMA ${schema}.table_info(${quoteIdentifier(tableName)})`).all().map((column) => column.name);
}

function restoreDatabaseFromStage(stagedDatabasePath, operationId) {
  verifyDatabase(stagedDatabasePath);
  db.pragma('foreign_keys = OFF');
  let attached = false;
  try {
    db.prepare('ATTACH DATABASE ? AS restore_source').run(stagedDatabasePath);
    attached = true;
    const targetTables = tableNames('main');
    const sourceTables = tableNames('restore_source');
    if (JSON.stringify(targetTables) !== JSON.stringify(sourceTables)) {
      throw new Error('The selected backup database schema does not match this OpenLearning installation.');
    }
    for (const tableName of targetTables) {
      if (JSON.stringify(tableColumns('main', tableName)) !== JSON.stringify(tableColumns('restore_source', tableName))) {
        throw new Error(`The selected backup has an incompatible ${tableName} table.`);
      }
    }

    db.transaction(() => {
      for (const tableName of targetTables) {
        if (tableName === 'sessions') continue;
        const quotedTable = quoteIdentifier(tableName);
        const columns = tableColumns('main', tableName);
        if (!columns.length) continue;
        const quotedColumns = columns.map(quoteIdentifier).join(', ');
        db.exec(`DELETE FROM main.${quotedTable}`);
        db.exec(`INSERT INTO main.${quotedTable} (${quotedColumns}) SELECT ${quotedColumns} FROM restore_source.${quotedTable}`);
      }
      // The restored snapshot has no matching in-memory queue to resume pending work.
      db.prepare(`UPDATE main.backup_runs
        SET status = 'failed', finished_at = ?, error_message = ?
        WHERE status IN ('pending', 'running')`)
        .run(new Date().toISOString(), 'This backup run could not resume after restoration.');
      db.exec('DELETE FROM main.sessions');

      const hasSequence = db.prepare("SELECT 1 FROM restore_source.sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'").get();
      if (hasSequence) {
        db.exec('DELETE FROM main.sqlite_sequence');
        db.exec('INSERT INTO main.sqlite_sequence (name, seq) SELECT name, seq FROM restore_source.sqlite_sequence');
      }

      db.prepare(`INSERT INTO main.app_settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(restoreMarkerKey, operationId);
      const foreignKeyErrors = db.pragma('foreign_key_check');
      if (foreignKeyErrors.length) throw new Error('The selected backup database has foreign-key violations.');
    }).immediate();
  } finally {
    try {
      if (attached) db.prepare('DETACH DATABASE restore_source').run();
    } finally {
      db.pragma('foreign_keys = ON');
    }
  }
}

async function validateRunBackup(run) {
  let source;
  try {
    source = await readFullBackup(run.backup_path);
  } catch (error) {
    fail(409, `The selected full backup could not be verified. ${error.message}`, 'backup_restore_invalid');
  }
  let destination;
  try {
    destination = await fs.realpath(run.destination_path);
  } catch {
    fail(409, 'The selected backup destination is no longer available.', 'backup_restore_invalid');
  }
  if (path.dirname(source.directory) !== destination
    || source.manifest.runId !== run.id
    || source.manifest.jobId !== run.job_id) {
    fail(409, 'The selected backup manifest does not match its completed backup run.', 'backup_restore_invalid');
  }
  return source;
}

async function stageBackup(source, operationId) {
  const databaseParent = path.dirname(config.dbPath);
  const mediaParent = path.dirname(config.mediaRoot);
  const stageDirectory = restoreDatabaseStageDirectory(operationId);
  const stagedDatabasePath = path.join(stageDirectory, 'openlearning.sqlite');
  const { stagedMediaRoot } = restoreMediaPaths(operationId);
  let stagedDatabaseCreated = false;
  let stagedMediaCreated = false;
  try {
    await fs.mkdir(stageDirectory);
    stagedDatabaseCreated = true;
    await fs.copyFile(source.databasePath, stagedDatabasePath);
    await fs.mkdir(mediaParent, { recursive: true });
    await fs.mkdir(stagedMediaRoot);
    stagedMediaCreated = true;
    const expectedMedia = validateMediaManifest(source.manifest);
    await copyMediaTree(source.mediaPath, stagedMediaRoot);
    compareMediaInventories(expectedMedia, await inspectMediaTree(stagedMediaRoot));
    migrateStagedDatabase(stagedDatabasePath, stageDirectory);
    verifyDatabase(stagedDatabasePath);
    return { stageDirectory, stagedDatabasePath, stagedMediaRoot };
  } catch (error) {
    if (stagedDatabaseCreated) await fs.rm(stageDirectory, { recursive: true, force: true });
    if (stagedMediaCreated) await fs.rm(stagedMediaRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function restoreBackupRun(runId, actor) {
  if (typeof runId !== 'string' || !uuidPattern.test(runId)) fail(400, 'Choose a valid backup run.', 'validation_error');
  return withBackupRestoreLock(async () => {
    await waitForStartupMediaCleanup();
    const unfinishedRestore = await readRestoreJournal();
    if (unfinishedRestore) {
      try {
        await recoverJournal(unfinishedRestore);
      } catch (error) {
        markBackupRestoreRecoveryRequired();
        throw error;
      }
    }
    const run = db.prepare('SELECT * FROM backup_runs WHERE id = ?').get(runId);
    if (!run) fail(404, 'The selected backup run was not found.', 'not_found');
    if (run.status !== 'success' || run.scope !== 'full' || !run.backup_path || run.artifact_deleted_at) {
      fail(409, 'Only a completed, retained full backup can be restored.', 'backup_restore_unavailable');
    }

    const source = await validateRunBackup(run);
    const databasePath = await fs.realpath(config.dbPath);
    const mediaRoot = await fs.realpath(config.mediaRoot);
    if (pathsOverlap(source.directory, databasePath) || pathsOverlap(source.directory, mediaRoot)
      || pathsOverlap(databasePath, mediaRoot) || pathsOverlap(restoreJournalPath, mediaRoot)) {
      fail(409, 'The selected backup, database, and media storage must be separate paths.', 'backup_restore_path_overlap');
    }
    if (await getPathKind(config.mediaRoot) !== 'directory') {
      fail(409, 'The configured course media path must be a regular directory before restoration.', 'backup_restore_invalid_target');
    }

    const operationId = randomUUID();
    const staged = await stageBackup(source, operationId);
    const { mediaRoot: restoreTarget, stagedMediaRoot, oldMediaRoot } = restoreMediaPaths(operationId);
    if (await getPathKind(oldMediaRoot) || await getPathKind(stagedMediaRoot) !== 'directory') {
      await fs.rm(staged.stageDirectory, { recursive: true, force: true });
      await fs.rm(staged.stagedMediaRoot, { recursive: true, force: true });
      fail(409, 'A temporary restoration path already exists; no data was replaced.', 'backup_restore_path_conflict');
    }

    try {
      await writeRestoreJournal(operationId);
    } catch (error) {
      await fs.rm(staged.stageDirectory, { recursive: true, force: true });
      await fs.rm(staged.stagedMediaRoot, { recursive: true, force: true });
      throw error;
    }

    let preRestoreBackup;
    try {
      preRestoreBackup = await createBackup({ appConfig: config, scope: 'full' });
    } catch (error) {
      await fs.rm(staged.stageDirectory, { recursive: true, force: true });
      await fs.rm(staged.stagedMediaRoot, { recursive: true, force: true });
      await fs.rm(restoreJournalPath, { force: true });
      fail(500, `A verified pre-restoration backup could not be created, so no data was replaced. ${error.message}`, 'backup_restore_prebackup_failed');
    }
    try {
      await fs.rename(restoreTarget, oldMediaRoot);
      await fs.rename(stagedMediaRoot, restoreTarget);
      restoreDatabaseFromStage(staged.stagedDatabasePath, operationId);
    } catch (error) {
      let recoveredAsCompleted = false;
      try {
        recoveredAsCompleted = await recoverJournal({ operationId }) === 'completed';
      } catch (recoveryError) {
        markBackupRestoreRecoveryRequired();
        throw new AggregateError([error, recoveryError], 'Restoration failed and automatic recovery is incomplete. Keep the OpenLearning service stopped and preserve the .openlearning-restore-* paths.');
      }
      await fs.rm(staged.stageDirectory, { recursive: true, force: true });
      if (!recoveredAsCompleted) {
        throw new Error(`Restoration failed; the previous course media and database were restored. ${error.message}`, { cause: error });
      }
    }

    try {
      const restoredActorId = db.prepare('SELECT id FROM users WHERE id = ?').get(actor?.id)?.id || null;
      const auditId = writeAuditLog({ actor: { id: restoredActorId, username: actor?.username }, action: 'backup.restore_completed', entityType: 'backup_run', entityId: run.id,
        summary: `Restored a full backup: ${run.job_name}`, details: { runId: run.id, backupPath: source.directory, preRestoreBackup } });
      if (!auditId) writeSystemLog('warn', 'backup-restore', 'The restoration completed but its audit record could not be saved.', { operationId, runId: run.id });
      refreshBackupSchedulesNow();
    } catch (error) {
      writeSystemLog('warn', 'backup-restore', 'The restoration completed but backup schedules could not be refreshed immediately.', {
        operationId, errorName: String(error?.name || 'Error').slice(0, 100),
      });
    }

    let cleanupPending = false;
    try {
      await fs.rm(oldMediaRoot, { recursive: true, force: true });
      await fs.rm(staged.stageDirectory, { recursive: true, force: true });
      await fs.rm(restoreJournalPath, { force: true });
      await clearRestoreMarker(operationId);
    } catch (error) {
      cleanupPending = true;
      writeSystemLog('warn', 'backup-restore', 'The restoration succeeded but temporary recovery files could not be fully cleaned up.', {
        operationId, errorName: String(error?.name || 'Error').slice(0, 100), errorCode: typeof error?.code === 'string' ? error.code.slice(0, 100) : undefined,
      });
    }
    writeSystemLog('info', 'backup-restore', 'A full backup was restored from Settings.', {
      operationId, runId: run.id, backupPath: source.directory, preRestoreBackup, cleanupPending,
    });
    return { runId: run.id, backupPath: source.directory, preRestoreBackup, sessionsCleared: true, cleanupPending };
  });
}
