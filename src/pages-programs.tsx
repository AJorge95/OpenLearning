import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArrowDown, ArrowUp, BookOpen, CalendarDays, Check, ChevronLeft, ChevronRight, CircleHelp, Plus, RotateCcw, Search, UsersRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, ApiError } from './api';
import { AppSelect, Button, EmptyState, PageHeading, ProgressBar } from './components';
import type { Competency, Course, CourseDeadline, LearningPath } from './types';
import { useAuth } from './auth-context';
import { acquireSubmissionLock, releaseSubmissionLock } from './submission-lock';

function requestMessage(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

type PathLearner = { id: string; username: string; email: string | null; enrolled: boolean; source: 'assigned' | 'self' | null };
type PathLearnerPage = { learners: PathLearner[]; total: number; page: number; pageSize: number; hasMore: boolean };
type LearningPathListPage = { paths: LearningPath[]; total: number; page: number; pageSize: number; hasMore: boolean };
type LearningPathStatusFilter = 'all' | LearningPath['status'];
const learningPathStatusFilters: Array<{ label: string; value: LearningPathStatusFilter }> = [
  { label: 'All paths', value: 'all' }, { label: 'Published', value: 'published' },
  { label: 'Drafts', value: 'draft' }, { label: 'Archived', value: 'archived' },
];
const calendarTimeFormatter = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });
const calendarDateTimeFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' });

function PathEditor({ courses, existing, busy, onSave, onCancel }: {
  courses: Course[];
  existing: LearningPath | null;
  busy: boolean;
  onSave: (path: { title: string; description: string; status: 'draft' | 'published'; selfEnrollment: boolean; courses: Array<{ courseId: string; requiresPrevious: boolean }> }) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(existing?.title || '');
  const [description, setDescription] = useState(existing?.description || '');
  const [status, setStatus] = useState<'draft' | 'published'>(existing?.status === 'published' ? 'published' : 'draft');
  const [selfEnrollment, setSelfEnrollment] = useState(existing?.selfEnrollment || false);
  const [selected, setSelected] = useState<Array<{ courseId: string; requiresPrevious: boolean }>>(
    existing?.courses.map((course) => ({ courseId: course.id, requiresPrevious: course.requiresPrevious })) || [],
  );
  const courseById = useMemo(() => new Map([...courses, ...(existing?.courses || [])].map((course) => [course.id, course])), [courses, existing]);
  const selectedIds = useMemo(() => new Set(selected.map((item) => item.courseId)), [selected]);
  const available = [...courseById.values()].filter((course) =>
    (course.status === 'published' && (!selfEnrollment || course.visibility === 'public')) || selectedIds.has(course.id));
  const hasUnavailableSelection = selected.some((item) => {
    const course = courseById.get(item.courseId);
    return !course || course.status !== 'published' || (selfEnrollment && course.visibility !== 'public');
  });
  function toggle(courseId: string, checked: boolean) {
    setSelected((current) => checked
      ? [...current, { courseId, requiresPrevious: current.length > 0 }]
      : current.filter((item) => item.courseId !== courseId));
  }
  function move(index: number, direction: -1 | 1) {
    setSelected((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      next[0] = { ...next[0], requiresPrevious: false };
      return next;
    });
  }
  return <form className="program-editor-card" onSubmit={(event) => {
    event.preventDefault();
    if (busy) return;
    onSave({ title: title.trim(), description: description.trim(), status, selfEnrollment,
      courses: selected.map((item, index) => ({ ...item, requiresPrevious: index > 0 && item.requiresPrevious })) });
  }} aria-busy={busy}>
    <div className="program-card-heading"><div><span className="program-icon"><BookOpen size={18} /></span><div><h2>{existing ? 'Edit learning path' : 'Create a learning path'}</h2><p>Arrange published courses into a guided sequence.</p></div></div>{existing && <Button variant="quiet" onClick={onCancel} disabled={busy}>Cancel</Button>}</div>
    <div className="program-form-grid">
      <label>Path name<input required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} disabled={busy} /></label>
      <div className="app-select-field"><span>Availability</span><AppSelect ariaLabel="Path availability" value={status} onChange={setStatus} options={[{ value: 'draft', label: 'Draft' }, { value: 'published', label: 'Published' }]} disabled={busy} /></div>
      <label className="program-full-field">Description<textarea rows={3} maxLength={6000} value={description} onChange={(event) => setDescription(event.target.value)} disabled={busy} /></label>
    </div>
    <label className="program-toggle"><input type="checkbox" checked={selfEnrollment} onChange={(event) => setSelfEnrollment(event.target.checked)} disabled={busy} /><span><strong>Allow learner self-enrollment</strong><small>Only public courses can be included in an open path.</small></span></label>
    <fieldset className="path-course-selector" disabled={busy}><legend>Courses in this path</legend>
      {available.length ? <div className="path-course-checklist">{available.map((course) => <label key={course.id} className="path-course-check"><input type="checkbox" checked={selectedIds.has(course.id)} onChange={(event) => toggle(course.id, event.target.checked)} /><span><strong>{course.title}</strong><small>{course.category} · {course.visibility}{course.status !== 'published' ? ` · ${course.status}` : ''}</small></span></label>)}</div> : <p className="muted">Publish a course before adding it to a learning path.</p>}
    </fieldset>
    {hasUnavailableSelection && <p className="path-selection-warning" role="status">Remove private or unpublished courses before saving this path with its current availability.</p>}
    {selected.length > 0 && <ol className="path-course-order">{selected.map((item, index) => {
      const course = courseById.get(item.courseId);
      return <li key={item.courseId}><span className="path-course-number">{index + 1}</span><div><strong>{course?.title || 'Course'}</strong>{index > 0 && <label className="path-prerequisite"><input type="checkbox" checked={item.requiresPrevious} onChange={(event) => setSelected((current) => current.map((step) => step.courseId === item.courseId ? { ...step, requiresPrevious: event.target.checked } : step))} disabled={busy} />Require all earlier courses first</label>}</div><div className="path-reorder-buttons"><button type="button" aria-label={`Move ${course?.title} earlier`} disabled={busy || index === 0} onClick={() => move(index, -1)}><ArrowUp size={16} /></button><button type="button" aria-label={`Move ${course?.title} later`} disabled={busy || index === selected.length - 1} onClick={() => move(index, 1)}><ArrowDown size={16} /></button></div></li>;
    })}</ol>}
    {status === 'published' && selected.length === 0 && <p className="path-selection-warning" role="status">Add at least one published course before making this path available.</p>}
    <div className="program-form-actions"><Button type="submit" disabled={busy || !title.trim() || hasUnavailableSelection || (status === 'published' && selected.length === 0)}>{busy ? 'Saving…' : existing ? 'Save path' : 'Create path'}</Button></div>
  </form>;
}

export function LearningPathsPage() {
  const { user } = useAuth();
  const staff = user?.role === 'admin' || user?.role === 'moderator';
  const [paths, setPaths] = useState<LearningPath[]>([]);
  const [pathPage, setPathPage] = useState(1);
  const [pathPageSize, setPathPageSize] = useState(20);
  const [pathTotal, setPathTotal] = useState(0);
  const [pathHasMore, setPathHasMore] = useState(false);
  const [pathStatus, setPathStatus] = useState<LearningPathStatusFilter>('all');
  const pathStatusFilterButtonsRef = useRef<Partial<Record<LearningPathStatusFilter, HTMLButtonElement>>>({});
  const pendingPathStatusFocusRef = useRef<LearningPathStatusFilter | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [editing, setEditing] = useState<LearningPath | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const savePathSubmissionInFlightRef = useRef(false);
  const [changingPathStatusId, setChangingPathStatusId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [joiningPathId, setJoiningPathId] = useState<string | null>(null);
  const joiningPathRef = useRef(false);
  const [assignmentPath, setAssignmentPath] = useState<string | null>(null);
  const [learners, setLearners] = useState<PathLearner[]>([]);
  const [selectedLearner, setSelectedLearner] = useState('');
  const [assignmentSearch, setAssignmentSearch] = useState('');
  const [assignmentAppliedSearch, setAssignmentAppliedSearch] = useState('');
  const [assignmentPage, setAssignmentPage] = useState(1);
  const [assignmentPageSize, setAssignmentPageSize] = useState(50);
  const [assignmentTotal, setAssignmentTotal] = useState(0);
  const [assignmentHasMore, setAssignmentHasMore] = useState(false);
  const [assignmentLoading, setAssignmentLoading] = useState(false);
  const [assignmentLoadError, setAssignmentLoadError] = useState(false);
  const [assignmentAction, setAssignmentAction] = useState<'assign' | 'remove' | null>(null);
  const [removingLearnerId, setRemovingLearnerId] = useState('');
  const assignmentBusy = assignmentAction !== null;
  const assignmentRequestSequenceRef = useRef(0);
  const assignmentRequestControllerRef = useRef<AbortController | null>(null);
  const assignmentPathRef = useRef<string | null>(null);
  const pathsPageActiveRef = useRef(false);
  const pathsLoadSequenceRef = useRef(0);
  const pathsRequestControllerRef = useRef<AbortController | null>(null);
  const requestedPathPageRef = useRef(1);

  useEffect(() => {
    if (loading || saving || !pendingPathStatusFocusRef.current) return;
    const status = pendingPathStatusFocusRef.current;
    pendingPathStatusFocusRef.current = null;
    pathStatusFilterButtonsRef.current[status]?.focus();
  }, [loading, saving]);

  async function load(requestedPage = pathPage, requestedStatus = pathStatus) {
    if (!pathsPageActiveRef.current) return;
    pathsRequestControllerRef.current?.abort();
    const requestController = new AbortController();
    pathsRequestControllerRef.current = requestController;
    requestedPathPageRef.current = requestedPage;
    const requestSequence = ++pathsLoadSequenceRef.current;
    const isCurrentRequest = () => requestSequence === pathsLoadSequenceRef.current && pathsPageActiveRef.current;
    setLoading(true); setLoadFailed(false); setError('');
    try {
      const params = new URLSearchParams({ page: String(requestedPage) });
      if (staff) params.set('status', requestedStatus);
      const courseRequest = staff
        ? api.get<{ courses: Course[] }>('/api/manage/courses?status=published', { signal: requestController.signal })
          .then((result) => ({ ok: true as const, result }), (cause: unknown) => ({ ok: false as const, cause }))
        : null;
      const result = await api.get<LearningPathListPage>(`/api/learning-paths?${params}`, { signal: requestController.signal });
      if (!isCurrentRequest()) return;
      setPaths(result.paths);
      setPathPage(result.page);
      setPathPageSize(result.pageSize);
      setPathTotal(result.total);
      setPathHasMore(result.hasMore);
      if (courseRequest) {
        const courseOutcome = await courseRequest;
        if (!courseOutcome.ok) throw courseOutcome.cause;
        if (!isCurrentRequest()) return;
        setCourses(courseOutcome.result.courses);
      }
    } catch (cause) {
      if (isCurrentRequest()) {
        setLoadFailed(true);
        setError(requestMessage(cause, 'Learning paths or course options could not be loaded.'));
      }
    } finally {
      if (pathsRequestControllerRef.current === requestController) pathsRequestControllerRef.current = null;
      if (isCurrentRequest()) setLoading(false);
    }
  }
  useEffect(() => {
    pathsPageActiveRef.current = true;
    void load();
    return () => {
      pathsPageActiveRef.current = false;
      pathsLoadSequenceRef.current += 1;
      pathsRequestControllerRef.current?.abort();
      pathsRequestControllerRef.current = null;
      assignmentRequestSequenceRef.current += 1;
      assignmentRequestControllerRef.current?.abort();
      assignmentRequestControllerRef.current = null;
      assignmentPathRef.current = null;
    };
  }, [staff]);

  function changePathPage(page: number) {
    if (loading || assignmentBusy || page < 1) return;
    clearAssignmentPanel();
    void load(page);
  }

  function changePathStatus(status: LearningPathStatusFilter) {
    if (loading || saving || assignmentBusy || status === pathStatus) return;
    clearAssignmentPanel();
    setPathStatus(status);
    void load(1, status);
  }

  async function savePath(value: Parameters<NonNullable<React.ComponentProps<typeof PathEditor>['onSave']>>[0]) {
    if (!acquireSubmissionLock(savePathSubmissionInFlightRef)) return;
    setSaving(true); setError(''); setNotice('');
    try {
      if (editing) await api.patch(`/api/manage/learning-paths/${editing.id}`, value);
      else await api.post('/api/manage/learning-paths', value);
      setEditing(null); setPathStatus('all'); setNotice(editing ? 'Learning path updated.' : 'Learning path created.'); await load(1, 'all');
    } catch (cause) { setError(requestMessage(cause, 'Learning path could not be saved.')); }
    finally {
      releaseSubmissionLock(savePathSubmissionInFlightRef);
      setSaving(false);
    }
  }

  function clearAssignmentPanel() {
    assignmentRequestSequenceRef.current += 1;
    assignmentRequestControllerRef.current?.abort();
    assignmentRequestControllerRef.current = null;
    assignmentPathRef.current = null;
    setAssignmentPath(null); setLearners([]); setSelectedLearner(''); setAssignmentSearch(''); setAssignmentAppliedSearch('');
    setAssignmentPage(1); setAssignmentTotal(0); setAssignmentHasMore(false); setAssignmentLoading(false); setAssignmentLoadError(false);
  }

  async function archivePath(path: LearningPath) {
    if (saving || assignmentBusy || path.status === 'archived') return;
    const confirmed = window.confirm(`Archive “${path.title}”? It will be removed from active learning path lists. Existing learner enrollments and course progress will be kept.`);
    if (!confirmed) return;
    if (assignmentPathRef.current === path.id) clearAssignmentPanel();
    setSaving(true); setChangingPathStatusId(path.id); setError(''); setNotice('');
    try {
      await api.patch(`/api/manage/learning-paths/${path.id}`, { status: 'archived' });
      setNotice(`Learning path “${path.title}” archived. Existing enrollments and course progress were kept.`);
      pendingPathStatusFocusRef.current = 'archived';
      setPathStatus('archived'); await load(1, 'archived');
    } catch (cause) { setError(requestMessage(cause, 'Learning path could not be archived.')); }
    finally { setChangingPathStatusId(null); setSaving(false); }
  }

  async function restorePath(path: LearningPath) {
    if (saving || assignmentBusy || path.status !== 'archived') return;
    setSaving(true); setChangingPathStatusId(path.id); setError(''); setNotice('');
    try {
      await api.patch(`/api/manage/learning-paths/${path.id}`, { status: 'draft', selfEnrollment: false });
      setNotice(`Learning path “${path.title}” restored as a draft. Review it before publishing again.`);
      pendingPathStatusFocusRef.current = 'all';
      setPathStatus('all'); await load(1, 'all');
    } catch (cause) { setError(requestMessage(cause, 'Learning path could not be restored.')); }
    finally { setChangingPathStatusId(null); setSaving(false); }
  }

  async function selfEnroll(path: LearningPath) {
    if (joiningPathRef.current) return;
    joiningPathRef.current = true;
    setJoiningPathId(path.id);
    setError(''); setNotice('');
    try { await api.post(`/api/learning-paths/${path.id}/enroll`); setNotice(`You joined “${path.title}”.`); await load(); }
    catch (cause) { setError(requestMessage(cause, 'You could not join this learning path.')); }
    finally { joiningPathRef.current = false; setJoiningPathId(null); }
  }

  async function loadPathLearners(pathId: string, query: string, page: number) {
    assignmentRequestControllerRef.current?.abort();
    const requestController = new AbortController();
    assignmentRequestControllerRef.current = requestController;
    const requestSequence = ++assignmentRequestSequenceRef.current;
    assignmentPathRef.current = pathId;
    setLearners([]); setSelectedLearner(''); setAssignmentLoadError(false); setAssignmentLoading(true); setError('');
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (query) params.set('q', query);
      const result = await api.get<PathLearnerPage>(`/api/manage/learning-paths/${pathId}/learners?${params}`, { signal: requestController.signal });
      if (requestSequence !== assignmentRequestSequenceRef.current || assignmentPathRef.current !== pathId) return;
      setLearners(result.learners);
      setAssignmentTotal(result.total);
      setAssignmentPage(result.page);
      setAssignmentPageSize(result.pageSize);
      setAssignmentHasMore(result.hasMore);
    } catch (cause) {
      if (!requestController.signal.aborted && requestSequence === assignmentRequestSequenceRef.current && assignmentPathRef.current === pathId) {
        setAssignmentLoadError(true);
        setError(requestMessage(cause, 'Learners could not be loaded.'));
      }
    } finally {
      if (assignmentRequestControllerRef.current === requestController) assignmentRequestControllerRef.current = null;
      if (requestSequence === assignmentRequestSequenceRef.current && assignmentPathRef.current === pathId) setAssignmentLoading(false);
    }
  }

  async function toggleAssignments(path: LearningPath) {
    if (assignmentBusy) return;
    if (assignmentPathRef.current === path.id) {
      assignmentRequestSequenceRef.current += 1;
      assignmentRequestControllerRef.current?.abort();
      assignmentRequestControllerRef.current = null;
      assignmentPathRef.current = null;
      setAssignmentPath(null); setLearners([]); setSelectedLearner(''); setAssignmentSearch(''); setAssignmentAppliedSearch('');
      setAssignmentPage(1); setAssignmentTotal(0); setAssignmentHasMore(false); setAssignmentLoading(false); setAssignmentLoadError(false);
      return;
    }
    assignmentPathRef.current = path.id;
    setAssignmentPath(path.id); setAssignmentSearch(''); setAssignmentAppliedSearch(''); setAssignmentPage(1);
    setAssignmentTotal(0); setAssignmentHasMore(false);
    await loadPathLearners(path.id, '', 1);
  }

  function searchPathLearners(event: React.FormEvent<HTMLFormElement>, pathId: string) {
    event.preventDefault();
    if (assignmentBusy || assignmentPathRef.current !== pathId) return;
    const query = assignmentSearch.trim();
    setAssignmentAppliedSearch(query); setAssignmentPage(1); setSelectedLearner('');
    void loadPathLearners(pathId, query, 1);
  }

  function changeAssignmentPage(pathId: string, page: number) {
    if (assignmentBusy || assignmentLoading || assignmentPathRef.current !== pathId) return;
    setAssignmentPage(page); setSelectedLearner('');
    void loadPathLearners(pathId, assignmentAppliedSearch, page);
  }

  async function assignLearner(pathId: string) {
    const requestSequence = assignmentRequestSequenceRef.current;
    const learnerId = selectedLearner;
    if (!learnerId || assignmentLoading || assignmentBusy || assignmentPathRef.current !== pathId) return;
    setAssignmentAction('assign'); setError(''); setNotice('');
    try {
      await api.post(`/api/manage/learning-paths/${pathId}/assignments`, { userId: learnerId });
      if (requestSequence !== assignmentRequestSequenceRef.current || assignmentPathRef.current !== pathId) return;
      setNotice('Learner assigned to the path.');
      setLearners((current) => current.map((learner) => learner.id === learnerId ? { ...learner, enrolled: true, source: 'assigned' } : learner));
      setSelectedLearner(''); await loadPathLearners(pathId, assignmentAppliedSearch, assignmentPage); await load();
    } catch (cause) {
      if (requestSequence === assignmentRequestSequenceRef.current && assignmentPathRef.current === pathId) setError(requestMessage(cause, 'Learner could not be assigned.'));
    } finally {
      if (assignmentPathRef.current === pathId) setAssignmentAction(null);
    }
  }

  async function removeAssignment(pathId: string, learnerId: string) {
    const requestSequence = assignmentRequestSequenceRef.current;
    if (assignmentBusy || assignmentLoading || assignmentPathRef.current !== pathId) return;
    setAssignmentAction('remove'); setRemovingLearnerId(learnerId); setError(''); setNotice('');
    try {
      await api.delete(`/api/manage/learning-paths/${pathId}/assignments/${learnerId}`);
      if (requestSequence !== assignmentRequestSequenceRef.current || assignmentPathRef.current !== pathId) return;
      setLearners((current) => current.map((learner) => learner.id === learnerId ? { ...learner, enrolled: false, source: null } : learner));
      await loadPathLearners(pathId, assignmentAppliedSearch, assignmentPage);
    } catch (cause) {
      if (requestSequence === assignmentRequestSequenceRef.current && assignmentPathRef.current === pathId) setError(requestMessage(cause, 'Path assignment could not be removed.'));
    } finally {
      if (assignmentPathRef.current === pathId) {
        setAssignmentAction(null); setRemovingLearnerId('');
      }
    }
  }

  const assignableLearners = learners.filter((learner) => !learner.enrolled);
  const enrolledLearners = learners.filter((learner) => learner.enrolled);
  const emptyPathState = staff
    ? pathStatus === 'all'
      ? { title: 'No learning paths yet', detail: 'Create a path from published courses to give learners a guided route.' }
      : { title: `No ${pathStatus} learning paths`, detail: pathStatus === 'archived' ? 'Archived paths are kept here and can be restored as drafts.' : 'Try another status filter or create a learning path.' }
    : { title: 'No learning paths available', detail: 'When a path is published or assigned to you, it will appear here.' };
  const hasEmptyPathResult = !loading && !loadFailed && !error && paths.length === 0;

  return <div className="management-page programs-page">
    <PageHeading title="Learning paths" subtitle={staff ? 'Guide learners through a course sequence and assign paths.' : 'Follow a guided sequence of courses and track your progress.'} />
    {error && (loadFailed ? <div className="error-notice-actionable" role="alert"><span>{error}</span><Button variant="secondary" disabled={loading} onClick={() => void load(requestedPathPageRef.current)}>Try again</Button></div> : <div className="inline-notice" role="alert">{error}</div>)}{notice && <div className="inline-notice inline-notice-success" role="status">{notice}</div>}
    {hasEmptyPathResult && <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{emptyPathState.title}. {emptyPathState.detail}</p>}
    {staff && <PathEditor key={editing?.id || 'new'} courses={courses} existing={editing} busy={saving} onSave={savePath} onCancel={() => setEditing(null)} />}
    {staff && <div className="management-tabs" role="group" aria-label="Filter learning paths by status">{learningPathStatusFilters.map((filter) => <button type="button" key={filter.value} ref={(button) => { if (button) pathStatusFilterButtonsRef.current[filter.value] = button; else delete pathStatusFilterButtonsRef.current[filter.value]; }} aria-pressed={pathStatus === filter.value} className={pathStatus === filter.value ? 'active' : ''} disabled={loading || saving || assignmentBusy} onClick={() => changePathStatus(filter.value)}>{filter.label}</button>)}</div>}
    {loading && !paths.length ? <div className="page-loading" role="status">Loading learning paths…</div> : paths.length ? <>
      {loading && <div className="log-loading" role="status">Loading learning paths…</div>}
      <div className="program-list" aria-busy={loading}>
      {paths.map((path) => <article className="program-card learning-path-card" key={path.id}>
        <div className="program-card-heading"><div><span className="program-icon"><BookOpen size={18} /></span><div><h2>{path.title}</h2><p>{path.description || `${path.courseCount} courses in this path`}</p></div></div><span className={`program-status ${path.status}`}>{path.status}</span></div>
        <div className="program-progress-line"><span>{path.completedCourses} of {path.courseCount} courses complete</span><strong>{path.courseCount ? Math.round(path.completedCourses / path.courseCount * 100) : 0}%</strong></div>
        <ProgressBar value={path.courseCount ? Math.round(path.completedCourses / path.courseCount * 100) : 0} label={`Progress in ${path.title}`} />
        <ol className="path-course-list">{path.courses.map((course) => <li key={course.id} className={!course.unlocked && !staff ? 'locked' : ''}>
          <span className="path-course-number">{course.completed ? <Check size={14} /> : course.position + 1}</span>
          <div><strong>{course.title}</strong><small>{course.category}{course.deadlineAt ? ` · Due ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(course.deadlineAt))}` : ''}</small></div>
          {!staff && course.unlocked ? <Link className="text-action" to={`/courses/${course.id}`} aria-label={`${course.completed ? 'Review course' : 'Start course'}: ${course.title}`}>{course.completed ? 'Review course' : 'Start course'}</Link> : !staff ? <span className="muted">Complete earlier courses to unlock</span> : <Link className="text-action" to={`/manage/courses/${course.id}/edit`} aria-label={`Edit course: ${course.title}`}>Edit course</Link>}
        </li>)}</ol>
        <div className="program-card-footer">
          {staff ? path.status === 'archived' ? <Button variant="secondary" aria-label={`Restore ${path.title} as draft`} disabled={saving || assignmentBusy} aria-busy={changingPathStatusId === path.id} onClick={() => void restorePath(path)}><RotateCcw size={15} />{changingPathStatusId === path.id ? 'Restoring…' : 'Restore as draft'}</Button> : <><Button variant="secondary" aria-label={`Edit path: ${path.title}`} onClick={() => setEditing(path)} disabled={saving || assignmentBusy}>Edit path</Button><Button variant="secondary" aria-label={assignmentPath === path.id ? `Close assignments for ${path.title}` : `Assign learners to ${path.title}`} aria-expanded={assignmentPath === path.id} aria-controls={assignmentPath === path.id ? `path-assignments-${path.id}` : undefined} disabled={saving || assignmentBusy} onClick={() => void toggleAssignments(path)}><UsersRound size={15} />{assignmentPath === path.id ? 'Close assignments' : 'Assign learners'}</Button><Button variant="secondary" aria-label={`Archive ${path.title}`} disabled={saving || assignmentBusy} aria-busy={changingPathStatusId === path.id} onClick={() => void archivePath(path)}><Archive size={15} />{changingPathStatusId === path.id ? 'Archiving…' : 'Archive'}</Button></>
            : !path.enrolled && path.selfEnrollment ? <Button aria-label={joiningPathId === path.id ? `Joining ${path.title}` : `Join path: ${path.title}`} disabled={joiningPathId !== null} aria-busy={joiningPathId === path.id} onClick={() => void selfEnroll(path)}>{joiningPathId === path.id ? 'Joining…' : 'Join path'}</Button> : path.enrolled ? <span className="program-enrolled"><Check size={15} />Enrolled</span> : null}
        </div>
        {staff && assignmentPath === path.id && <div id={`path-assignments-${path.id}`} className="path-assignment-panel" aria-busy={assignmentLoading || assignmentBusy}><h3>Assign a learner</h3>
          <form className="management-search path-assignment-search" onSubmit={(event) => searchPathLearners(event, path.id)}><Search size={16} aria-hidden="true" /><input type="search" aria-label="Search learners by name or email" maxLength={100} placeholder="Search learners by name or email" value={assignmentSearch} disabled={assignmentBusy} onChange={(event) => setAssignmentSearch(event.target.value)} /><Button type="submit" variant="quiet" disabled={assignmentBusy}>Search</Button></form>
          <div className="path-assignment-controls"><AppSelect ariaLabel="Select a learner" value={selectedLearner} disabled={assignmentLoading || assignmentBusy || assignmentLoadError || assignableLearners.length === 0} onChange={setSelectedLearner} options={[{ value: '', label: assignmentTotal === 0 ? 'No learners found' : assignableLearners.length ? 'Choose a learner' : 'No unassigned learners on this page', disabled: true }, ...assignableLearners.map((learner) => ({ value: learner.id, label: learner.email ? `${learner.username} · ${learner.email}` : learner.username }))]} /><Button disabled={!selectedLearner || assignmentLoading || assignmentBusy || assignmentLoadError} onClick={() => void assignLearner(path.id)}>{assignmentAction === 'assign' ? 'Assigning…' : 'Assign'}</Button></div>
          {assignmentLoading && <p className="path-assignment-status" role="status">Loading learners…</p>}
          {assignmentLoadError && <Button type="button" variant="secondary" onClick={() => void loadPathLearners(path.id, assignmentAppliedSearch, assignmentPage)}>Try loading learners again</Button>}
          {!assignmentLoading && !assignmentLoadError && assignmentTotal === 0 && <p className="path-assignment-status" role="status">{assignmentAppliedSearch ? 'No active learners match this search.' : 'There are no active learner accounts yet.'}</p>}
          {!assignmentLoading && !assignmentLoadError && assignmentTotal > 0 && assignableLearners.length === 0 && <p className="path-assignment-status" role="status">All learners on this page are already enrolled. Search or move to another page to find someone else.</p>}
          {!assignmentLoading && !assignmentLoadError && assignmentTotal > 0 && <div className="log-pagination path-learner-pagination"><p role="status" aria-live="polite" aria-atomic="true">Showing {(assignmentPage - 1) * assignmentPageSize + 1}–{Math.min(assignmentPage * assignmentPageSize, assignmentTotal)} of {assignmentTotal} learners</p><div><Button variant="secondary" disabled={assignmentPage <= 1 || assignmentBusy} onClick={() => changeAssignmentPage(path.id, assignmentPage - 1)}>Previous</Button><span>Page {assignmentPage} of {Math.max(1, Math.ceil(assignmentTotal / assignmentPageSize))}</span><Button variant="secondary" disabled={!assignmentHasMore || assignmentBusy} onClick={() => changeAssignmentPage(path.id, assignmentPage + 1)}>Next</Button></div></div>}
          {enrolledLearners.length > 0 && <><h4 className="path-assigned-heading">Enrollments on this page</h4><ul className="path-assigned-learners">{enrolledLearners.map((learner) => <li key={learner.id}><span>{learner.username}{learner.email && <small>{learner.email}</small>}<small>{learner.source === 'self' ? 'Self-enrolled' : 'Assigned'}</small></span>{learner.source === 'assigned' && <button type="button" className="text-action" disabled={assignmentBusy || assignmentLoading} aria-busy={removingLearnerId === learner.id} onClick={() => void removeAssignment(path.id, learner.id)}>{removingLearnerId === learner.id ? 'Removing…' : 'Remove assignment'}</button>}</li>)}</ul></>}
        </div>}
      </article>)}
      </div>
      {pathTotal > pathPageSize && <nav className="log-pagination path-list-pagination" aria-label="Learning path pages" aria-busy={loading}>
        <p role="status" aria-live="polite" aria-atomic="true">Showing {(pathPage - 1) * pathPageSize + 1}–{Math.min(pathPage * pathPageSize, pathTotal)} of {pathTotal} learning paths</p>
        <div><Button variant="secondary" disabled={pathPage <= 1 || loading || assignmentBusy} onClick={() => changePathPage(pathPage - 1)}>Previous</Button>
          <span>Page {pathPage} of {Math.max(1, Math.ceil(pathTotal / pathPageSize))}</span>
          <Button variant="secondary" disabled={!pathHasMore || loading || assignmentBusy} onClick={() => changePathPage(pathPage + 1)}>Next</Button></div>
      </nav>}
    </> : loadFailed ? null : <EmptyState title={emptyPathState.title} detail={emptyPathState.detail} />}
  </div>;
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function CalendarPage() {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [items, setItems] = useState<CourseDeadline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadSequence, setReloadSequence] = useState(0);
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const todayKey = localDateKey(new Date());
  const firstDay = new Date(year, monthIndex, 1).getDay();
  const dayCount = new Date(year, monthIndex + 1, 0).getDate();
  // Fetch a UTC-date buffer around the local month so deadlines near midnight
  // are still grouped into the correct month in the learner's timezone.
  const dateFrom = localDateKey(new Date(year, monthIndex, 0));
  const dateTo = localDateKey(new Date(year, monthIndex + 1, 1));
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true); setError(''); setItems([]);
    api.get<{ items: CourseDeadline[] }>(`/api/calendar?from=${dateFrom}&to=${dateTo}`, { signal: controller.signal })
      .then((result) => { if (active) setItems(result.items); })
      .catch((cause) => { if (active) setError(requestMessage(cause, 'Calendar could not be loaded.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [dateFrom, dateTo, reloadSequence]);
  const monthItems = useMemo(() => items.filter((item) => {
    const due = new Date(item.dueAt);
    return due.getFullYear() === year && due.getMonth() === monthIndex;
  }), [items, year, monthIndex]);
  const itemsByLocalDay = useMemo(() => {
    const map = new Map<string, CourseDeadline[]>();
    for (const item of monthItems) {
      const key = localDateKey(new Date(item.dueAt));
      const dayItems = map.get(key);
      if (dayItems) dayItems.push(item);
      else map.set(key, [item]);
    }
    return map;
  }, [monthItems]);
  const days = [...Array(firstDay).fill(null), ...Array.from({ length: dayCount }, (_, index) => index + 1)];
  const cells = [...days, ...Array((7 - days.length % 7) % 7).fill(null)];
  const formatter = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
  const fullDateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'full' });
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return <div className="management-page programs-page calendar-page">
    <PageHeading title="Learning calendar" subtitle="Course completion deadlines shown in your local timezone." action={<div className="calendar-month-controls"><Button variant="secondary" aria-label="Previous month" onClick={() => { setItems([]); setMonth(new Date(year, monthIndex - 1, 1)); }}><ChevronLeft size={17} /></Button><span className="calendar-month-label" role="status" aria-live="polite" aria-atomic="true">{formatter.format(month)}</span><Button variant="secondary" aria-label="Next month" onClick={() => { setItems([]); setMonth(new Date(year, monthIndex + 1, 1)); }}><ChevronRight size={17} /></Button></div>} />
    {error && <div className="error-notice-actionable" role="alert"><span>{error}</span><Button variant="secondary" disabled={loading} onClick={() => setReloadSequence((current) => current + 1)}>Try again</Button></div>}
    <section className="calendar-panel" aria-label={`Deadlines for ${formatter.format(month)}`} aria-busy={loading} tabIndex={0}>
      <table className="calendar-grid"><caption className="sr-only">Calendar days and course deadlines for {formatter.format(month)}</caption>
        <thead><tr>{weekdays.map((day) => <th scope="col" key={day}>{day.slice(0, 3)}</th>)}</tr></thead>
        <tbody>{Array.from({ length: cells.length / 7 }, (_, weekIndex) => <tr key={`week-${weekIndex}`}>
          {cells.slice(weekIndex * 7, weekIndex * 7 + 7).map((day, dayIndex) => {
            if (!day) return <td className="calendar-day calendar-day-empty" key={`blank-${weekIndex}-${dayIndex}`} />;
            const key = localDateKey(new Date(year, monthIndex, day));
            const dueItems = itemsByLocalDay.get(key) || [];
            const date = new Date(year, monthIndex, day);
            return <td className={`calendar-day ${dueItems.length ? 'has-deadline' : ''}`} key={key}><div className="calendar-day-content"><time dateTime={key} aria-label={fullDateFormatter.format(date)} aria-current={key === todayKey ? 'date' : undefined}>{day}</time>{dueItems.map((item) => {
              const dueAt = new Date(item.dueAt);
              const statusLabel = item.status === 'overdue' ? 'Overdue' : item.status === 'completed' ? 'Completed' : 'Upcoming';
              const dateTimeLabel = calendarDateTimeFormatter.format(dueAt);
              return <Link key={item.courseId} to={item.url} className={`calendar-event ${item.status}`} aria-label={`${statusLabel} deadline for ${item.title}, ${dateTimeLabel}`} title={`${item.title} · ${item.status}`}><span>{item.title}</span><small>{calendarTimeFormatter.format(dueAt)}</small></Link>;
            })}</div></td>;
          })}
        </tr>)}</tbody>
      </table>
      {loading ? <p className="calendar-empty-note" role="status">Loading deadlines…</p> : !monthItems.length && <p className="calendar-empty-note" role="status"><CalendarDays size={18} />No course deadlines this month.</p>}
    </section>
    {monthItems.length > 0 && <section className="calendar-deadline-list"><h2>Deadlines this month</h2><ul>{[...monthItems].sort((a, b) => a.dueAt.localeCompare(b.dueAt)).map((item) => <li key={item.courseId}><span className={`deadline-status ${item.status}`}>{item.status}</span><Link to={item.url}><strong>{item.title}</strong><small>{calendarDateTimeFormatter.format(new Date(item.dueAt))}</small></Link></li>)}</ul></section>}
  </div>;
}

export function CompetenciesPage() {
  const [competencies, setCompetencies] = useState<Competency[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadSequence, setReloadSequence] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true); setError('');
    api.get<{ competencies: Competency[] }>('/api/competencies', { signal: controller.signal })
      .then((result) => { if (active) setCompetencies(result.competencies); })
      .catch((cause) => { if (active) setError(requestMessage(cause, 'Competency progress could not be loaded.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [reloadSequence]);
  const achieved = competencies.filter((item) => item.achieved).length;
  return <div className="management-page programs-page">
    <PageHeading title="Competencies" subtitle="See the skills you have demonstrated through completed courses." />
    {error && <div className="error-notice-actionable" role="alert"><span>{error}</span><Button variant="secondary" disabled={loading} onClick={() => setReloadSequence((current) => current + 1)}>Try again</Button></div>}
    {loading ? <div className="page-loading" role="status">Loading competencies…</div> : error ? null : competencies.length ? <>
      <div className="competency-summary"><span className="program-icon"><CircleHelp size={18} /></span><div><strong>{achieved} of {competencies.length} competencies achieved</strong><ProgressBar value={achieved / competencies.length * 100} label="Competencies achieved" /></div></div>
      <div className="competency-grid">{competencies.map((item) => <article className={`competency-card ${item.achieved ? 'achieved' : ''}`} key={item.id}><div className="competency-card-top"><span className="program-icon"><CircleHelp size={18} /></span><span className={`program-status ${item.achieved ? 'published' : 'draft'}`}>{item.achieved ? 'Achieved' : 'In progress'}</span></div><h2>{item.title}</h2><p>{item.description || 'Complete a mapped course to achieve this competency.'}</p><strong>{item.completedCourses} of {item.courseCount} mapped courses complete</strong>{item.courses?.length ? <ul>{item.courses.map((course) => <li key={course.id}>{course.completed ? <Check size={15} /> : <BookOpen size={15} />}<span>{course.title}</span></li>)}</ul> : <small>No courses are currently mapped.</small>}</article>)}</div>
    </> : <>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">No competencies have been added. Your organization’s skills map will appear here when competencies are configured.</p>
      <EmptyState title="No competencies have been added" detail="Your organization’s skills map will appear here when competencies are configured." />
    </>}
  </div>;
}

export function AdminCompetenciesPage() {
  const [items, setItems] = useState<Competency[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const loadControllerRef = useRef<AbortController | null>(null);
  async function load() {
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    setLoading(true); setLoadError('');
    try {
      const result = await api.get<{ competencies: Competency[] }>('/api/admin/competencies', { signal: controller.signal });
      if (!controller.signal.aborted) setItems(result.competencies);
    } catch (cause) {
      if (!controller.signal.aborted) setLoadError(requestMessage(cause, 'Competencies could not be loaded.'));
    } finally {
      if (loadControllerRef.current === controller) {
        loadControllerRef.current = null;
        setLoading(false);
      }
    }
  }
  useEffect(() => {
    void load();
    return () => {
      const controller = loadControllerRef.current;
      loadControllerRef.current = null;
      controller?.abort();
    };
  }, []);
  async function create(event: React.FormEvent) {
    event.preventDefault(); if (loading || saving || savingId !== null || !title.trim()) return;
    setSaving(true); setError(''); setNotice('');
    try { await api.post('/api/admin/competencies', { title: title.trim(), description: description.trim() }); setTitle(''); setDescription(''); setNotice('Competency added.'); await load(); }
    catch (cause) { setError(requestMessage(cause, 'Competency could not be added.')); }
    finally { setSaving(false); }
  }
  async function toggle(item: Competency) {
    if (loading || saving || savingId) return;
    setSavingId(item.id); setError(''); setNotice('');
    try { await api.patch(`/api/admin/competencies/${item.id}`, { active: !item.active }); await load(); }
    catch (cause) { setError(requestMessage(cause, 'Competency could not be updated.')); }
    finally { setSavingId(null); }
  }
  return <div className="management-page programs-page">
    <PageHeading title="Competency map" subtitle="Manage the organization’s competencies. Staff can map published courses to each one." />
    {error && <div className="inline-notice" role="alert">{error}</div>}{notice && <div className="inline-notice inline-notice-success" role="status">{notice}</div>}
    {loadError && <div className="error-notice-actionable" role="alert"><span>{loadError}</span><Button variant="secondary" disabled={loading || saving || savingId !== null} onClick={() => void load()}>Try again</Button></div>}
    {!loading && !loadError && !error && items.length === 0 && <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">No competencies yet. Add competencies before mapping courses to them.</p>}
    <form className="program-editor-card competency-create-form" onSubmit={create} aria-busy={loading || saving || savingId !== null}><div className="program-card-heading"><div><span className="program-icon"><CircleHelp size={18} /></span><div><h2>Add a competency</h2><p>Course completions can demonstrate this competency.</p></div></div></div><div className="program-form-grid"><label>Name<input required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} disabled={loading || saving || savingId !== null} /></label><label className="program-full-field">Description<textarea rows={2} maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} disabled={loading || saving || savingId !== null} /></label></div><div className="program-form-actions"><Button type="submit" disabled={loading || saving || savingId !== null || !title.trim()}><Plus size={16} />{saving ? 'Adding…' : 'Add competency'}</Button></div></form>
    {loading ? <div className="page-loading" role="status">Loading competencies…</div> : loadError ? null : items.length ? <div className="competency-admin-list">{items.map((item) => <article key={item.id} className="competency-admin-row"><div><h2>{item.title}</h2><p>{item.description || 'No description'}</p></div><span className={`program-status ${item.active ? 'published' : 'archived'}`}>{item.active ? 'Active' : 'Inactive'}</span><Button variant="secondary" disabled={saving || savingId !== null} aria-busy={savingId === item.id} aria-label={savingId === item.id ? `Saving ${item.title}` : `${item.active ? 'Deactivate' : 'Reactivate'} ${item.title}`} onClick={() => void toggle(item)}>{savingId === item.id ? 'Saving…' : item.active ? 'Deactivate' : 'Reactivate'}</Button></article>)}</div> : <EmptyState title="No competencies yet" detail="Add competencies before mapping courses to them." />}
  </div>;
}

