import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import Database from 'better-sqlite3';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { db, setSetting } from './db.js';
import { config } from './config.js';
import { fail } from './http.js';
import { writeAuditLog, writeSystemLog } from './log-store.js';

const confirmationLifetimeMs = 15 * 60 * 1000;
const resetDefaults = {
  platform_name: '',
  theme_palette: 'violet',
  connection_protocol: config.nodeEnv === 'production' ? 'https' : 'http',
  registration_enabled: '1',
  user_limit: '0',
  registration_fields: '[]',
  setup_complete: '1',
};

let resetState = null;
let activeRequests = 0;
let idleWaiters = [];

function stateFor(actorId) {
  if (resetState?.phase === 'ready' && resetState.expiresAt <= Date.now()) resetState = null;
  if (!resetState) return null;
  if (actorId && resetState.actorId !== actorId) {
    return { pending: true, phase: resetState.phase };
  }
  return {
    pending: true,
    phase: resetState.phase,
    confirmationId: resetState.confirmationId,
    backupLocation: resetState.backupLocation,
    expiresAt: resetState.expiresAt,
  };
}

export function getPlatformResetStatus(actorId) {
  return stateFor(actorId) || { pending: false };
}

export function isPlatformResetActive() {
  return Boolean(stateFor(null));
}

function isResetEndpoint(pathname) {
  return pathname === '/api/admin/platform-reset'
    || pathname === '/api/admin/platform-reset/prepare'
    || pathname === '/api/admin/platform-reset/confirm'
    || pathname === '/api/admin/platform-reset/cancel';
}

export function platformResetGate(req, res, next) {
  if (!req.path.startsWith('/api/') && !req.path.startsWith('/media/')) return next();
  if (isResetEndpoint(req.path)) return next();
  if (isPlatformResetActive()) {
    return res.status(503).json({ error: 'The platform is paused while an administrator prepares a reset.', code: 'platform_reset_in_progress' });
  }

  activeRequests += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeRequests = Math.max(0, activeRequests - 1);
    if (activeRequests === 0) {
      const waiters = idleWaiters;
      idleWaiters = [];
      waiters.forEach((resolve) => resolve());
    }
  };
  res.once('finish', release);
  res.once('close', release);
  next();
}

function waitForActiveRequests() {
  if (activeRequests === 0) return Promise.resolve();
  return new Promise((resolve) => idleWaiters.push(resolve));
}

function pathIsInside(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function resolveNewPath(targetPath) {
  const realParentPath = await fs.realpath(path.dirname(targetPath));
  return path.join(realParentPath, path.basename(targetPath));
}

export async function assertResetBackupPathsSafe({ mediaRoot, databasePath, backupDirectory }) {
  const [realMediaRoot, realDatabasePath, realBackupDirectory] = await Promise.all([
    fs.realpath(mediaRoot),
    fs.realpath(databasePath),
    resolveNewPath(backupDirectory),
  ]);
  if (pathIsInside(realMediaRoot, realBackupDirectory)) {
    throw new Error('The configured backup location overlaps the course media directory.');
  }
  if (pathIsInside(realMediaRoot, realDatabasePath)) {
    throw new Error('The configured database path is inside the course media directory, so it cannot be reset safely.');
  }
}

async function copyMediaTree(source, destination) {
  await fs.mkdir(destination, { recursive: true });
  let fileCount = 0;
  let byteCount = 0;
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isSymbolicLink()) throw new Error('The course media directory contains a symbolic link; the backup cannot safely include it.');
    if (entry.isDirectory()) {
      const nested = await copyMediaTree(from, to);
      fileCount += nested.fileCount;
      byteCount += nested.byteCount;
    } else if (entry.isFile()) {
      const stats = await fs.stat(from);
      await fs.copyFile(from, to, constants.COPYFILE_EXCL);
      const copied = await fs.stat(to);
      if (copied.size !== stats.size) throw new Error(`Media file verification failed for ${entry.name}.`);
      fileCount += 1;
      byteCount += stats.size;
    } else {
      throw new Error('The course media directory contains an unsupported file type.');
    }
  }
  return { fileCount, byteCount };
}

async function createBackup() {
  const backupsRoot = path.join(config.dataDir, 'backups');
  await fs.mkdir(backupsRoot, { recursive: true });
  const timestamp = new Date().toISOString().replaceAll(':', '-');
  const directoryName = `platform-reset-${timestamp}-${randomBytes(3).toString('hex')}`;
  const backupDirectory = path.join(backupsRoot, directoryName);
  await assertResetBackupPathsSafe({ mediaRoot: config.mediaRoot, databasePath: config.dbPath, backupDirectory });
  await fs.mkdir(backupDirectory, { recursive: false });
  try {
    const databasePath = path.join(backupDirectory, 'openlearning.sqlite');
    await db.backup(databasePath);
    const mediaPath = path.join(backupDirectory, 'course-media');
    const mediaStats = await copyMediaTree(config.mediaRoot, mediaPath);
    const backupDb = new Database(databasePath, { readonly: true, fileMustExist: true });
    try {
      backupDb.pragma('quick_check').forEach((row) => {
        if (row.quick_check !== 'ok') throw new Error('SQLite backup verification failed.');
      });
    } finally {
      backupDb.close();
    }
    const manifest = {
      createdAt: new Date().toISOString(),
      database: 'openlearning.sqlite',
      mediaDirectory: 'course-media',
      mediaFileCount: mediaStats.fileCount,
      mediaBytes: mediaStats.byteCount,
    };
    await fs.writeFile(path.join(backupDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    return { backupDirectory, backupLocation: path.relative(config.dataDir, backupDirectory).split(path.sep).join('/') };
  } catch (error) {
    await fs.rm(backupDirectory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export async function preparePlatformReset(actor) {
  if (resetState) fail(409, 'A platform reset is already in progress.', 'platform_reset_in_progress');
  const initialState = {
    phase: 'preparing',
    actorId: actor.id,
    confirmationId: randomUUID(),
    expiresAt: 0,
    backupLocation: null,
    nonce: randomUUID(),
  };
  resetState = initialState;
  await waitForActiveRequests();
  try {
    const backup = await createBackup();
    if (resetState !== initialState) fail(409, 'The reset preparation was canceled.', 'platform_reset_canceled');
    initialState.phase = 'ready';
    initialState.backupLocation = backup.backupLocation;
    initialState.backupDirectory = backup.backupDirectory;
    initialState.expiresAt = Date.now() + confirmationLifetimeMs;
    writeSystemLog('warn', 'platform-reset', 'A complete pre-reset backup was created', { actorId: actor.id, backupLocation: backup.backupLocation });
    return stateFor(actor.id);
  } catch (error) {
    if (resetState === initialState) resetState = null;
    throw error;
  }
}

function requireResetState(actor, confirmationId) {
  const current = stateFor(actor.id);
  if (!resetState || resetState.actorId !== actor.id || resetState.phase !== 'ready' || resetState.confirmationId !== confirmationId || current?.phase !== 'ready') {
    fail(409, 'The reset confirmation expired or is no longer valid. Prepare a new backup before trying again.', 'platform_reset_confirmation_invalid');
  }
  return resetState;
}

export function cancelPlatformReset(actor, confirmationId) {
  const current = requireResetState(actor, confirmationId);
  resetState = null;
  return { canceled: true, backupLocation: current.backupLocation };
}

async function replaceMediaRoot() {
  const mediaRoot = await fs.realpath(config.mediaRoot);
  const parent = path.dirname(mediaRoot);
  const quarantinePath = path.join(parent, `.course-media-reset-${randomUUID()}`);
  let moved = false;
  try {
    await fs.rename(mediaRoot, quarantinePath);
    moved = true;
    await fs.mkdir(mediaRoot, { recursive: true });
    return async (committed) => {
      if (committed) {
        await fs.rm(quarantinePath, { recursive: true, force: true });
      } else {
        await fs.rm(mediaRoot, { recursive: true, force: true });
        await fs.rename(quarantinePath, mediaRoot);
      }
    };
  } catch (error) {
    if (moved) {
      await fs.rm(mediaRoot, { recursive: true, force: true }).catch(() => {});
      await fs.rename(quarantinePath, mediaRoot).catch(() => {});
    }
    throw error;
  }
}

export async function confirmPlatformReset(actor, confirmationId, phrase) {
  const current = requireResetState(actor, confirmationId);
  if (phrase !== 'RESET') fail(400, 'Type RESET exactly to confirm the platform reset.', 'platform_reset_confirmation_phrase');
  let restoreMedia = null;
  let committed = false;
  try {
    restoreMedia = await replaceMediaRoot();
    const reset = db.transaction(() => {
      db.prepare('DELETE FROM learning_paths').run();
      db.prepare('DELETE FROM competencies').run();
      db.prepare('DELETE FROM course_certificates').run();
      db.prepare('DELETE FROM courses').run();
      db.prepare('DELETE FROM user_registration_field_values').run();
      db.prepare('DELETE FROM users WHERE id <> ?').run(actor.id);
      db.prepare('DELETE FROM sessions').run();
      db.prepare('DELETE FROM app_settings').run();
      for (const [key, value] of Object.entries(resetDefaults)) setSetting(key, value);
      const auditId = writeAuditLog({
        actor,
        action: 'platform.reset',
        entityType: 'platform',
        summary: 'Platform reset to default settings',
        details: { backupLocation: current.backupLocation, preservedAdministratorId: actor.id },
      });
      if (!auditId) fail(500, 'The platform reset could not be recorded in the audit log.', 'audit_unavailable');
    });
    reset.immediate();
    committed = true;
    try {
      await restoreMedia(true);
    } catch (error) {
      writeSystemLog('error', 'platform-reset', 'The platform reset completed but old course media could not be removed from its quarantine folder', {
        errorName: String(error?.name || 'Error').slice(0, 100), errorCode: typeof error?.code === 'string' ? error.code.slice(0, 100) : undefined,
      });
    }
    writeSystemLog('warn', 'platform-reset', 'Platform data was reset to defaults', { actorId: actor.id, backupLocation: current.backupLocation });
    return { reset: true, backupLocation: current.backupLocation };
  } catch (error) {
    if (!committed && restoreMedia) await restoreMedia(false).catch(() => {});
    throw error;
  } finally {
    if (!committed && resetState === current) resetState = null;
  }
}

export function finishPlatformReset() {
  resetState = null;
}
