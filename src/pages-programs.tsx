import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArrowDown, ArrowUp, BookOpen, CalendarDays, Check, ChevronLeft, ChevronRight, CircleHelp, Plus, RotateCcw, Search, UsersRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, ApiError } from './api';
import { calendarMonthRequestRange, currentCalendarMonth, groupCalendarDeadlines, localDateKey, shouldShowCalendarEmptyState } from './calendar-dates';
import { pathAssignmentRemovalConfirmation } from './path-assignment-confirmation';
import { pathArchiveConfirmation } from './path-archive-confirmation';
import { AppSelect, Button, ConfirmationDialog, EmptyState, PageHeading, ProgressBar } from './components';
import type { Competency, Course, CourseDeadline, LearningPath } from './types';
import { appendPublishedCourseOptions, hasMorePublishedCourseOptions, publishedCourseOptionsPageUrl, type PublishedCoursePage } from './path-course-options';
import { canAssignLearningPathLearners } from './path-assignment-availability';
import { appendUnchangedCompetencyPage } from './competency-progress';
import { MAX_LEARNING_PATH_COURSES } from '../shared/learning-path-limits.js';
import { isPathCourseCheckboxDisabled, togglePathCourseSelection } from './path-course-selection';
import { useAuth } from './auth-context';
import { acquireSubmissionLock, releaseSubmissionLock } from './submission-lock';
import { hasUnsavedPathChanges, type PathEditorValue } from './path-editor-dirty';

function requestMessage(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

type PathLearner = { id: string; username: string; email: string | null; enrolled: boolean; source: 'assigned' | 'self' | null };
type PendingAssignmentRemoval = { pathId: string; pathTitle: string; learnerId: string; learnerUsername: string };
type PendingPathArchive = { id: string; title: string; discardEditorChanges: boolean };
type PathLearnerPage = { learners: PathLearner[]; total: number; page: number; pageSize: number; hasMore: boolean };
type LearningPathListPage = { paths: LearningPath[]; total: number; page: number; pageSize: number; hasMore: boolean };
type CompetencyAdminPage = { competencies: Competency[]; total: number; page: number; pageSize: number; hasMore: boolean };
type CompetencyProgressPage = { competencies: Competency[]; total: number; achievedTotal?: number; page: number; pageSize: number; hasMore: boolean };
type LearningPathStatusFilter = 'all' | LearningPath['status'];
const learningPathStatusFilters: Array<{ label: string; value: LearningPathStatusFilter }> = [
  { label: 'All paths', value: 'all' }, { label: 'Published', value: 'published' },
  { label: 'Drafts', value: 'draft' }, { label: 'Archived', value: 'archived' },
];
// Reuse one locale formatter across all course deadlines rendered in path cards.
const pathCourseDeadlineFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const calendarTimeFormatter = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });
const calendarDateTimeFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' });

function PathEditor({ existing, busy, onSave, onCancel, onDirtyChange }: {
  existing: LearningPath | null;
  busy: boolean;
  onSave: (path: { title: string; description: string; status: 'draft' | 'published'; selfEnrollment: boolean; courses: Array<{ courseId: string; requiresPrevious: boolean }> }) => Promise<boolean>;
  onCancel: () => void;
  onDirtyChange: (hasChanges: boolean) => void;
}) {
  const [title, setTitle] = useState(existing?.title || '');
  const [description, setDescription] = useState(existing?.description || '');
  const [status, setStatus] = useState<'draft' | 'published'>(existing?.status === 'published' ? 'published' : 'draft');
  const [selfEnrollment, setSelfEnrollment] = useState(existing?.selfEnrollment || false);
  const [selected, setSelected] = useState<Array<{ courseId: string; requiresPrevious: boolean }>>(
    existing?.courses.map((course) => ({ courseId: course.id, requiresPrevious: course.requiresPrevious })) || [],
  );
  const [courses, setCourses] = useState<Course[]>([]);
  const [coursePage, setCoursePage] = useState(0);
  const [coursePageSize, setCoursePageSize] = useState(0);
  const [courseTotal, setCourseTotal] = useState(0);
  const [courseLoading, setCourseLoading] = useState(true);
  const [courseLoadError, setCourseLoadError] = useState('');
  const [failedCoursePage, setFailedCoursePage] = useState<number | null>(null);
  const initialValueRef = useRef<PathEditorValue>({
    title: existing?.title || '',
    description: existing?.description || '',
    status: existing?.status === 'published' ? 'published' : 'draft',
    selfEnrollment: Boolean(existing?.selfEnrollment),
    courses: existing?.courses.map((course) => ({ courseId: course.id, requiresPrevious: course.requiresPrevious })) || [],
  });
  const pathTitleInputRef = useRef<HTMLInputElement>(null);
  const courseRequestSequenceRef = useRef(0);
  const courseRequestControllerRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!existing) return;
    // The editor appears above the selected card, so move keyboard focus into it.
    pathTitleInputRef.current?.focus();
  }, [existing]);
  const hasUnsavedChanges = hasUnsavedPathChanges({ title, description, status, selfEnrollment, courses: selected }, initialValueRef.current);
  useEffect(() => onDirtyChange(hasUnsavedChanges), [hasUnsavedChanges, onDirtyChange]);
  const loadCoursePage = useCallback(async (requestedPage: number, replace = false) => {
    if (courseRequestControllerRef.current) return;
    const controller = new AbortController();
    const requestSequence = ++courseRequestSequenceRef.current;
    courseRequestControllerRef.current = controller;
    setCourseLoading(true);
    setCourseLoadError('');
    setFailedCoursePage(null);
    try {
      const result = await api.get<PublishedCoursePage>(publishedCourseOptionsPageUrl(requestedPage), { signal: controller.signal });
      if (requestSequence !== courseRequestSequenceRef.current) return;
      setCourses((current) => appendPublishedCourseOptions(replace ? [] : current, result.courses));
      setCoursePage(result.page);
      setCoursePageSize(result.pageSize);
      setCourseTotal(result.total);
    } catch (cause) {
      if (requestSequence !== courseRequestSequenceRef.current || controller.signal.aborted) return;
      setCourseLoadError(requestMessage(cause, 'Published courses could not be loaded.'));
      setFailedCoursePage(requestedPage);
    } finally {
      if (courseRequestControllerRef.current === controller) {
        courseRequestControllerRef.current = null;
        if (requestSequence === courseRequestSequenceRef.current) setCourseLoading(false);
      }
    }
  }, []);
  useEffect(() => {
    void loadCoursePage(1, true);
    return () => {
      courseRequestSequenceRef.current += 1;
      courseRequestControllerRef.current?.abort();
      courseRequestControllerRef.current = null;
    };
  }, [loadCoursePage]);
  const courseById = useMemo(() => new Map([...courses, ...(existing?.courses || [])].map((course) => [course.id, course])), [courses, existing]);
  const selectedIds = useMemo(() => new Set(selected.map((item) => item.courseId)), [selected]);
  const selectionOverLimit = selected.length > MAX_LEARNING_PATH_COURSES;
  const selectionAtLimit = selected.length >= MAX_LEARNING_PATH_COURSES;
  const available = [...courseById.values()].filter((course) =>
    (course.status === 'published' && (!selfEnrollment || course.visibility === 'public')) || selectedIds.has(course.id));
  const hasUnavailableSelection = selected.some((item) => {
    const course = courseById.get(item.courseId);
    return !course || course.status !== 'published' || (selfEnrollment && course.visibility !== 'public');
  });
  function toggle(courseId: string, checked: boolean) {
    setSelected((current) => togglePathCourseSelection(current, courseId, checked));
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
  return <form className="program-editor-card" onSubmit={async (event) => {
    event.preventDefault();
    if (busy) return;
    const saved = await onSave({ title: title.trim(), description: description.trim(), status, selfEnrollment,
      courses: selected.map((item, index) => ({ ...item, requiresPrevious: index > 0 && item.requiresPrevious })) });
    if (!saved || existing) return;
    // A new path starts from a clean form after a successful create.
    setTitle(''); setDescription(''); setStatus('draft'); setSelfEnrollment(false); setSelected([]);
    onDirtyChange(false);
    pathTitleInputRef.current?.focus();
  }} aria-busy={busy}>
    <div className="program-card-heading"><div><span className="program-icon"><BookOpen size={18} /></span><div><h2>{existing ? 'Edit learning path' : 'Create a learning path'}</h2><p>Arrange published courses into a guided sequence.</p></div></div>{existing && <Button variant="quiet" onClick={onCancel} disabled={busy}>Cancel</Button>}</div>
    <div className="program-form-grid">
      <label>Path name<input ref={pathTitleInputRef} required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} disabled={busy} /></label>
      <div className="app-select-field"><span>Availability</span><AppSelect ariaLabel="Path availability" value={status} onChange={setStatus} options={[{ value: 'draft', label: 'Draft' }, { value: 'published', label: 'Published' }]} disabled={busy} /></div>
      <label className="program-full-field">Description<textarea rows={3} maxLength={6000} value={description} onChange={(event) => setDescription(event.target.value)} disabled={busy} /></label>
    </div>
    <label className="program-toggle"><input type="checkbox" checked={selfEnrollment} onChange={(event) => setSelfEnrollment(event.target.checked)} disabled={busy} /><span><strong>Allow learner self-enrollment</strong><small>Only public courses can be included in an open path.</small></span></label>
    <fieldset className="path-course-selector" disabled={busy}><legend>Courses in this path</legend>
      <p className={`path-course-selection-count${selectionOverLimit ? ' over-limit' : selectionAtLimit ? ' at-limit' : ''}`} role={selectionAtLimit ? 'status' : undefined} aria-live={selectionAtLimit ? 'polite' : undefined} aria-atomic={selectionAtLimit || undefined}>
        {selectionOverLimit
          ? `This path has ${selected.length} courses. Remove ${selected.length - MAX_LEARNING_PATH_COURSES} before saving.`
          : selectionAtLimit
            ? `Maximum of ${MAX_LEARNING_PATH_COURSES} courses selected. Remove a course before adding another.`
            : `${selected.length} of ${MAX_LEARNING_PATH_COURSES} courses selected.`}
      </p>
      {available.length ? <div className="path-course-checklist">{available.map((course) => {
        const isSelected = selectedIds.has(course.id);
        const selectionDisabled = isPathCourseCheckboxDisabled(selected.length, isSelected);
        return <label key={course.id} className={`path-course-check${selectionDisabled ? ' path-course-check-disabled' : ''}`}><input type="checkbox" checked={isSelected} disabled={selectionDisabled} onChange={(event) => toggle(course.id, event.target.checked)} /><span><strong>{course.title}</strong><small>{course.category} · {course.visibility}{course.status !== 'published' ? ` · ${course.status}` : ''}</small></span></label>;
      })}</div>
        : courseLoading && coursePage === 0 ? <p className="muted" role="status">Loading published courses…</p>
          : courseLoadError && coursePage === 0 ? null
            : selfEnrollment && courses.length ? <p className="muted">No public courses are available in the loaded results.</p>
              : <p className="muted">Publish a course before adding it to a learning path.</p>}
      {courseLoadError && <div className="path-course-page-error" role="alert"><p>{courseLoadError}</p><Button type="button" variant="secondary" onClick={() => void loadCoursePage(failedCoursePage || 1, (failedCoursePage || 1) === 1)} disabled={courseLoading}>Retry loading courses</Button></div>}
      {coursePage > 0 && <div className="path-course-options-footer"><span className="muted" role="status" aria-live="polite">{courseLoading ? 'Loading more courses. ' : ''}Loaded {courses.length} of {courseTotal} published courses.</span>{hasMorePublishedCourseOptions(coursePage, coursePageSize, courseTotal) && !courseLoadError && <Button type="button" variant="secondary" onClick={() => void loadCoursePage(coursePage + 1)} disabled={courseLoading}>{courseLoading ? 'Loading…' : 'Load more courses'}</Button>}</div>}
    </fieldset>
    {hasUnavailableSelection && <p className="path-selection-warning" role="status">Remove private or unpublished courses before saving this path with its current availability.</p>}
    {selected.length > 0 && <ol className="path-course-order">{selected.map((item, index) => {
      const course = courseById.get(item.courseId);
      return <li key={item.courseId}><span className="path-course-number">{index + 1}</span><div><strong>{course?.title || 'Course'}</strong>{index > 0 && <label className="path-prerequisite"><input type="checkbox" checked={item.requiresPrevious} onChange={(event) => setSelected((current) => current.map((step) => step.courseId === item.courseId ? { ...step, requiresPrevious: event.target.checked } : step))} disabled={busy} />Require all earlier courses first</label>}</div><div className="path-reorder-buttons"><button type="button" aria-label={`Move ${course?.title} earlier`} disabled={busy || index === 0} onClick={() => move(index, -1)}><ArrowUp size={16} /></button><button type="button" aria-label={`Move ${course?.title} later`} disabled={busy || index === selected.length - 1} onClick={() => move(index, 1)}><ArrowDown size={16} /></button></div></li>;
    })}</ol>}
    {status === 'published' && selected.length === 0 && <p className="path-selection-warning" role="status">Add at least one published course before making this path available.</p>}
    <div className="program-form-actions"><Button type="submit" disabled={busy || !title.trim() || hasUnavailableSelection || selectionOverLimit || (status === 'published' && selected.length === 0)}>{busy ? 'Saving…' : existing ? 'Save path' : 'Create path'}</Button></div>
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
  const pathEditorReturnFocusRef = useRef<HTMLButtonElement | null>(null);
  const pathEditorDirtyRef = useRef(false);
  const [editing, setEditing] = useState<LearningPath | null>(null);
  const [pendingPathEdit, setPendingPathEdit] = useState<LearningPath | null>(null);
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
  const assignmentSearchInputRef = useRef<HTMLInputElement>(null);
  const [assignmentPage, setAssignmentPage] = useState(1);
  const [assignmentPageSize, setAssignmentPageSize] = useState(50);
  const [assignmentTotal, setAssignmentTotal] = useState(0);
  const [assignmentHasMore, setAssignmentHasMore] = useState(false);
  const [assignmentLoading, setAssignmentLoading] = useState(false);
  const [assignmentLoadError, setAssignmentLoadError] = useState(false);
  const [assignmentAction, setAssignmentAction] = useState<'assign' | 'remove' | null>(null);
  const [removingLearnerId, setRemovingLearnerId] = useState('');
  const [pendingAssignmentRemoval, setPendingAssignmentRemoval] = useState<PendingAssignmentRemoval | null>(null);
  const [pendingPathArchive, setPendingPathArchive] = useState<PendingPathArchive | null>(null);
  const assignmentBusy = assignmentAction !== null;
  const assignmentRequestSequenceRef = useRef(0);
  const assignmentRequestControllerRef = useRef<AbortController | null>(null);
  const assignmentPathRef = useRef<string | null>(null);
  const pathsPageActiveRef = useRef(false);
  const pathsLoadSequenceRef = useRef(0);
  const pathsRequestControllerRef = useRef<AbortController | null>(null);
  const requestedPathPageRef = useRef(1);

  const updatePathEditorDirty = useCallback((hasChanges: boolean) => {
    pathEditorDirtyRef.current = hasChanges;
  }, []);

  function requestPathEdit(path: LearningPath, trigger: HTMLButtonElement) {
    if (editing?.id === path.id) return;
    pathEditorReturnFocusRef.current = trigger;
    if (pathEditorDirtyRef.current) {
      // Switching the keyed editor would discard local form values without saving.
      setPendingPathEdit(path);
      return;
    }
    setEditing(path);
  }

  function confirmPathEdit() {
    const path = pendingPathEdit;
    setPendingPathEdit(null);
    if (!path) return;
    pathEditorDirtyRef.current = false;
    setEditing(path);
  }

  function cancelPathEdit() {
    const trigger = pathEditorReturnFocusRef.current;
    pathEditorReturnFocusRef.current = null;
    pathEditorDirtyRef.current = false;
    setEditing(null);
    if (trigger?.isConnected) trigger.focus();
    else pathStatusFilterButtonsRef.current.all?.focus();
  }

  function restorePathEditorFocus() {
    const trigger = pathEditorReturnFocusRef.current;
    pathEditorReturnFocusRef.current = null;
    if (!trigger) return;
    window.requestAnimationFrame(() => {
      if (trigger.isConnected) trigger.focus();
      else pathStatusFilterButtonsRef.current.all?.focus();
    });
  }

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
      const result = await api.get<LearningPathListPage>(`/api/learning-paths?${params}`, { signal: requestController.signal });
      if (!isCurrentRequest()) return;
      setPaths(result.paths);
      setPathPage(result.page);
      setPathPageSize(result.pageSize);
      setPathTotal(result.total);
      setPathHasMore(result.hasMore);
    } catch (cause) {
      if (isCurrentRequest()) {
        setLoadFailed(true);
        setError(requestMessage(cause, 'Learning paths could not be loaded.'));
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
    setPendingPathArchive(null);
    clearAssignmentPanel();
    void load(page);
  }

  function changePathStatus(status: LearningPathStatusFilter) {
    if (loading || saving || assignmentBusy || status === pathStatus) return;
    setPendingPathArchive(null);
    clearAssignmentPanel();
    setPaths([]);
    setPathPage(1);
    setPathTotal(0);
    setPathHasMore(false);
    setPathStatus(status);
    void load(1, status);
  }

  async function savePath(value: Parameters<NonNullable<React.ComponentProps<typeof PathEditor>['onSave']>>[0]): Promise<boolean> {
    if (!acquireSubmissionLock(savePathSubmissionInFlightRef)) return false;
    setSaving(true); setError(''); setNotice('');
    try {
      if (editing) await api.patch(`/api/manage/learning-paths/${editing.id}`, value);
      else await api.post('/api/manage/learning-paths', value);
      if (editing && !canAssignLearningPathLearners(value.status) && assignmentPathRef.current === editing.id) clearAssignmentPanel();
      setEditing(null); setPathStatus('all'); setNotice(editing ? 'Learning path updated.' : 'Learning path created.'); await load(1, 'all');
      restorePathEditorFocus();
      return true;
    } catch (cause) { setError(requestMessage(cause, 'Learning path could not be saved.')); return false; }
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
    setPendingAssignmentRemoval(null);
    setAssignmentPath(null); setLearners([]); setSelectedLearner(''); setAssignmentSearch(''); setAssignmentAppliedSearch('');
    setAssignmentPage(1); setAssignmentTotal(0); setAssignmentHasMore(false); setAssignmentLoading(false); setAssignmentLoadError(false);
  }

  async function archivePath(path: LearningPath) {
    if (saving || assignmentBusy || path.status === 'archived') return;
    if (assignmentPathRef.current === path.id) clearAssignmentPanel();
    setSaving(true); setChangingPathStatusId(path.id); setError(''); setNotice('');
    try {
      await api.patch(`/api/manage/learning-paths/${path.id}`, { status: 'archived' });
      if (editing?.id === path.id) {
        // The editor only supports draft and published states, so close it after archive succeeds.
        pathEditorDirtyRef.current = false;
        setEditing(null);
      }
      setNotice(`Learning path “${path.title}” archived. Existing enrollments and course progress were kept.`);
      pendingPathStatusFocusRef.current = 'archived';
      setPathStatus('archived'); await load(1, 'archived');
    } catch (cause) { setError(requestMessage(cause, 'Learning path could not be archived.')); }
    finally { setChangingPathStatusId(null); setSaving(false); }
  }

  function requestPathArchive(path: LearningPath) {
    if (saving || assignmentBusy || path.status === 'archived') return;
    setPendingPathArchive({ id: path.id, title: path.title, discardEditorChanges: editing?.id === path.id && pathEditorDirtyRef.current });
  }

  function confirmPathArchive() {
    const pending = pendingPathArchive;
    setPendingPathArchive(null);
    if (!pending || saving || assignmentBusy) return;
    const path = paths.find((item) => item.id === pending.id && item.title === pending.title && item.status !== 'archived');
    if (path) void archivePath(path);
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
    setPendingAssignmentRemoval(null);
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
      setPendingAssignmentRemoval(null);
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

  function clearPathLearnerSearch(pathId: string) {
    if (assignmentBusy || assignmentPathRef.current !== pathId) return;
    setAssignmentSearch(''); setAssignmentAppliedSearch(''); setAssignmentPage(1); setSelectedLearner('');
    // Keep keyboard focus in the persistent search field when this empty-state action disappears.
    assignmentSearchInputRef.current?.focus();
    void loadPathLearners(pathId, '', 1);
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
      setNotice('Learner is enrolled in the path.');
      setLearners((current) => current.map((learner) => learner.id === learnerId ? { ...learner, enrolled: true, source: 'assigned' } : learner));
      setSelectedLearner(''); await loadPathLearners(pathId, assignmentAppliedSearch, assignmentPage); await load();
    } catch (cause) {
      if (requestSequence === assignmentRequestSequenceRef.current && assignmentPathRef.current === pathId) setError(requestMessage(cause, 'Learner could not be assigned.'));
    } finally {
      if (assignmentPathRef.current === pathId) setAssignmentAction(null);
    }
  }

  function requestAssignmentRemoval(path: LearningPath, learner: PathLearner) {
    if (assignmentBusy || assignmentLoading || assignmentPathRef.current !== path.id || !canAssignLearningPathLearners(path.status) || !learner.enrolled || learner.source !== 'assigned') return;
    setPendingAssignmentRemoval({ pathId: path.id, pathTitle: path.title, learnerId: learner.id, learnerUsername: learner.username });
  }

  async function confirmAssignmentRemoval() {
    const pending = pendingAssignmentRemoval;
    if (!pending) return;
    const requestSequence = assignmentRequestSequenceRef.current;
    const path = paths.find((item) => item.id === pending.pathId && item.title === pending.pathTitle && canAssignLearningPathLearners(item.status));
    const learner = learners.find((item) => item.id === pending.learnerId && item.username === pending.learnerUsername && item.enrolled && item.source === 'assigned');
    setPendingAssignmentRemoval(null);
    if (assignmentBusy || assignmentLoading || assignmentPathRef.current !== pending.pathId || !path || !learner) return;
    setAssignmentAction('remove'); setRemovingLearnerId(learner.id); setError(''); setNotice('');
    try {
      await api.delete(`/api/manage/learning-paths/${pending.pathId}/assignments/${learner.id}`);
      if (requestSequence !== assignmentRequestSequenceRef.current || assignmentPathRef.current !== pending.pathId) return;
      // Removing an assignment changes path access while preserving the learner's course progress.
      setNotice(`${learner.username} is no longer assigned to “${path.title}”. Course progress was kept.`);
      setLearners((current) => current.map((item) => item.id === learner.id ? { ...item, enrolled: false, source: null } : item));
      await loadPathLearners(pending.pathId, assignmentAppliedSearch, assignmentPage);
    } catch (cause) {
      if (requestSequence === assignmentRequestSequenceRef.current && assignmentPathRef.current === pending.pathId) setError(requestMessage(cause, 'Path assignment could not be removed.'));
    } finally {
      if (assignmentPathRef.current === pending.pathId) {
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
  const pendingRemovalPath = pendingAssignmentRemoval && paths.find((path) => path.id === pendingAssignmentRemoval.pathId && path.title === pendingAssignmentRemoval.pathTitle && canAssignLearningPathLearners(path.status));
  const pendingRemovalLearner = pendingAssignmentRemoval && learners.find((learner) => learner.id === pendingAssignmentRemoval.learnerId && learner.username === pendingAssignmentRemoval.learnerUsername && learner.enrolled && learner.source === 'assigned');

  return <div className="management-page programs-page">
    <PageHeading title="Learning paths" subtitle={staff ? 'Guide learners through a course sequence and assign paths.' : 'Follow a guided sequence of courses and track your progress.'} />
    {error && (loadFailed ? <div className="error-notice-actionable" role="alert"><span>{error}</span><Button variant="secondary" disabled={loading} onClick={() => void load(requestedPathPageRef.current)}>Try again</Button></div> : <div className="inline-notice" role="alert">{error}</div>)}{notice && <div className="inline-notice inline-notice-success" role="status">{notice}</div>}
    {hasEmptyPathResult && <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{emptyPathState.title}. {emptyPathState.detail}</p>}
    {staff && <PathEditor key={editing?.id || 'new'} existing={editing} busy={saving} onSave={savePath} onCancel={cancelPathEdit} onDirtyChange={updatePathEditorDirty} />}
    {staff && <div className="management-tabs" role="group" aria-label="Filter learning paths by status">{learningPathStatusFilters.map((filter) => <button type="button" key={filter.value} ref={(button) => { if (button) pathStatusFilterButtonsRef.current[filter.value] = button; else delete pathStatusFilterButtonsRef.current[filter.value]; }} aria-pressed={pathStatus === filter.value} className={pathStatus === filter.value ? 'active' : ''} disabled={loading || saving || assignmentBusy} onClick={() => changePathStatus(filter.value)}>{filter.label}</button>)}</div>}
    {loading && !paths.length ? <div className="page-loading" role="status">Loading learning paths…</div> : paths.length ? <>
      {loading && <div className="log-loading" role="status">Loading learning paths…</div>}
      <div className="program-list" aria-busy={loading}>
      {paths.map((path) => <article className="program-card learning-path-card" key={path.id}>
        <div className="program-card-heading"><div><span className="program-icon"><BookOpen size={18} /></span><div><h2>{path.title}</h2><p>{path.description || `${path.courseCount} courses in this path`}</p></div></div><span className={`program-status ${path.status}`}>{path.status}</span></div>
        {path.courseCount > 0 && <>
          <div className="program-progress-line"><span>{staff ? 'Your progress: ' : ''}{path.completedCourses} of {path.courseCount} courses complete</span><strong>{Math.round(path.completedCourses / path.courseCount * 100)}%</strong></div>
          <ProgressBar value={Math.round(path.completedCourses / path.courseCount * 100)} label={`${staff ? 'Your progress in' : 'Progress in'} ${path.title}`} />
        </>}
        <ol className="path-course-list">{path.courses.map((course) => <li key={course.id} className={!course.unlocked && !staff ? 'locked' : ''}>
          <span className="path-course-number">{course.completed ? <Check size={14} /> : course.position + 1}</span>
          <div><strong>{course.title}</strong><small>{course.category}{course.deadlineAt ? ` · Due ${pathCourseDeadlineFormatter.format(new Date(course.deadlineAt))}` : ''}</small></div>
          {!staff && course.unlocked ? <Link className="text-action" to={`/courses/${course.id}`} aria-label={`${course.completed ? 'Review course' : 'Start course'}: ${course.title}`}>{course.completed ? 'Review course' : 'Start course'}</Link> : !staff ? <span className="muted">Complete earlier courses to unlock</span> : <Link className="text-action" to={`/manage/courses/${course.id}/edit`} aria-label={`Edit course: ${course.title}`}>Edit course</Link>}
        </li>)}</ol>
        <div className="program-card-footer">
          {staff ? path.status === 'archived' ? <Button variant="secondary" aria-label={`Restore ${path.title} as draft`} disabled={saving || assignmentBusy} aria-busy={changingPathStatusId === path.id} onClick={() => void restorePath(path)}><RotateCcw size={15} />{changingPathStatusId === path.id ? 'Restoring…' : 'Restore as draft'}</Button> : <><Button variant="secondary" aria-label={`Edit path: ${path.title}`} onClick={(event) => requestPathEdit(path, event.currentTarget)} disabled={saving || assignmentBusy}>Edit path</Button>
            {canAssignLearningPathLearners(path.status)
              ? <Button variant="secondary" aria-label={assignmentPath === path.id ? `Close assignments for ${path.title}` : `Assign learners to ${path.title}`} aria-expanded={assignmentPath === path.id} aria-controls={assignmentPath === path.id ? `path-assignments-${path.id}` : undefined} disabled={saving || assignmentBusy} onClick={() => void toggleAssignments(path)}><UsersRound size={15} />{assignmentPath === path.id ? 'Close assignments' : 'Assign learners'}</Button>
              : <span className="muted">Publish this path to assign learners.</span>}
            <Button variant="secondary" aria-label={`Archive ${path.title}`} disabled={saving || assignmentBusy} aria-busy={changingPathStatusId === path.id} onClick={() => requestPathArchive(path)}><Archive size={15} />{changingPathStatusId === path.id ? 'Archiving…' : 'Archive'}</Button></>
            : !path.enrolled && path.selfEnrollment ? <Button aria-label={joiningPathId === path.id ? `Joining ${path.title}` : `Join path: ${path.title}`} disabled={joiningPathId !== null} aria-busy={joiningPathId === path.id} onClick={() => void selfEnroll(path)}>{joiningPathId === path.id ? 'Joining…' : 'Join path'}</Button> : path.enrolled ? <span className="program-enrolled"><Check size={15} />Enrolled</span> : null}
        </div>
        {staff && canAssignLearningPathLearners(path.status) && assignmentPath === path.id && <div id={`path-assignments-${path.id}`} className="path-assignment-panel" aria-busy={assignmentLoading || assignmentBusy}><h3>Assign a learner</h3>
          <form role="search" aria-label="Search learners" className="management-search path-assignment-search" onSubmit={(event) => searchPathLearners(event, path.id)}><Search size={16} aria-hidden="true" /><input ref={assignmentSearchInputRef} type="search" aria-label="Search learners by name or email" maxLength={100} placeholder="Search learners by name or email" value={assignmentSearch} disabled={assignmentBusy} onChange={(event) => setAssignmentSearch(event.target.value)} /><Button type="submit" variant="quiet" disabled={assignmentBusy}>Search</Button></form>
          <div className="path-assignment-controls"><AppSelect ariaLabel="Select a learner" value={selectedLearner} disabled={assignmentLoading || assignmentBusy || assignmentLoadError || assignableLearners.length === 0} onChange={setSelectedLearner} options={[{ value: '', label: assignmentTotal === 0 ? 'No learners found' : assignableLearners.length ? 'Choose a learner' : 'No unassigned learners on this page', disabled: true }, ...assignableLearners.map((learner) => ({ value: learner.id, label: learner.email ? `${learner.username} · ${learner.email}` : learner.username }))]} /><Button disabled={!selectedLearner || assignmentLoading || assignmentBusy || assignmentLoadError} onClick={() => void assignLearner(path.id)}>{assignmentAction === 'assign' ? 'Assigning…' : 'Assign'}</Button></div>
          {assignmentLoading && <p className="path-assignment-status" role="status">Loading learners…</p>}
          {assignmentLoadError && <Button type="button" variant="secondary" onClick={() => void loadPathLearners(path.id, assignmentAppliedSearch, assignmentPage)}>Try loading learners again</Button>}
          {!assignmentLoading && !assignmentLoadError && assignmentTotal === 0 && (assignmentAppliedSearch
            ? <div className="path-assignment-empty"><p className="path-assignment-status" role="status">No active learners match this search.</p><Button type="button" variant="quiet" disabled={assignmentBusy} onClick={() => clearPathLearnerSearch(path.id)}>Clear search</Button></div>
            : <p className="path-assignment-status" role="status">There are no active learner accounts yet.</p>)}
          {!assignmentLoading && !assignmentLoadError && assignmentTotal > 0 && assignableLearners.length === 0 && <p className="path-assignment-status" role="status">All learners on this page are already enrolled. Search or move to another page to find someone else.</p>}
          {!assignmentLoading && !assignmentLoadError && assignmentTotal > 0 && <div className="log-pagination path-learner-pagination"><p role="status" aria-live="polite" aria-atomic="true">Showing {(assignmentPage - 1) * assignmentPageSize + 1}–{Math.min(assignmentPage * assignmentPageSize, assignmentTotal)} of {assignmentTotal} learners</p><div><Button variant="secondary" disabled={assignmentPage <= 1 || assignmentBusy} onClick={() => changeAssignmentPage(path.id, assignmentPage - 1)}>Previous</Button><span>Page {assignmentPage} of {Math.max(1, Math.ceil(assignmentTotal / assignmentPageSize))}</span><Button variant="secondary" disabled={!assignmentHasMore || assignmentBusy} onClick={() => changeAssignmentPage(path.id, assignmentPage + 1)}>Next</Button></div></div>}
          {enrolledLearners.length > 0 && <><h4 className="path-assigned-heading">Enrollments on this page</h4><ul className="path-assigned-learners">{enrolledLearners.map((learner) => <li key={learner.id}><span>{learner.username}{learner.email && <small>{learner.email}</small>}<small>{learner.source === 'self' ? 'Self-enrolled' : 'Assigned'}</small></span>{learner.source === 'assigned' && <button type="button" className="text-action" aria-label={`${removingLearnerId === learner.id ? 'Removing assignment for' : 'Remove assignment for'} ${learner.username} from ${path.title}`} disabled={assignmentBusy || assignmentLoading} aria-busy={removingLearnerId === learner.id} onClick={() => requestAssignmentRemoval(path, learner)}>{removingLearnerId === learner.id ? 'Removing…' : 'Remove assignment'}</button>}</li>)}</ul></>}
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
    {pendingAssignmentRemoval && assignmentPath === pendingAssignmentRemoval.pathId && pendingRemovalPath && pendingRemovalLearner && <ConfirmationDialog {...pathAssignmentRemovalConfirmation(pendingAssignmentRemoval.learnerUsername, pendingAssignmentRemoval.pathTitle)} confirmLabel="Remove assignment" onCancel={() => setPendingAssignmentRemoval(null)} onConfirm={() => void confirmAssignmentRemoval()} />}
    {pendingPathArchive && paths.some((path) => path.id === pendingPathArchive.id && path.title === pendingPathArchive.title && path.status !== 'archived') && <ConfirmationDialog {...pathArchiveConfirmation(pendingPathArchive.title, pendingPathArchive.discardEditorChanges)} confirmLabel="Archive path" onCancel={() => setPendingPathArchive(null)} onConfirm={confirmPathArchive} />}
    {pendingPathEdit && <ConfirmationDialog title="Discard unsaved path changes?" description={`Your current path changes will be lost if you switch to editing “${pendingPathEdit.title}”.`} confirmLabel="Discard and edit" onCancel={() => setPendingPathEdit(null)} onConfirm={confirmPathEdit} />}
  </div>;
}

export function CalendarPage() {
  const [month, setMonth] = useState(() => currentCalendarMonth());
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
  const { from: dateFrom, to: dateTo } = calendarMonthRequestRange(year, monthIndex);
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
  const { monthItems, itemsByLocalDay } = useMemo(
    () => groupCalendarDeadlines(items, year, monthIndex),
    [items, year, monthIndex],
  );
  const days = [...Array(firstDay).fill(null), ...Array.from({ length: dayCount }, (_, index) => index + 1)];
  const cells = [...days, ...Array((7 - days.length % 7) % 7).fill(null)];
  const formatter = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
  const fullDateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'full' });
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return <div className="management-page programs-page calendar-page">
    <PageHeading title="Learning calendar" subtitle="Course completion deadlines shown in your local timezone." action={<div className="calendar-month-controls"><Button variant="secondary" aria-label="Previous month" onClick={() => { setItems([]); setMonth(new Date(year, monthIndex - 1, 1)); }}><ChevronLeft size={17} /></Button><span className="calendar-month-label" role="status" aria-live="polite" aria-atomic="true">{formatter.format(month)}</span><Button variant="secondary" aria-label="Next month" onClick={() => { setItems([]); setMonth(new Date(year, monthIndex + 1, 1)); }}><ChevronRight size={17} /></Button><Button variant="secondary" className="calendar-current-month" onClick={() => { setItems([]); setMonth(currentCalendarMonth()); }}>This month</Button></div>} />
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
      {loading ? <p className="calendar-empty-note" role="status">Loading deadlines…</p> : shouldShowCalendarEmptyState(loading, error, monthItems.length) && <p className="calendar-empty-note" role="status"><CalendarDays size={18} />No course deadlines this month.</p>}
    </section>
    {monthItems.length > 0 && <section className="calendar-deadline-list"><h2>Deadlines this month</h2><ul>{[...monthItems].sort((a, b) => a.dueAt.localeCompare(b.dueAt)).map((item) => <li key={item.courseId}><span className={`deadline-status ${item.status}`}>{item.status}</span><Link to={item.url}><strong>{item.title}</strong><small>{calendarDateTimeFormatter.format(new Date(item.dueAt))}</small></Link></li>)}</ul></section>}
  </div>;
}

export function CompetenciesPage() {
  const competencyListStatusRef = useRef<HTMLParagraphElement>(null);
  const competencyRequestRef = useRef(0);
  const competencyControllerRef = useRef<AbortController | null>(null);
  const loadingMoreCompetenciesRef = useRef(false);
  const [competencies, setCompetencies] = useState<Competency[]>([]);
  const [competencyTotal, setCompetencyTotal] = useState(0);
  const [achievedCompetencyTotal, setAchievedCompetencyTotal] = useState(0);
  const [competencyPage, setCompetencyPage] = useState(0);
  const [competencyPageSize, setCompetencyPageSize] = useState(12);
  const [hasMoreCompetencies, setHasMoreCompetencies] = useState(false);
  const [loadingMoreCompetencies, setLoadingMoreCompetencies] = useState(false);
  const [loadMoreCompetenciesError, setLoadMoreCompetenciesError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadSequence, setReloadSequence] = useState(0);
  useEffect(() => {
    let active = true;
    const requestId = ++competencyRequestRef.current;
    const controller = new AbortController();
    competencyControllerRef.current = controller;
    loadingMoreCompetenciesRef.current = false;
    setLoading(true); setError(''); setLoadMoreCompetenciesError(''); setLoadingMoreCompetencies(false);
    setCompetencies([]); setCompetencyTotal(0); setAchievedCompetencyTotal(0); setCompetencyPage(0); setHasMoreCompetencies(false);
    api.get<CompetencyProgressPage>('/api/competencies?page=1', { signal: controller.signal })
      .then((result) => {
        if (!active || requestId !== competencyRequestRef.current) return;
        setCompetencies(result.competencies); setCompetencyTotal(result.total); setAchievedCompetencyTotal(result.achievedTotal ?? 0);
        setCompetencyPage(result.page); setCompetencyPageSize(result.pageSize); setHasMoreCompetencies(result.hasMore);
      })
      .catch((cause) => { if (active && requestId === competencyRequestRef.current) setError(requestMessage(cause, 'Competency progress could not be loaded.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => {
      active = false;
      competencyRequestRef.current += 1;
      controller.abort();
      if (competencyControllerRef.current === controller) competencyControllerRef.current = null;
    };
  }, [reloadSequence]);
  async function loadMoreCompetencies() {
    const controller = competencyControllerRef.current;
    if (!hasMoreCompetencies || loadingMoreCompetenciesRef.current || !controller || controller.signal.aborted) return;
    const requestId = competencyRequestRef.current;
    const nextPage = competencyPage + 1;
    loadingMoreCompetenciesRef.current = true;
    setLoadingMoreCompetencies(true); setLoadMoreCompetenciesError('');
    try {
      const result = await api.get<CompetencyProgressPage>(`/api/competencies?page=${nextPage}`, { signal: controller.signal });
      if (requestId !== competencyRequestRef.current || controller.signal.aborted) return;
      const nextCompetencies = appendUnchangedCompetencyPage(
        competencies, result.competencies, nextPage, result.page, competencyTotal, result.total,
      );
      if (!nextCompetencies) {
        setReloadSequence((current) => current + 1);
        return;
      }
      setCompetencies(nextCompetencies);
      setCompetencyTotal(result.total); setCompetencyPage(result.page); setCompetencyPageSize(result.pageSize); setHasMoreCompetencies(result.hasMore);
      if (!result.hasMore) window.requestAnimationFrame(() => competencyListStatusRef.current?.focus());
    } catch (cause) {
      if (requestId === competencyRequestRef.current && !controller.signal.aborted) {
        setLoadMoreCompetenciesError(requestMessage(cause, 'More competency progress could not be loaded.'));
      }
    } finally {
      if (requestId === competencyRequestRef.current) {
        loadingMoreCompetenciesRef.current = false;
        setLoadingMoreCompetencies(false);
      }
    }
  }
  return <div className="management-page programs-page">
    <PageHeading title="Competencies" subtitle="See the skills you have demonstrated through completed courses." />
    {error && <div className="error-notice-actionable" role="alert"><span>{error}</span><Button variant="secondary" disabled={loading} onClick={() => setReloadSequence((current) => current + 1)}>Try again</Button></div>}
    {loading ? <div className="page-loading" role="status">Loading competencies…</div> : error ? null : competencyTotal ? <>
      <div className="competency-summary"><span className="program-icon"><CircleHelp size={18} /></span><div><strong>{achievedCompetencyTotal} of {competencyTotal} competencies achieved</strong><ProgressBar value={achievedCompetencyTotal / competencyTotal * 100} label="Competencies achieved" /></div></div>
      <div className="competency-grid">{competencies.map((item) => <article className={`competency-card ${item.achieved ? 'achieved' : ''}`} key={item.id}><div className="competency-card-top"><span className="program-icon"><CircleHelp size={18} /></span><span className={`program-status ${item.achieved ? 'published' : 'draft'}`}>{item.achieved ? 'Achieved' : 'In progress'}</span></div><h2>{item.title}</h2><p>{item.description || 'Complete a mapped course to achieve this competency.'}</p><strong>{item.completedCourses} of {item.courseCount} mapped courses complete</strong>{item.courses?.length ? <ul>{item.courses.map((course) => <li key={course.id}>{course.completed ? <Check size={15} aria-hidden="true" /> : <BookOpen size={15} aria-hidden="true" />}<span>{course.title}<span className="sr-only">, {course.completed ? 'completed' : 'not completed'}</span></span></li>)}</ul> : <small>No courses are currently mapped.</small>}</article>)}</div>
      {competencyTotal > competencyPageSize && (
        <div className="catalog-pagination competency-progress-pagination">
          <div className="competency-progress-status">
            <p ref={competencyListStatusRef} tabIndex={-1} role="status" aria-live="polite">
              {loadingMoreCompetencies ? 'Loading more competencies. ' : ''}Showing {competencies.length} of {competencyTotal} competencies
            </p>
            {loadMoreCompetenciesError && <div className="error-notice error-notice-actionable competency-progress-load-error" role="alert">
              <span>{loadMoreCompetenciesError}</span>
              <Button variant="secondary" disabled={loadingMoreCompetencies} onClick={() => void loadMoreCompetencies()}>Try again</Button>
            </div>}
          </div>
          {hasMoreCompetencies && <Button variant="secondary" disabled={loadingMoreCompetencies} aria-busy={loadingMoreCompetencies} onClick={() => void loadMoreCompetencies()}>
            {loadingMoreCompetencies ? 'Loading…' : `Load ${Math.min(competencyPageSize, competencyTotal - competencies.length)} more competencies`}
          </Button>}
        </div>
      )}
    </> : <>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">No competencies have been added. Your organization’s skills map will appear here when competencies are configured.</p>
      <EmptyState title="No competencies have been added" detail="Your organization’s skills map will appear here when competencies are configured." />
    </>}
  </div>;
}

export function AdminCompetenciesPage() {
  const [items, setItems] = useState<Competency[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const competencyTitleInputRef = useRef<HTMLInputElement>(null);
  const loadControllerRef = useRef<AbortController | null>(null);
  async function load(requestedPage = page, requestedQuery = appliedQuery) {
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    setLoading(true); setLoadError('');
    try {
      const params = new URLSearchParams({ page: String(requestedPage) });
      if (requestedQuery) params.set('q', requestedQuery);
      // Filter on the server before paging so the count and page controls match the search results.
      const result = await api.get<CompetencyAdminPage>(`/api/admin/competencies?${params}`, { signal: controller.signal });
      if (!controller.signal.aborted) {
        setItems(result.competencies);
        setPage(result.page);
        setPageSize(result.pageSize);
        setTotal(result.total);
      }
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
  function searchCompetencies(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextQuery = query.trim();
    setAppliedQuery(nextQuery); setPage(1);
    void load(1, nextQuery);
  }
  function clearSearch() {
    setQuery(''); setAppliedQuery(''); setPage(1);
    void load(1, '');
  }
  async function create(event: React.FormEvent) {
    event.preventDefault(); if (loading || saving || savingId !== null || !title.trim()) return;
    setSaving(true); setError(''); setNotice('');
    let created = false;
    try {
      const result = await api.post<{ page: number }>('/api/admin/competencies', { title: title.trim(), description: description.trim() });
      created = true;
      setTitle(''); setDescription(''); setQuery(''); setAppliedQuery(''); setNotice('Competency added.'); setPage(result.page);
      await load(result.page, '');
    }
    catch (cause) { setError(requestMessage(cause, 'Competency could not be added.')); }
    finally {
      setSaving(false);
      if (created) window.requestAnimationFrame(() => {
        const input = competencyTitleInputRef.current;
        if (input?.isConnected) input.focus();
      });
    }
  }
  async function toggle(item: Competency) {
    if (loading || saving || savingId) return;
    setSavingId(item.id); setError(''); setNotice('');
    try {
      const params = new URLSearchParams();
      if (appliedQuery) params.set('q', appliedQuery);
      // The page is computed against the current filter so the toggled row stays in view.
      const serializedQuery = params.toString();
      const queryString = serializedQuery ? `?${serializedQuery}` : '';
      const result = await api.patch<{ page: number }>(`/api/admin/competencies/${item.id}${queryString}`, { active: !item.active });
      setPage(result.page);
      await load(result.page, appliedQuery);
    }
    catch (cause) { setError(requestMessage(cause, 'Competency could not be updated.')); }
    finally { setSavingId(null); }
  }
  return <div className="management-page programs-page">
    <PageHeading title="Competency map" subtitle="Manage the organization’s competencies. Staff can map published courses to each one." />
    {error && <div className="inline-notice" role="alert">{error}</div>}{notice && <div className="inline-notice inline-notice-success" role="status">{notice}</div>}
    {loadError && <div className="error-notice-actionable" role="alert"><span>{loadError}</span><Button variant="secondary" disabled={loading || saving || savingId !== null} onClick={() => void load()}>Try again</Button></div>}
    {!loading && !loadError && !error && items.length === 0 && <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{appliedQuery ? `No competencies match ${appliedQuery}.` : 'No competencies yet. Add competencies before mapping courses to them.'}</p>}
    <form className="program-editor-card competency-create-form" onSubmit={create} aria-busy={loading || saving || savingId !== null}><div className="program-card-heading"><div><span className="program-icon"><CircleHelp size={18} /></span><div><h2>Add a competency</h2><p>Course completions can demonstrate this competency.</p></div></div></div><div className="program-form-grid"><label>Name<input ref={competencyTitleInputRef} required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} disabled={loading || saving || savingId !== null} /></label><label className="program-full-field">Description<textarea rows={2} maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} disabled={loading || saving || savingId !== null} /></label></div><div className="program-form-actions"><Button type="submit" disabled={loading || saving || savingId !== null || !title.trim()}><Plus size={16} />{saving ? 'Adding…' : 'Add competency'}</Button></div></form>
    <form role="search" className="management-search competency-search" aria-label="Search competencies" onSubmit={searchCompetencies} aria-busy={loading}>
      <Search size={18} aria-hidden="true" />
      <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search competencies" aria-label="Search competency names and descriptions" maxLength={100} disabled={saving || savingId !== null} />
      <Button type="submit" variant="quiet" disabled={saving || savingId !== null}>Search</Button>
    </form>
    {loading ? <div className="page-loading" role="status">Loading competencies…</div> : loadError ? null : items.length ? <>
      <div className="competency-admin-list">{items.map((item) => <article key={item.id} className="competency-admin-row"><div><h2>{item.title}</h2><p>{item.description || 'No description'}</p></div><span className={`program-status ${item.active ? 'published' : 'archived'}`}>{item.active ? 'Active' : 'Inactive'}</span><Button variant="secondary" disabled={saving || savingId !== null} aria-busy={savingId === item.id} aria-label={savingId === item.id ? `Saving ${item.title}` : `${item.active ? 'Deactivate' : 'Reactivate'} ${item.title}`} onClick={() => void toggle(item)}>{savingId === item.id ? 'Saving…' : item.active ? 'Deactivate' : 'Reactivate'}</Button></article>)}</div>
      <CompetencyAdminPagination page={page} pageSize={pageSize} total={total} loading={loading} onChange={(nextPage) => void load(nextPage)} />
    </> : appliedQuery ? <EmptyState title="No competencies match" detail="Try a different competency name or description, or clear your search." action={<Button type="button" variant="secondary" onClick={clearSearch}>Clear search</Button>} /> : <EmptyState title="No competencies yet" detail="Add competencies before mapping courses to them." />}
  </div>;
}

function CompetencyAdminPagination({ page, pageSize, total, loading, onChange }: {
  page: number; pageSize: number; total: number; loading: boolean; onChange: (page: number) => void;
}) {
  if (total <= pageSize) return null;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const firstItem = (page - 1) * pageSize + 1;
  const lastItem = Math.min(page * pageSize, total);
  return <nav className="competency-admin-pagination" aria-label="Competency pages">
    <span role="status" aria-live="polite">Showing {firstItem}–{lastItem} of {total} competencies</span>
    <div>
      <Button variant="secondary" disabled={loading || page <= 1} onClick={() => onChange(page - 1)}>Previous</Button>
      <span>Page {page} of {pageCount}</span>
      <Button variant="secondary" disabled={loading || page >= pageCount} onClick={() => onChange(page + 1)}>Next</Button>
    </div>
  </nav>;
}

