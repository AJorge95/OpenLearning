import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { db } from './db.js';
import { fail } from './http.js';
import { writeAuditLog, writeSystemLog } from './log-store.js';
import { createBackup } from '../scripts/backup.js';

const scheduleTickMs = 15_000;
const recentRunLimit = 50;
const backupPathDefault = path.resolve(process.cwd(), process.env.BACKUP_DIR?.trim() || './backup');
let scheduleTimer = null;
let shouldDeferScheduledRun = () => false;
let nextRunByJob = new Map();
let queuedRuns = [];
let queuedJobIds = new Set();
let activeRunId = null;
let workerRunning = false;
let mediaWritesPaused = false;
let activeMutations = 0;
let mutationWaiters = [];
let idleWaiters = [];

function isWithin(parentPath, childPath) {
  const relative = path.relative(parentPath, childPath);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function pathsOverlap(firstPath, secondPath) {
  return isWithin(firstPath, secondPath) || isWithin(secondPath, firstPath);
}

function jobFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    scope: row.scope,
    frequency: row.frequency,
    weekday: row.weekday,
    runTimeUtc: row.run_time_utc,
    destinationPath: row.destination_path,
    retentionCount: row.retention_count,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function runFromRow(row) {
  return {
    id: row.id,
    jobId: row.job_id,
    jobName: row.job_name,
    scope: row.scope,
    destinationPath: row.destination_path,
    triggerType: row.trigger_type,
    triggeredBy: row.triggered_by,
    status: row.status,
    scheduledFor: row.scheduled_for,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    backupPath: row.backup_path,
    artifactDeletedAt: row.artifact_deleted_at,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}

function localDateAtTime(date, time) {
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hours, minutes));
}

export function nextBackupAt(job, after = new Date()) {
  const time = localDateAtTime(after, job.runTimeUtc);
  if (job.frequency === 'daily') {
    if (time <= after) time.setUTCDate(time.getUTCDate() + 1);
    return time;
  }
  const currentDay = after.getUTCDay();
  let dayOffset = (job.weekday - currentDay + 7) % 7;
  time.setUTCDate(time.getUTCDate() + dayOffset);
  if (time <= after) time.setUTCDate(time.getUTCDate() + 7);
  return time;
}

function normalizeJobInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'A backup job is required.', 'validation_error');
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 80) fail(400, 'Backup job names must be between 1 and 80 characters.', 'validation_error');
  if (!['full', 'database', 'media'].includes(input.scope)) fail(400, 'Choose a full, database-only, or media-only backup.', 'validation_error');
  if (!['daily', 'weekly'].includes(input.frequency)) fail(400, 'Choose a daily or weekly schedule.', 'validation_error');
  const weekday = input.frequency === 'weekly' ? input.weekday : null;
  if (input.frequency === 'weekly' && (!Number.isInteger(weekday) || weekday < 0 || weekday > 6)) {
    fail(400, 'Choose a weekday for a weekly backup.', 'validation_error');
  }
  if (input.frequency === 'daily' && input.weekday !== null && input.weekday !== undefined) {
    fail(400, 'Daily backups do not use a weekday.', 'validation_error');
  }
  if (typeof input.runTimeUtc !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input.runTimeUtc)) {
    fail(400, 'Enter a valid UTC time in 24-hour HH:MM format.', 'validation_error');
  }
  const destinationPath = typeof input.destinationPath === 'string' ? input.destinationPath.trim() : '';
  if (!destinationPath || destinationPath.length > 1024 || !path.isAbsolute(destinationPath)) {
    fail(400, 'Enter an absolute server path for the backup destination.', 'validation_error');
  }
  if (!Number.isInteger(input.retentionCount) || input.retentionCount < 1 || input.retentionCount > 365) {
    fail(400, 'Retain between 1 and 365 successful backups.', 'validation_error');
  }
  if (typeof input.enabled !== 'boolean') fail(400, 'Choose whether this backup job is enabled.', 'validation_error');
  return { name, scope: input.scope, frequency: input.frequency, weekday, runTimeUtc: input.runTimeUtc,
    destinationPath: path.resolve(destinationPath), retentionCount: input.retentionCount, enabled: input.enabled };
}

export async function validateBackupDestination(destinationPath) {
  if (typeof destinationPath !== 'string' || !path.isAbsolute(destinationPath)) {
    fail(400, 'Enter an absolute server path for the backup destination.', 'validation_error');
  }
  let canonicalDestination;
  try {
    canonicalDestination = await fs.realpath(destinationPath);
    const [destinationStats, databasePath, mediaRoot] = await Promise.all([
      fs.stat(canonicalDestination), fs.realpath(config.dbPath), fs.realpath(config.mediaRoot),
    ]);
    if (!destinationStats.isDirectory()) fail(400, 'The backup destination must be an existing directory.', 'backup_destination_invalid');
    await fs.access(canonicalDestination, fsConstants.W_OK);
    if (pathsOverlap(canonicalDestination, mediaRoot) || pathsOverlap(canonicalDestination, databasePath)) {
      fail(400, 'The backup destination must be separate from the database and course media storage.', 'backup_destination_overlap');
    }
  } catch (error) {
    if (error?.status) throw error;
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      fail(400, 'The backup destination must be an existing directory on the server.', 'backup_destination_invalid');
    }
    if (error?.code === 'EACCES' || error?.code === 'EPERM' || error?.code === 'EROFS') {
      fail(400, 'The OpenLearning server process cannot write to this backup destination.', 'backup_destination_unwritable');
    }
    throw error;
  }
  return canonicalDestination;
}

function writeAudit(actor, action, job, summary) {
  const auditId = writeAuditLog({ actor, action, entityType: 'backup_job', entityId: job.id, summary,
    details: { jobName: job.name, scope: job.scope, frequency: job.frequency, destinationPath: job.destinationPath } });
  if (!auditId) fail(500, 'The backup job could not be saved because the audit log is unavailable.', 'audit_unavailable');
}

export async function saveBackupJob(input, actor, jobId = null) {
  const normalized = normalizeJobInput(input);
  normalized.destinationPath = await validateBackupDestination(normalized.destinationPath);
  const existing = jobId ? db.prepare('SELECT * FROM backup_jobs WHERE id = ?').get(jobId) : null;
  if (jobId && !existing) fail(404, 'Backup job not found.', 'not_found');
  const id = jobId || randomUUID();
  const job = { id, ...normalized };
  const save = db.transaction(() => {
    if (existing) {
      const previous = jobFromRow(existing);
      if (JSON.stringify({ ...previous, createdAt: undefined, updatedAt: undefined })
        === JSON.stringify({ ...job, createdAt: undefined, updatedAt: undefined })) return false;
      db.prepare(`UPDATE backup_jobs SET name = ?, scope = ?, frequency = ?, weekday = ?, run_time_utc = ?,
        destination_path = ?, retention_count = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(job.name, job.scope, job.frequency, job.weekday, job.runTimeUtc, job.destinationPath, job.retentionCount, Number(job.enabled), id);
      writeAudit(actor, 'backup.job_updated', job, `Updated backup job: ${job.name}`);
    } else {
      db.prepare(`INSERT INTO backup_jobs (id, name, scope, frequency, weekday, run_time_utc, destination_path, retention_count, enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, job.name, job.scope, job.frequency, job.weekday, job.runTimeUtc, job.destinationPath, job.retentionCount, Number(job.enabled));
      writeAudit(actor, 'backup.job_created', job, `Created backup job: ${job.name}`);
    }
    return true;
  }).immediate();
  if (save) refreshBackupSchedulesNow();
  return jobFromRow(db.prepare('SELECT * FROM backup_jobs WHERE id = ?').get(id));
}

export function removeBackupJob(jobId, actor) {
  const existing = db.prepare('SELECT * FROM backup_jobs WHERE id = ?').get(jobId);
  if (!existing) fail(404, 'Backup job not found.', 'not_found');
  if (db.prepare("SELECT 1 FROM backup_runs WHERE job_id = ? AND status IN ('pending', 'running') LIMIT 1").get(jobId)) {
    fail(409, 'A backup job cannot be removed while it has a queued or active run.', 'backup_job_active');
  }
  const job = jobFromRow(existing);
  db.transaction(() => {
    writeAudit(actor, 'backup.job_removed', job, `Removed backup job: ${job.name}; existing backup files were kept`);
    db.prepare('DELETE FROM backup_jobs WHERE id = ?').run(jobId);
  }).immediate();
  refreshBackupSchedules();
  return { removed: true, backupsKept: true };
}

export function readBackupDashboard() {
  const now = new Date();
  // The dashboard polls frequently, so resolve every job's latest run in one query
  // instead of issuing a separate lookup for each configured job. The migration-backed
  // job/created index lets the correlated lookup seek directly through each job's history.
  const latestRunsByJob = new Map();
  const latestRuns = db.prepare(`SELECT candidate.* FROM backup_runs AS candidate
    WHERE NOT EXISTS (
      SELECT 1 FROM backup_runs AS newer
      WHERE newer.job_id = candidate.job_id
        AND (newer.created_at > candidate.created_at
          OR (newer.created_at = candidate.created_at AND newer.id > candidate.id))
    )`).all();
  for (const run of latestRuns) latestRunsByJob.set(run.job_id, run);
  const jobs = db.prepare('SELECT * FROM backup_jobs ORDER BY created_at, name COLLATE NOCASE').all().map((row) => {
    const job = jobFromRow(row);
    const lastRun = latestRunsByJob.get(job.id);
    return { ...job, nextRunAt: job.enabled ? (nextRunByJob.get(job.id) || nextBackupAt(job, now)).toISOString() : null,
      lastRun: lastRun ? runFromRow(lastRun) : null };
  });
  const runs = db.prepare('SELECT * FROM backup_runs ORDER BY created_at DESC, id DESC LIMIT ?').all(recentRunLimit).map(runFromRow);
  return { jobs, runs, backupInProgress: isBackupInProgress(), mediaWritesPaused, defaultDestinationPath: backupPathDefault };
}

function completeMutation() {
  activeMutations = Math.max(0, activeMutations - 1);
  if (activeMutations === 0) {
    const waiters = mutationWaiters;
    mutationWaiters = [];
    waiters.forEach((resolve) => resolve());
  }
}

export function backupWriteGate(req, res, next) {
  const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  const isBackupControl = req.path.startsWith('/api/admin/backups');
  if (!isMutation || isBackupControl) return next();
  if (mediaWritesPaused) {
    return res.status(503).json({ error: 'Course changes are temporarily paused while a media backup is created.', code: 'backup_in_progress' });
  }
  activeMutations += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    completeMutation();
  };
  res.once('finish', release);
  res.once('close', release);
  return next();
}

function waitForActiveMutations() {
  if (activeMutations === 0) return Promise.resolve();
  return new Promise((resolve) => mutationWaiters.push(resolve));
}

function waitForQueueToFinish() {
  if (!workerRunning && queuedRuns.length === 0) return Promise.resolve();
  return new Promise((resolve) => idleWaiters.push(resolve));
}

function resolveQueueIdle() {
  if (workerRunning || queuedRuns.length) return;
  const waiters = idleWaiters;
  idleWaiters = [];
  waiters.forEach((resolve) => resolve());
}

export function isBackupInProgress() {
  return Boolean(activeRunId || queuedRuns.length || workerRunning);
}

function runIsActive(jobId) {
  return Boolean(db.prepare("SELECT 1 FROM backup_runs WHERE job_id = ? AND status IN ('pending', 'running') LIMIT 1").get(jobId));
}

function enqueueRun(job, { triggerType, triggeredBy = null, scheduledFor = null }) {
  if (runIsActive(job.id) || queuedJobIds.has(job.id)) return null;
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO backup_runs (id, job_id, job_name, scope, destination_path, trigger_type,
    triggered_by, status, scheduled_for, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
    .run(id, job.id, job.name, job.scope, job.destinationPath, triggerType, triggeredBy, scheduledFor, now);
  queuedRuns.push({ id, job, triggerType });
  queuedJobIds.add(job.id);
  void processBackupQueue();
  return runFromRow(db.prepare('SELECT * FROM backup_runs WHERE id = ?').get(id));
}

export function runBackupNow(jobId, actor) {
  const row = db.prepare('SELECT * FROM backup_jobs WHERE id = ?').get(jobId);
  if (!row) fail(404, 'Backup job not found.', 'not_found');
  const job = jobFromRow(row);
  if (runIsActive(job.id) || queuedJobIds.has(job.id)) fail(409, 'This backup job already has a queued or active run.', 'backup_job_active');
  const runId = randomUUID();
  const now = new Date().toISOString();
  const run = db.transaction(() => {
    db.prepare(`INSERT INTO backup_runs (id, job_id, job_name, scope, destination_path, trigger_type,
      triggered_by, status, created_at) VALUES (?, ?, ?, ?, ?, 'manual', ?, 'pending', ?)`)
      .run(runId, job.id, job.name, job.scope, job.destinationPath, actor.username, now);
    const auditId = writeAuditLog({ actor, action: 'backup.run_requested', entityType: 'backup_job', entityId: job.id,
      summary: `Started a manual backup: ${job.name}`, details: { jobName: job.name, scope: job.scope, runId } });
    if (!auditId) fail(500, 'The backup could not start because the audit log is unavailable.', 'audit_unavailable');
    return runFromRow(db.prepare('SELECT * FROM backup_runs WHERE id = ?').get(runId));
  }).immediate();
  queuedRuns.push({ id: runId, job, triggerType: 'manual' });
  queuedJobIds.add(job.id);
  void processBackupQueue();
  return run;
}

function readErrorMessage(error) {
  return String(error?.message || error || 'Backup failed.').slice(0, 500);
}

async function removeExpiredArtifacts(job) {
  const oldRuns = db.prepare(`SELECT * FROM backup_runs WHERE job_id = ? AND status = 'success' AND artifact_deleted_at IS NULL
    ORDER BY finished_at DESC, created_at DESC LIMIT -1 OFFSET ?`).all(job.id, job.retentionCount);
  for (const row of oldRuns) {
    try {
      const backupDirectory = await fs.realpath(row.backup_path);
      const destination = await fs.realpath(row.destination_path);
      if (path.dirname(backupDirectory) !== destination) throw new Error('The old backup location is outside its configured destination.');
      const manifest = JSON.parse(await fs.readFile(path.join(backupDirectory, 'manifest.json'), 'utf8'));
      if (manifest.jobId !== job.id || manifest.runId !== row.id) throw new Error('Backup manifest does not match the run being expired.');
      await fs.rm(backupDirectory, { recursive: true, force: false });
      db.prepare('UPDATE backup_runs SET artifact_deleted_at = ? WHERE id = ?').run(new Date().toISOString(), row.id);
    } catch (error) {
      writeSystemLog('warn', 'backup', 'Backup retention could not remove an expired artifact', {
        jobId: job.id, runId: row.id, errorName: String(error?.name || 'Error').slice(0, 100), errorCode: typeof error?.code === 'string' ? error.code.slice(0, 100) : undefined,
      });
    }
  }
}

async function processBackupQueue() {
  if (workerRunning || (shouldDeferScheduledRun() && queuedRuns[0]?.triggerType === 'scheduled')) return;
  workerRunning = true;
  try {
    while (queuedRuns.length) {
      const item = queuedRuns[0];
      if (shouldDeferScheduledRun() && item.triggerType === 'scheduled') break;
      queuedRuns.shift();
      queuedJobIds.delete(item.job.id);
      activeRunId = item.id;
      const startedAt = new Date().toISOString();
      const pausesWrites = item.job.scope !== 'database';
      try {
        db.prepare("UPDATE backup_runs SET status = 'running', started_at = ? WHERE id = ? AND status = 'pending'").run(startedAt, item.id);
        if (pausesWrites) {
          mediaWritesPaused = true;
          await waitForActiveMutations();
        }
        const backupPath = await createBackup({ scope: item.job.scope, jobId: item.job.id, runId: item.id,
          destinationRoot: item.job.destinationPath });
        const finishedAt = new Date().toISOString();
        db.prepare("UPDATE backup_runs SET status = 'success', finished_at = ?, backup_path = ?, error_message = NULL WHERE id = ?")
          .run(finishedAt, backupPath, item.id);
        writeSystemLog('info', 'backup', 'Backup completed and verified', {
          jobId: item.job.id, runId: item.id, scope: item.job.scope, triggerType: item.triggerType, backupPath,
        });
        await removeExpiredArtifacts(item.job);
      } catch (error) {
        const message = readErrorMessage(error);
        try {
          db.prepare("UPDATE backup_runs SET status = 'failed', finished_at = ?, error_message = ? WHERE id = ?")
            .run(new Date().toISOString(), message, item.id);
        } catch (recordError) {
          writeSystemLog('error', 'backup', 'The failed backup result could not be recorded', {
            jobId: item.job.id, runId: item.id, errorName: String(recordError?.name || 'Error').slice(0, 100),
          });
        }
        writeSystemLog('error', 'backup', 'Backup failed', {
          jobId: item.job.id, runId: item.id, scope: item.job.scope, triggerType: item.triggerType,
          errorName: String(error?.name || 'Error').slice(0, 100), errorCode: typeof error?.code === 'string' ? error.code.slice(0, 100) : undefined,
          message,
        });
      } finally {
        mediaWritesPaused = false;
        activeRunId = null;
      }
    }
  } finally {
    workerRunning = false;
    resolveQueueIdle();
  }
}

function refreshBackupSchedules(now = new Date()) {
  const jobs = db.prepare('SELECT * FROM backup_jobs WHERE enabled = 1').all().map(jobFromRow);
  const activeIds = new Set(jobs.map((job) => job.id));
  for (const id of nextRunByJob.keys()) if (!activeIds.has(id)) nextRunByJob.delete(id);
  for (const job of jobs) {
    const current = nextRunByJob.get(job.id);
    if (!current) nextRunByJob.set(job.id, nextBackupAt(job, now));
  }
  return jobs;
}

async function tickBackupScheduler() {
  if (shouldDeferScheduledRun()) return;
  const now = new Date();
  const jobs = refreshBackupSchedules(now);
  for (const job of jobs) {
    const nextRunAt = nextRunByJob.get(job.id);
    if (nextRunAt && nextRunAt <= now) {
      nextRunByJob.set(job.id, nextBackupAt(job, now));
      const run = enqueueRun(job, { triggerType: 'scheduled', scheduledFor: nextRunAt.toISOString() });
      if (run) writeSystemLog('info', 'backup', 'Scheduled backup queued', { jobId: job.id, runId: run.id, scope: job.scope, scheduledFor: nextRunAt.toISOString() });
    }
  }
}

export function refreshBackupSchedulesNow() {
  nextRunByJob = new Map();
  refreshBackupSchedules();
}

export function startBackupScheduler({ shouldDefer = () => false } = {}) {
  if (scheduleTimer) return;
  shouldDeferScheduledRun = shouldDefer;
  const staleRuns = db.prepare("SELECT id, job_id FROM backup_runs WHERE status IN ('pending', 'running')").all();
  if (staleRuns.length) {
    const now = new Date().toISOString();
    db.prepare("UPDATE backup_runs SET status = 'failed', finished_at = ?, error_message = 'The server stopped before this backup completed.' WHERE status IN ('pending', 'running')").run(now);
    writeSystemLog('warn', 'backup', 'Unfinished backup runs were marked failed after server restart', { runIds: staleRuns.map((run) => run.id), jobIds: [...new Set(staleRuns.map((run) => run.job_id))] });
  }
  nextRunByJob = new Map();
  refreshBackupSchedules();
  scheduleTimer = setInterval(() => { void tickBackupScheduler(); }, scheduleTickMs);
  scheduleTimer.unref?.();
}

export async function stopBackupScheduler() {
  if (scheduleTimer) clearInterval(scheduleTimer);
  scheduleTimer = null;
  const queued = queuedRuns;
  queuedRuns = [];
  queuedJobIds.clear();
  if (queued.length) {
    const now = new Date().toISOString();
    const update = db.prepare("UPDATE backup_runs SET status = 'failed', finished_at = ?, error_message = 'The server shut down before this backup started.' WHERE id = ? AND status = 'pending'");
    const transaction = db.transaction((items) => items.forEach((item) => update.run(now, item.id)));
    transaction(queued);
  }
  if (activeRunId || workerRunning) await waitForQueueToFinish();
  nextRunByJob.clear();
  resolveQueueIdle();
}

export function waitForBackupSchedulerIdle() {
  return waitForQueueToFinish();
}
