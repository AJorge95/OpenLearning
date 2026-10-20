import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { NavLink, useBeforeUnload, useBlocker } from 'react-router-dom';
import type { BlockerFunction } from 'react-router-dom';
import { Check, Database, HardDrive, Pencil, Play, Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { api, ApiError } from './api';
import { Button, ConfirmationDialog, PageHeading } from './components';
import { formatApiTimestamp } from './format-api-timestamp';
import type { BackupFrequency, BackupJob, BackupRun, BackupScope } from './types';

type Dashboard = { jobs: BackupJob[]; runs: BackupRun[]; backupInProgress: boolean; mediaWritesPaused: boolean; defaultDestinationPath: string };
type JobInput = Pick<BackupJob, 'name' | 'scope' | 'frequency' | 'weekday' | 'runTimeUtc' | 'destinationPath' | 'retentionCount' | 'enabled'>;
type RestoreResult = { runId: string; backupPath: string; preRestoreBackup: string; sessionsCleared: boolean; cleanupPending: boolean };
type RestorableRunsResponse = { runs: BackupRun[] };

const weekdays = [
  { value: 1, label: 'Monday' }, { value: 2, label: 'Tuesday' }, { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' }, { value: 5, label: 'Friday' }, { value: 6, label: 'Saturday' }, { value: 0, label: 'Sunday' },
];
const scheduleDateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
const timestampFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const scopeLabels: Record<BackupScope, string> = { full: 'Database and media', database: 'Database only', media: 'Course media only' };

function defaultJob(destinationPath: string): JobInput {
  return { name: '', scope: 'full', frequency: 'daily', weekday: null, runTimeUtc: '02:00', destinationPath, retentionCount: 14, enabled: true };
}

function isJobInputDirty(value: JobInput, baseline: JobInput) {
  return (Object.keys(baseline) as Array<keyof JobInput>).some((key) => value[key] !== baseline[key]);
}

function formatTimestamp(value: string | null | undefined, utc = false) {
  if (!value) return '—';
  // Backup run rows can contain SQLite UTC values without an explicit timezone marker.
  const formatted = formatApiTimestamp(value, utc ? scheduleDateFormatter : timestampFormatter);
  return `${formatted}${formatted === '—' || !utc ? '' : ' UTC'}`;
}

function BackupNotice({ children, kind = 'error' }: { children: ReactNode; kind?: 'error' | 'success' }) {
  return <p className={`backup-notice backup-notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'} aria-live={kind === 'error' ? 'assertive' : 'polite'}>{children}</p>;
}

function BackupSettingsTabs() {
  return <nav className="settings-tabs" aria-label="Settings sections">
    <NavLink to="/admin/settings" end className={({ isActive }) => isActive ? 'settings-tab active' : 'settings-tab'}>Platform</NavLink>
    <NavLink to="/admin/settings/registration-fields" className={({ isActive }) => isActive ? 'settings-tab active' : 'settings-tab'}>Registration fields</NavLink>
    <NavLink to="/admin/settings/backups" className={({ isActive }) => isActive ? 'settings-tab active' : 'settings-tab'}>Backups</NavLink>
  </nav>;
}

function runStatusLabel(run: BackupRun | null) {
  if (!run) return 'No backup yet';
  if (run.artifactDeletedAt) return 'Expired by retention';
  return run.status === 'success' ? 'Verified' : run.status === 'failed' ? 'Failed' : run.status === 'running' ? 'Running' : 'Queued';
}

function JobEditor({ job, defaultDestinationPath, saving, onCancel, onSave, onDirtyChange }: {
  job: JobInput;
  defaultDestinationPath: string;
  saving: boolean;
  onCancel: () => void;
  onSave: (value: JobInput) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [value, setValue] = useState<JobInput>(() => ({ ...job, destinationPath: job.destinationPath || defaultDestinationPath }));
  const initialValueRef = useRef(value);
  const nameId = 'backup-job-name';
  const scopeId = 'backup-job-scope';
  const frequencyId = 'backup-job-frequency';
  const weekdayId = 'backup-job-weekday';
  const timeId = 'backup-job-time';
  const destinationId = 'backup-job-destination';
  const retentionId = 'backup-job-retention';
  useEffect(() => {
    onDirtyChange(isJobInputDirty(value, initialValueRef.current));
  }, [value, onDirtyChange]);
  return <form className="backup-job-form" onSubmit={(event) => { event.preventDefault(); onSave(value); }} aria-busy={saving}>
    <div className="backup-card-heading"><div><h2>{job.name ? 'Edit backup job' : 'New backup job'}</h2><p>Run times use UTC. Destinations must be existing writable folders on the server.</p></div></div>
    <div className="backup-form-grid">
      {/* Keep visible required cues aligned with the native constraints and server validation. */}
      <label htmlFor={nameId}><span className="form-label-row"><span>Job name</span><small className="form-required-indicator" aria-hidden="true">Required</small></span><input id={nameId} required maxLength={80} value={value.name} onChange={(event) => setValue((current) => ({ ...current, name: event.target.value }))} /></label>
      <label htmlFor={scopeId}>Backup contents<select id={scopeId} value={value.scope} onChange={(event) => setValue((current) => ({ ...current, scope: event.target.value as BackupScope }))}>
        <option value="full">Full — database and course media</option><option value="database">Partial — database only</option><option value="media">Partial — course media only</option>
      </select></label>
      <label htmlFor={frequencyId}>Schedule<select id={frequencyId} value={value.frequency} onChange={(event) => setValue((current) => ({ ...current, frequency: event.target.value as BackupFrequency, weekday: event.target.value === 'weekly' ? current.weekday ?? 1 : null }))}>
        <option value="daily">Daily</option><option value="weekly">Weekly</option>
      </select></label>
      {value.frequency === 'weekly' && <label htmlFor={weekdayId}>Day of week<select id={weekdayId} value={value.weekday ?? 1} onChange={(event) => setValue((current) => ({ ...current, weekday: Number(event.target.value) }))}>
        {weekdays.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}
      </select></label>}
      <label htmlFor={timeId}><span className="form-label-row"><span>Run time (UTC)</span><small className="form-required-indicator" aria-hidden="true">Required</small></span><input id={timeId} type="time" required value={value.runTimeUtc} onChange={(event) => setValue((current) => ({ ...current, runTimeUtc: event.target.value }))} /></label>
      <label htmlFor={retentionId}><span className="form-label-row"><span>Keep successful backups</span><small className="form-required-indicator" aria-hidden="true">Required</small></span><input id={retentionId} type="number" min={1} max={365} step={1} required value={value.retentionCount} onChange={(event) => setValue((current) => ({ ...current, retentionCount: Number(event.target.value) }))} /><small>Older verified backups for this job are removed after a newer backup succeeds.</small></label>
      <label className="backup-destination-field" htmlFor={destinationId}><span className="form-label-row"><span>Server destination folder</span><small className="form-required-indicator" aria-hidden="true">Required</small></span><input id={destinationId} required maxLength={1024} value={value.destinationPath} placeholder={defaultDestinationPath} autoComplete="off" spellCheck={false} onChange={(event) => setValue((current) => ({ ...current, destinationPath: event.target.value }))} /><small>Use an absolute path on the server. Mount any external or network storage before configuring it.</small></label>
      <label className="backup-enabled-toggle"><input type="checkbox" checked={value.enabled} onChange={(event) => setValue((current) => ({ ...current, enabled: event.target.checked }))} /><span><strong>Enable this schedule</strong><small>Disabled jobs keep their history and backup files.</small></span></label>
    </div>
    <div className="backup-form-actions"><Button type="submit" disabled={saving}>{saving ? 'Saving…' : job.name ? 'Save changes' : 'Create backup job'}</Button><Button variant="secondary" type="button" disabled={saving} onClick={onCancel}>Cancel</Button></div>
  </form>;
}

export function AdminBackupsPage() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [restorableRuns, setRestorableRuns] = useState<BackupRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [editor, setEditor] = useState<{ id: string | null; value: JobInput } | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [pendingEditorDiscard, setPendingEditorDiscard] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BackupJob | null>(null);
  const [pendingRestore, setPendingRestore] = useState<BackupRun | null>(null);
  const [restoringRunId, setRestoringRunId] = useState<string | null>(null);
  const requestActiveRef = useRef(false);
  const restoreActiveRef = useRef(false);
  const backupJobsHeadingRef = useRef<HTMLHeadingElement>(null);
  const hasUnsavedChanges = Boolean(editor && editorDirty);
  const shouldBlockNavigation = useCallback<BlockerFunction>(({ currentLocation, nextLocation }) => {
    const locationChanged = currentLocation.pathname !== nextLocation.pathname
      || currentLocation.search !== nextLocation.search
      || currentLocation.hash !== nextLocation.hash;
    return locationChanged && (hasUnsavedChanges || saving);
  }, [hasUnsavedChanges, saving]);
  const navigationBlocker = useBlocker(shouldBlockNavigation);
  const preventUnsavedBackupJobExit = useCallback((event: BeforeUnloadEvent) => {
    if (!hasUnsavedChanges && !saving) return;
    event.preventDefault();
    event.returnValue = '';
  }, [hasUnsavedChanges, saving]);
  useBeforeUnload(preventUnsavedBackupJobExit);
  useEffect(() => {
    // After a successful save clears the draft, continue any navigation already requested.
    if (navigationBlocker.state === 'blocked' && !hasUnsavedChanges && !saving) navigationBlocker.proceed();
  }, [navigationBlocker, hasUnsavedChanges, saving]);
  // Polling and action-triggered refreshes can overlap; only the newest response may replace the dashboard.
  const dashboardRevisionRef = useRef(0);
  const dashboardMountedRef = useRef(false);

  useEffect(() => {
    let active = true;
    dashboardMountedRef.current = true;
    const controllers = new Set<AbortController>();
    const isVisible = () => document.visibilityState === 'visible';
    const load = async () => {
      // A hidden settings tab cannot show a fresh result; resume with one read when it returns.
      if (!active || !isVisible()) return;
      if (restoreActiveRef.current) return;
      if (requestActiveRef.current) return;
      requestActiveRef.current = true;
      const requestRevision = dashboardRevisionRef.current + 1;
      dashboardRevisionRef.current = requestRevision;
      const controller = new AbortController();
      controllers.add(controller);
      try {
        const [result, restorePoints] = await Promise.all([
          api.get<Dashboard>('/api/admin/backups', { signal: controller.signal }),
          api.get<RestorableRunsResponse>('/api/admin/backups/restorable-runs', { signal: controller.signal }),
        ]);
        if (active && requestRevision === dashboardRevisionRef.current) {
          setDashboard(result); setRestorableRuns(restorePoints.runs); setError(''); setLoading(false);
        }
      } catch (cause) {
        if (active && requestRevision === dashboardRevisionRef.current && !(cause instanceof Error && cause.name === 'AbortError')) {
          setError(cause instanceof ApiError ? cause.message : 'Backup status could not be loaded.');
          setLoading(false);
        }
      } finally {
        requestActiveRef.current = false;
        controllers.delete(controller);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    const refreshOnVisible = () => { if (isVisible()) void load(); };
    document.addEventListener('visibilitychange', refreshOnVisible);
    return () => {
      active = false;
      dashboardMountedRef.current = false;
      // Invalidate action-triggered refreshes too; they are not part of the polling controller set.
      dashboardRevisionRef.current += 1;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshOnVisible);
      controllers.forEach((controller) => controller.abort());
    };
  }, []);

  async function reload() {
    const requestRevision = dashboardRevisionRef.current + 1;
    dashboardRevisionRef.current = requestRevision;
    try {
      const [result, restorePoints] = await Promise.all([
        api.get<Dashboard>('/api/admin/backups'),
        api.get<RestorableRunsResponse>('/api/admin/backups/restorable-runs'),
      ]);
      if (!dashboardMountedRef.current || requestRevision !== dashboardRevisionRef.current) return;
      setDashboard(result);
      setRestorableRuns(restorePoints.runs);
      setError('');
    } catch (cause) {
      if (!dashboardMountedRef.current || requestRevision !== dashboardRevisionRef.current) return;
      setError(cause instanceof ApiError ? cause.message : 'Backup status could not be refreshed.');
    }
  }

  async function save(value: JobInput) {
    setSaving(true); setError(''); setSuccess('');
    try {
      if (editor?.id) await api.put(`/api/admin/backups/jobs/${encodeURIComponent(editor.id)}`, value);
      else await api.post('/api/admin/backups/jobs', value);
      setEditor(null); setEditorDirty(false); setSuccess(editor?.id ? 'Backup job updated.' : 'Backup job created.'); await reload();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Backup job could not be saved.');
    } finally { setSaving(false); }
  }

  function cancelEditor() {
    if (editorDirty) {
      setPendingEditorDiscard(true);
      return;
    }
    setEditor(null);
    setEditorDirty(false);
  }

  function discardEditorDraft() {
    setPendingEditorDiscard(false);
    setEditor(null);
    setEditorDirty(false);
    // The discard removes its invoking Cancel button, so return focus to the section heading.
    window.requestAnimationFrame(() => backupJobsHeadingRef.current?.focus());
  }

  async function runNow(job: BackupJob) {
    setBusyId(job.id); setError(''); setSuccess('');
    try {
      await api.post(`/api/admin/backups/jobs/${encodeURIComponent(job.id)}/run`);
      setSuccess(`Backup queued for “${job.name}”.`); await reload();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The backup could not be queued.');
    } finally { setBusyId(null); }
  }

  async function toggleEnabled(job: BackupJob) {
    setBusyId(job.id); setError(''); setSuccess('');
    try {
      await api.put(`/api/admin/backups/jobs/${encodeURIComponent(job.id)}`, { ...job, enabled: !job.enabled });
      setSuccess(`Backup job ${job.enabled ? 'paused' : 'enabled'}.`); await reload();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Backup job could not be updated.');
    } finally { setBusyId(null); }
  }

  async function removeJob() {
    if (!pendingDelete) return;
    setBusyId(pendingDelete.id); setError(''); setSuccess('');
    try {
      await api.delete(`/api/admin/backups/jobs/${encodeURIComponent(pendingDelete.id)}`);
      setSuccess('Schedule removed. Existing backup files and run history were kept.'); setPendingDelete(null); await reload();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Backup job could not be removed.');
      setPendingDelete(null);
    } finally { setBusyId(null); }
  }

  async function restoreRun() {
    if (!pendingRestore) return;
    const selectedRun = pendingRestore;
    restoreActiveRef.current = true;
    setPendingRestore(null);
    setPendingDelete(null);
    setEditor(null);
    setRestoringRunId(selectedRun.id);
    setError(''); setSuccess('');
    try {
      const result = await api.post<RestoreResult>('/api/admin/backups/restore', { runId: selectedRun.id });
      setSuccess(`Restored “${selectedRun.jobName}”. The current installation was saved to ${result.preRestoreBackup}.${result.cleanupPending ? ' Temporary recovery files remain and will be cleaned up at the next restart.' : ''} You will be signed out; reloading to sign in with an account from this backup.`);
      window.setTimeout(() => window.location.reload(), 3000);
    } catch (cause) {
      restoreActiveRef.current = false;
      setError(cause instanceof ApiError ? cause.message : 'The selected backup could not be restored.');
      await reload();
    } finally {
      setRestoringRunId(null);
    }
  }

  const dashboardDefaultPath = dashboard?.defaultDestinationPath || '';
  const isRunning = dashboard?.backupInProgress ?? false;
  const restoreBusy = Boolean(restoringRunId) || restoreActiveRef.current;
  // An unavailable dashboard is not an empty configuration; keep the recovery notice authoritative.
  const dashboardLoaded = dashboard !== null;
  return <div className="management-page settings-page backup-settings-page">
    <PageHeading title="Settings" subtitle="Configure and monitor automatic backups." />
    <BackupSettingsTabs />
    {error && <BackupNotice>{error}</BackupNotice>}
    {success && <BackupNotice kind="success">{success}</BackupNotice>}
    {isRunning && <div className="backup-running-banner" role="status" aria-live="polite"><RefreshCw size={16} aria-hidden="true" /><span>{dashboard?.mediaWritesPaused ? 'A media backup is running. Changes and uploads that affect course media are temporarily paused; learners can continue viewing courses.' : 'A database backup is running or a backup job is queued.'}</span></div>}
    {restoringRunId && <div className="backup-running-banner" role="status" aria-live="polite"><RefreshCw size={16} aria-hidden="true" /><span>Restoring the selected full backup. OpenLearning is temporarily unavailable to users while the database and course media are validated and replaced.</span></div>}
     <section className="backup-section" aria-labelledby="backup-jobs-heading">
       <div className="backup-section-heading"><div><h2 ref={backupJobsHeadingRef} id="backup-jobs-heading" tabIndex={-1}>Backup jobs</h2><p>Create independent schedules for the database, course media, or both.</p></div><Button type="button" onClick={() => { setError(''); setSuccess(''); setEditorDirty(false); setEditor({ id: null, value: defaultJob(dashboardDefaultPath) }); }} disabled={loading || Boolean(editor) || restoreBusy}><Plus size={16} aria-hidden="true" />New job</Button></div>
       {editor && <JobEditor key={editor.id || 'new'} job={editor.value} defaultDestinationPath={dashboardDefaultPath} saving={saving} onCancel={cancelEditor} onSave={(value) => void save(value)} onDirtyChange={setEditorDirty} />}
      {loading && !dashboard ? <div className="backup-empty-state" role="status">Loading backup jobs…</div>
        : dashboard?.jobs.length
          ? <div className="backup-job-grid">{dashboard.jobs.map((job) => <article className={`backup-job-card${job.enabled ? '' : ' backup-job-disabled'}`} key={job.id}>
            <div className="backup-job-title"><span className="backup-job-icon" aria-hidden="true">{job.scope === 'database' ? <Database size={18} /> : job.scope === 'media' ? <HardDrive size={18} /> : <Check size={18} />}</span><div><h3>{job.name}</h3><span className={`backup-job-state ${job.enabled ? 'is-enabled' : 'is-disabled'}`}>{job.enabled ? 'Enabled' : 'Paused'}</span></div></div>
            <dl className="backup-job-details">
              <div><dt>Contents</dt><dd>{scopeLabels[job.scope]}</dd></div>
              <div><dt>Schedule</dt><dd>{job.frequency === 'daily' ? 'Daily' : `Every ${weekdays.find((day) => day.value === job.weekday)?.label || 'week'}`} at {job.runTimeUtc} UTC</dd></div>
              <div><dt>Next run</dt><dd>{job.enabled ? formatTimestamp(job.nextRunAt, true) : 'Paused'}</dd></div>
              <div><dt>Last run</dt><dd>{runStatusLabel(job.lastRun)}{job.lastRun?.finishedAt ? ` · ${formatTimestamp(job.lastRun.finishedAt)}` : ''}</dd></div>
              <div className="backup-job-path"><dt>Destination</dt><dd><code>{job.destinationPath}</code></dd></div>
              <div><dt>Retention</dt><dd>Keep {job.retentionCount} successful backups</dd></div>
            </dl>
            <div className="backup-job-actions">
              <Button type="button" variant="secondary" disabled={busyId === job.id || restoreBusy || Boolean(editor)} onClick={() => void runNow(job)}><Play size={15} aria-hidden="true" />{busyId === job.id ? 'Queuing…' : 'Run now'}</Button>
              <button type="button" className="text-action" disabled={Boolean(editor) || busyId === job.id || restoreBusy} onClick={() => { setError(''); setSuccess(''); setEditorDirty(false); setEditor({ id: job.id, value: { name: job.name, scope: job.scope, frequency: job.frequency, weekday: job.weekday, runTimeUtc: job.runTimeUtc, destinationPath: job.destinationPath, retentionCount: job.retentionCount, enabled: job.enabled } }); }}><Pencil size={14} aria-hidden="true" />Edit</button>
              <button type="button" className="text-action" disabled={Boolean(editor) || busyId === job.id || restoreBusy} onClick={() => void toggleEnabled(job)}>{job.enabled ? 'Pause' : 'Enable'}</button>
              <button type="button" className="text-action danger-text" disabled={Boolean(editor) || busyId === job.id || restoreBusy} onClick={() => setPendingDelete(job)}><Trash2 size={14} aria-hidden="true" />Remove</button>
            </div>
          </article>)}</div>
          : dashboardLoaded && !editor && <div className="backup-empty-state"><strong>No backup jobs configured</strong><span>Add a job to schedule a database backup, course-media backup, or full backup.</span></div>}
    </section>
    <section className="backup-section" aria-labelledby="backup-restore-points-heading">
      <div className="backup-section-heading"><div><h2 id="backup-restore-points-heading">Restore from a full backup</h2><p>Choose any retained, verified full backup. Restoring creates a verified backup of the current installation first.</p></div></div>
      {restorableRuns.length ? <div className="backup-history-wrap" role="region" aria-label="Available full backup restore points" tabIndex={0}><p className="table-scroll-hint">Scroll horizontally to see all restore point columns.</p><table className="backup-history-table"><caption className="sr-only">Available full backup restore points</caption><thead><tr><th scope="col">Backup time</th><th scope="col">Job</th><th scope="col">Backup location</th><th scope="col">Action</th></tr></thead><tbody>{restorableRuns.map((run) => <tr key={run.id}>
        <td>{formatTimestamp(run.finishedAt || run.createdAt)}</td><th scope="row">{run.jobName}</th><td className="backup-history-detail"><code>{run.backupPath}</code></td><td>
          {/* Name each restore action with its backup so button navigation distinguishes the restore point. */}
           <button type="button" className="text-action" aria-label={`Restore full backup from ${run.jobName}, completed ${formatTimestamp(run.finishedAt || run.createdAt)}`} disabled={restoreBusy || isRunning || Boolean(editor)} onClick={() => { setError(''); setSuccess(''); setPendingRestore(run); }}><RotateCcw size={14} aria-hidden="true" />Restore</button>
        </td>
      </tr>)}</tbody></table></div> : dashboardLoaded && <div className="backup-empty-state">No retained full backups are available to restore. Database-only and course-media-only backups cannot restore the whole platform.</div>}
    </section>
    <section className="backup-section" aria-labelledby="backup-history-heading">
      <div className="backup-section-heading"><div><h2 id="backup-history-heading">Recent backup runs</h2><p>The latest 50 scheduled and manually started runs.</p></div><Button type="button" variant="secondary" onClick={() => void reload()} disabled={loading || restoreBusy}><RefreshCw size={15} aria-hidden="true" />Refresh</Button></div>
      {dashboard?.runs.length ? <div className="backup-history-wrap" role="region" aria-label="Scrollable backup run history" tabIndex={0}><p className="table-scroll-hint">Scroll horizontally to see all backup run columns.</p><table className="backup-history-table"><caption className="sr-only">Recent backup run history</caption><thead><tr><th scope="col">Started</th><th scope="col">Job</th><th scope="col">Contents</th><th scope="col">Trigger</th><th scope="col">Status</th><th scope="col">Backup location or details</th></tr></thead><tbody>{dashboard.runs.map((run) => <tr key={run.id}>
        <td>{formatTimestamp(run.startedAt || run.createdAt)}</td><th scope="row">{run.jobName}</th><td>{scopeLabels[run.scope]}</td><td>{run.triggerType === 'scheduled' ? 'Scheduled' : `Manual${run.triggeredBy ? ` by ${run.triggeredBy}` : ''}`}</td><td><span className={`backup-run-status backup-run-${run.status}`}>{runStatusLabel(run)}</span></td><td className="backup-history-detail">{run.errorMessage ? <span className="backup-run-error">{run.errorMessage}</span> : run.artifactDeletedAt ? <span>Removed by retention on {formatTimestamp(run.artifactDeletedAt)}</span> : run.backupPath ? <code>{run.backupPath}</code> : '—'}</td>
      </tr>)}</tbody></table></div> : dashboardLoaded && <div className="backup-empty-state">No backup runs yet. Scheduled runs and “Run now” requests will appear here.</div>}
      <p className="backup-safety-note">Media backups briefly pause changes and uploads while files are copied. Learners can continue viewing courses. Restoring temporarily makes OpenLearning unavailable while it replaces the database and course media. It creates a verified backup of the current installation first and clears all sessions. Sign in again with an account and password from the restored backup. A server restart does not trigger missed schedules; the next run waits for its normal time. Removing a job does not delete its existing backup files.</p>
    </section>
     {navigationBlocker.state === 'blocked' && <ConfirmationDialog
       title={saving ? 'Backup schedule save in progress' : 'Discard unsaved backup schedule?'}
       description={saving ? 'Wait for the backup schedule save to finish before leaving this page.' : 'Your unsaved backup schedule changes will be lost if you leave this page.'}
       cancelLabel={saving ? 'Stay on page' : 'Keep editing'}
       confirmLabel={saving ? 'Saving…' : 'Discard changes'}
       confirmVariant={saving ? 'secondary' : 'danger'}
       confirmDisabled={saving}
       onCancel={navigationBlocker.reset}
       onConfirm={navigationBlocker.proceed}
     />}
     {pendingEditorDiscard && <ConfirmationDialog title="Discard unsaved backup schedule?" description="Your unsaved backup schedule changes will be lost." confirmLabel="Discard changes" onCancel={() => setPendingEditorDiscard(false)} onConfirm={discardEditorDraft} />}
     {pendingDelete && <ConfirmationDialog title={`Remove “${pendingDelete.name}”?`} description="This removes the schedule only. Existing backup files and run history will be kept." confirmLabel="Remove schedule" confirmDisabled={busyId === pendingDelete.id} onCancel={() => setPendingDelete(null)} onConfirm={() => void removeJob()} />}
    {pendingRestore && <ConfirmationDialog title={`Restore “${pendingRestore.jobName}”?`} description={`This temporarily makes OpenLearning unavailable and replaces its database and all course media with the verified full backup from ${formatTimestamp(pendingRestore.startedAt || pendingRestore.createdAt)}. A verified backup of the current installation will be created first. All sessions will be cleared, and you will need to sign in with credentials from the selected backup.`} confirmLabel="Restore full backup" confirmVariant="danger" confirmDisabled={restoreBusy} onCancel={() => setPendingRestore(null)} onConfirm={() => void restoreRun()} />}
  </div>;
}
