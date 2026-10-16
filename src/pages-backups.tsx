import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { Check, Database, HardDrive, Pencil, Play, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { api, ApiError } from './api';
import { Button, ConfirmationDialog, PageHeading } from './components';
import { formatApiTimestamp } from './format-api-timestamp';
import type { BackupFrequency, BackupJob, BackupRun, BackupScope } from './types';

type Dashboard = { jobs: BackupJob[]; runs: BackupRun[]; backupInProgress: boolean; mediaWritesPaused: boolean; defaultDestinationPath: string };
type JobInput = Pick<BackupJob, 'name' | 'scope' | 'frequency' | 'weekday' | 'runTimeUtc' | 'destinationPath' | 'retentionCount' | 'enabled'>;

const weekdays = [
  { value: 1, label: 'Monday' }, { value: 2, label: 'Tuesday' }, { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' }, { value: 5, label: 'Friday' }, { value: 6, label: 'Saturday' }, { value: 0, label: 'Sunday' },
];
const scheduleDateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
const timestampFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const scopeLabels: Record<BackupScope, string> = { full: 'Database and media', database: 'Database only', media: 'Course media only' };

function defaultJob(destinationPath: string): JobInput {
  return { name: '', scope: 'full', frequency: 'daily', weekday: 1, runTimeUtc: '02:00', destinationPath, retentionCount: 14, enabled: true };
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

function JobEditor({ job, defaultDestinationPath, saving, onCancel, onSave }: {
  job: JobInput;
  defaultDestinationPath: string;
  saving: boolean;
  onCancel: () => void;
  onSave: (value: JobInput) => void;
}) {
  const [value, setValue] = useState<JobInput>({ ...job, destinationPath: job.destinationPath || defaultDestinationPath });
  const nameId = 'backup-job-name';
  const scopeId = 'backup-job-scope';
  const frequencyId = 'backup-job-frequency';
  const weekdayId = 'backup-job-weekday';
  const timeId = 'backup-job-time';
  const destinationId = 'backup-job-destination';
  const retentionId = 'backup-job-retention';
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [editor, setEditor] = useState<{ id: string | null; value: JobInput } | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BackupJob | null>(null);
  const requestActiveRef = useRef(false);
  // Polling and action-triggered refreshes can overlap; only the newest response may replace the dashboard.
  const dashboardRevisionRef = useRef(0);

  useEffect(() => {
    let active = true;
    const controllers = new Set<AbortController>();
    const isVisible = () => document.visibilityState === 'visible';
    const load = async () => {
      // A hidden settings tab cannot show a fresh result; resume with one read when it returns.
      if (!active || !isVisible()) return;
      if (requestActiveRef.current) return;
      requestActiveRef.current = true;
      const requestRevision = dashboardRevisionRef.current + 1;
      dashboardRevisionRef.current = requestRevision;
      const controller = new AbortController();
      controllers.add(controller);
      try {
        const result = await api.get<Dashboard>('/api/admin/backups', { signal: controller.signal });
        if (active && requestRevision === dashboardRevisionRef.current) { setDashboard(result); setError(''); setLoading(false); }
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
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshOnVisible);
      controllers.forEach((controller) => controller.abort());
    };
  }, []);

  async function reload() {
    const requestRevision = dashboardRevisionRef.current + 1;
    dashboardRevisionRef.current = requestRevision;
    try {
      const result = await api.get<Dashboard>('/api/admin/backups');
      if (requestRevision !== dashboardRevisionRef.current) return;
      setDashboard(result);
      setError('');
    } catch (cause) {
      if (requestRevision !== dashboardRevisionRef.current) return;
      setError(cause instanceof ApiError ? cause.message : 'Backup status could not be refreshed.');
    }
  }

  async function save(value: JobInput) {
    setSaving(true); setError(''); setSuccess('');
    try {
      if (editor?.id) await api.put(`/api/admin/backups/jobs/${encodeURIComponent(editor.id)}`, value);
      else await api.post('/api/admin/backups/jobs', value);
      setEditor(null); setSuccess(editor?.id ? 'Backup job updated.' : 'Backup job created.'); await reload();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Backup job could not be saved.');
    } finally { setSaving(false); }
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

  const dashboardDefaultPath = dashboard?.defaultDestinationPath || '';
  const isRunning = dashboard?.backupInProgress ?? false;
  // An unavailable dashboard is not an empty configuration; keep the recovery notice authoritative.
  const dashboardLoaded = dashboard !== null;
  return <div className="management-page settings-page backup-settings-page">
    <PageHeading title="Settings" subtitle="Configure and monitor automatic backups." />
    <BackupSettingsTabs />
    {error && <BackupNotice>{error}</BackupNotice>}
    {success && <BackupNotice kind="success">{success}</BackupNotice>}
    {isRunning && <div className="backup-running-banner" role="status" aria-live="polite"><RefreshCw size={16} aria-hidden="true" /><span>{dashboard?.mediaWritesPaused ? 'A media backup is running. Changes and uploads that affect course media are temporarily paused; learners can continue viewing courses.' : 'A database backup is running or a backup job is queued.'}</span></div>}
    <section className="backup-section" aria-labelledby="backup-jobs-heading">
      <div className="backup-section-heading"><div><h2 id="backup-jobs-heading">Backup jobs</h2><p>Create independent schedules for the database, course media, or both.</p></div><Button type="button" onClick={() => { setError(''); setSuccess(''); setEditor({ id: null, value: defaultJob(dashboardDefaultPath) }); }} disabled={loading || Boolean(editor)}><Plus size={16} aria-hidden="true" />New job</Button></div>
      {editor && <JobEditor key={editor.id || 'new'} job={editor.value} defaultDestinationPath={dashboardDefaultPath} saving={saving} onCancel={() => setEditor(null)} onSave={(value) => void save(value)} />}
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
              <Button type="button" variant="secondary" disabled={busyId === job.id} onClick={() => void runNow(job)}><Play size={15} aria-hidden="true" />{busyId === job.id ? 'Queuing…' : 'Run now'}</Button>
              <button type="button" className="text-action" disabled={busyId === job.id} onClick={() => { setError(''); setSuccess(''); setEditor({ id: job.id, value: { name: job.name, scope: job.scope, frequency: job.frequency, weekday: job.weekday, runTimeUtc: job.runTimeUtc, destinationPath: job.destinationPath, retentionCount: job.retentionCount, enabled: job.enabled } }); }}><Pencil size={14} aria-hidden="true" />Edit</button>
              <button type="button" className="text-action" disabled={busyId === job.id} onClick={() => void toggleEnabled(job)}>{job.enabled ? 'Pause' : 'Enable'}</button>
              <button type="button" className="text-action danger-text" disabled={busyId === job.id} onClick={() => setPendingDelete(job)}><Trash2 size={14} aria-hidden="true" />Remove</button>
            </div>
          </article>)}</div>
          : dashboardLoaded && !editor && <div className="backup-empty-state"><strong>No backup jobs configured</strong><span>Add a job to schedule a database backup, course-media backup, or full backup.</span></div>}
    </section>
    <section className="backup-section" aria-labelledby="backup-history-heading">
      <div className="backup-section-heading"><div><h2 id="backup-history-heading">Recent backup runs</h2><p>The latest 50 scheduled and manually started runs.</p></div><Button type="button" variant="secondary" onClick={() => void reload()} disabled={loading}><RefreshCw size={15} aria-hidden="true" />Refresh</Button></div>
      {dashboard?.runs.length ? <div className="backup-history-wrap" role="region" aria-label="Scrollable backup run history" tabIndex={0}><table className="backup-history-table"><caption className="sr-only">Recent backup run history</caption><thead><tr><th scope="col">Started</th><th scope="col">Job</th><th scope="col">Contents</th><th scope="col">Trigger</th><th scope="col">Status</th><th scope="col">Backup location or details</th></tr></thead><tbody>{dashboard.runs.map((run) => <tr key={run.id}>
        <td>{formatTimestamp(run.startedAt || run.createdAt)}</td><th scope="row">{run.jobName}</th><td>{scopeLabels[run.scope]}</td><td>{run.triggerType === 'scheduled' ? 'Scheduled' : `Manual${run.triggeredBy ? ` by ${run.triggeredBy}` : ''}`}</td><td><span className={`backup-run-status backup-run-${run.status}`}>{runStatusLabel(run)}</span></td><td className="backup-history-detail">{run.errorMessage ? <span className="backup-run-error">{run.errorMessage}</span> : run.artifactDeletedAt ? <span>Removed by retention on {formatTimestamp(run.artifactDeletedAt)}</span> : run.backupPath ? <code>{run.backupPath}</code> : '—'}</td>
      </tr>)}</tbody></table></div> : dashboardLoaded && <div className="backup-empty-state">No backup runs yet. Scheduled runs and “Run now” requests will appear here.</div>}
      <p className="backup-safety-note">Media backups briefly pause changes and uploads while files are copied. Learners can continue viewing courses. A server restart does not trigger missed schedules; the next run waits for its normal time. Removing a job does not delete its existing backup files.</p>
    </section>
    {pendingDelete && <ConfirmationDialog title={`Remove “${pendingDelete.name}”?`} description="This removes the schedule only. Existing backup files and run history will be kept." confirmLabel="Remove schedule" confirmDisabled={busyId === pendingDelete.id} onCancel={() => setPendingDelete(null)} onConfirm={() => void removeJob()} />}
  </div>;
}
