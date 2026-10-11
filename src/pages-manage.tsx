import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Activity, AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, BookOpen, Check, ChevronDown, CircleHelp, FileText, Filter, Link2, LockKeyhole, MoreVertical, Pencil, Plus, Search, Settings2, Trash2, Upload, UsersRound } from 'lucide-react';
import { createPortal } from 'react-dom';
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, fetchAccess, fetchCourse } from './api';
import { AppSelect, Button, CourseStatus, EmptyState, ImageWithFallback, PageHeading, PalettePicker, PasswordField, PlatformIconPicker, ProgressBar, UserInitial, VisibilityLabel } from './components';
import { formatCountLabel } from './count-label';
import { accountCourseAssignmentLabel } from './account-course-activity';
import { accountDisableConfirmation } from './account-disable-confirmation';
import { courseRowActionStatus } from './course-row-action-status';
import { getAppSelectVerticalPosition } from './app-select-position';
import { filterCourseCompetencies, updateCourseCompetencySelection } from './course-competency-selection';
import type { CourseRowAction } from './course-row-action-status';
import { validateRegistrationFieldEditor } from './registration-fields';
import type { BrandingPalette, ConnectionProtocol } from './branding';
import { useAuth } from './auth-context';
import { canonicalCaptionLanguageTag, captionFileSizeError, captionLanguageErrorMessage } from './caption-validation';
import { courseEditingNote } from './course-editing-note';
import { COMPLETION_WINDOW_ERROR, validateCompletionWindowDays } from './course-editor-validation';
import { isCourseCoverDimensionAllowed, MAX_COURSE_COVER_DIMENSION } from './course-cover-validation';
import { readImageDimensions } from './image-dimensions';
import { firstQuizTextIssue } from './quiz-validation';
import { lessonResourceUrlError } from './resource-validation';
import { clearPasswordConfirmationError, getPasswordConfirmationError } from './password-confirmation';
import { userListEmptyMessage } from './user-list-empty-state';
import { readResetStatusAfterConflict, shouldClearResetConfirmationAfterFailure } from './platform-reset-status';
import type { PlatformResetStatus } from './platform-reset-status';
import type { UserRoleFilter } from './user-list-empty-state';
import type { Competency, Course, CourseAccessUser, CourseAnalytics, CourseModule, CourseVersion, Lesson, LessonCaption, LessonResource, QuizQuestion, RegistrationField, RegistrationFieldType, Role, SavedRegistrationFieldValue, User } from './types';

type CourseListResponse = { courses: Course[]; total: number; page: number; pageSize: number };
type FailedCourseListRequest = { page: number; query: string; status: string };
type CourseVersionHistoryPage = { currentVersion: CourseVersion | null; versions: CourseVersion[]; total: number; page: number; pageSize: number; hasMore: boolean };

const courseDateFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const logTimestampFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const quizTitleLimit = 160;
const defaultQuizTitleSuffix = ' quiz';

function CourseVersionPagination({ page, pageSize, total, versions, loading, onChange }: {
  page: number; pageSize: number; total: number; versions: CourseVersion[]; loading: boolean; onChange: (page: number) => void;
}) {
  if (total <= pageSize) return null;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const firstVersion = versions[versions.length - 1]?.version_number ?? 0;
  const lastVersion = versions[0]?.version_number ?? 0;
  return <nav className="course-version-pagination" aria-label="Course version history pages">
    <span role="status" aria-live="polite">Showing previous versions {lastVersion}–{firstVersion} of {total}</span>
    <div>
      <Button variant="secondary" disabled={loading || page <= 1} onClick={() => onChange(page - 1)}>Newer</Button>
      <span>Page {page} of {pageCount}</span>
      <Button variant="secondary" disabled={loading || page >= pageCount} onClick={() => onChange(page + 1)}>Older</Button>
    </div>
  </nav>;
}

type EditableQuizChoice = QuizQuestion['choices'][number] & { editorKey?: string };
type EditableQuizQuestion = Omit<QuizQuestion, 'choices'> & { editorKey?: string; choices: EditableQuizChoice[] };

function truncateUtf16CodeUnits(value: string, limit: number) {
  let truncated = value.slice(0, limit);
  if (/[\uD800-\uDBFF]$/.test(truncated)) truncated = truncated.slice(0, -1);
  return truncated;
}

function CourseRowMenu({ course, busyAction, onStatusChange, onDelete }: {
  course: Course;
  busyAction: CourseRowAction | undefined;
  onStatusChange: (course: Course, status: Course['status']) => void;
  onDelete: (course: Course) => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId().replaceAll(':', '');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusMenuOnOpenRef = useRef(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 196, maxHeight: 280 });
  const itemCount = course.status === 'archived' ? 2 : 3;
  const isBusy = Boolean(busyAction);

  function openMenu(focusFirst = false) {
    const trigger = triggerRef.current;
    if (trigger) {
      const rect = trigger.getBoundingClientRect();
      const viewportWidth = Math.max(1, window.innerWidth);
      const margin = Math.min(12, Math.max(0, (viewportWidth - 1) / 2));
      const width = Math.min(196, Math.max(1, viewportWidth - margin * 2));
      const { top, maxHeight } = getAppSelectVerticalPosition(rect, window.innerHeight, itemCount);
      const left = Math.max(margin, Math.min(rect.right - width, viewportWidth - width - margin));
      setPosition({ top, left, width, maxHeight });
    }
    focusMenuOnOpenRef.current = focusFirst;
    setOpen(true);
  }

  function closeMenu(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    if (focusMenuOnOpenRef.current) {
      menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
      focusMenuOnOpenRef.current = false;
    }
    function closeFromOutside(event: PointerEvent) {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    }
    function closeWhenFocusLeaves(event: FocusEvent) {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    }
    function closeForLayoutChange() { setOpen(false); }
    document.addEventListener('pointerdown', closeFromOutside);
    document.addEventListener('focusin', closeWhenFocusLeaves);
    window.addEventListener('scroll', closeForLayoutChange, true);
    window.addEventListener('resize', closeForLayoutChange);
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside);
      document.removeEventListener('focusin', closeWhenFocusLeaves);
      window.removeEventListener('scroll', closeForLayoutChange, true);
      window.removeEventListener('resize', closeForLayoutChange);
    };
  }, [open]);

  function handleMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') || []);
    if (!items.length) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : currentIndex < 0 ? 0 : (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[nextIndex]?.focus();
  }

  return <div className="row-menu">
    <button ref={triggerRef} type="button" className="row-menu-trigger" aria-label={`More actions for ${course.title}`} aria-haspopup="menu" aria-expanded={open} aria-controls={`${id}-menu`} onClick={(event) => open ? closeMenu() : openMenu(event.detail === 0)} onKeyDown={(event) => { if (event.key === 'ArrowDown' && !open) { event.preventDefault(); openMenu(true); } }}><MoreVertical size={18} /></button>
    {open && createPortal(<div ref={menuRef} id={`${id}-menu`} className="row-menu-popover" role="menu" aria-label={`Actions for ${course.title}`} style={position} onKeyDown={handleMenuKeyDown}>
      <Link to={`/manage/courses/${course.id}/access`} role="menuitem" onClick={() => closeMenu()}>Assign learners</Link>
      {course.status === 'draft' && <button type="button" role="menuitem" onClick={() => { closeMenu(); onStatusChange(course, 'published'); }} disabled={isBusy} aria-busy={busyAction === 'publish'}>{busyAction === 'publish' ? 'Publishing…' : 'Publish'}</button>}
      {course.status === 'published' && <button type="button" role="menuitem" onClick={() => { closeMenu(); onStatusChange(course, 'draft'); }} disabled={isBusy} aria-busy={busyAction === 'unpublish'}>{busyAction === 'unpublish' ? 'Unpublishing…' : 'Unpublish'}</button>}
      {course.status !== 'archived' && <button type="button" role="menuitem" onClick={() => { closeMenu(); onStatusChange(course, 'archived'); }} disabled={isBusy} aria-busy={busyAction === 'archive'}>{busyAction === 'archive' ? 'Archiving…' : 'Archive'}</button>}
      {course.status === 'archived' && <button type="button" role="menuitem" className="danger-menu-item" onClick={() => { closeMenu(); onDelete(course); }} disabled={isBusy} aria-busy={busyAction === 'delete'}>{busyAction === 'delete' ? 'Deleting…' : 'Delete permanently'}</button>}
    </div>, document.body)}
  </div>;
}

function defaultQuizTitle(moduleTitle: string) {
  const prefix = truncateUtf16CodeUnits(moduleTitle, quizTitleLimit - defaultQuizTitleSuffix.length);
  return `${prefix}${defaultQuizTitleSuffix}`;
}

function Notice({ children, kind = 'error', id }: { children: React.ReactNode; kind?: 'error' | 'success'; id?: string }) {
  return <div id={id} className={`inline-notice inline-notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
}

function DateText({ value }: { value: string }) {
  const date = new Date(value.includes('Z') ? value : `${value.replace(' ', 'T')}Z`);
  return <span>{Number.isNaN(date.getTime()) ? '—' : courseDateFormatter.format(date)}</span>;
}

function DateTimeText({ value }: { value: string }) {
  const date = new Date(value.includes('Z') ? value : `${value.replace(' ', 'T')}Z`);
  return <span>{Number.isNaN(date.getTime()) ? '—' : logTimestampFormatter.format(date)}</span>;
}

function CourseRevisionBadge({ status }: { status: Course['reviewStatus'] }) {
  const label = status === 'in_review' ? 'In review'
    : status === 'changes_requested' ? 'Changes requested'
      : 'Draft changes';
  return <span className={status === 'in_review' ? 'program-status' : 'program-status draft'}>{label}</span>;
}

export function CourseManagementPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const loadSequenceRef = useRef(0);
  const loadControllerRef = useRef<AbortController | null>(null);
  const filtersRef = useRef({ query: appliedQuery, status });
  filtersRef.current = { query: appliedQuery, status };
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [failedRequest, setFailedRequest] = useState<FailedCourseListRequest | null>(null);
  const [busyActions, setBusyActions] = useState<Record<string, CourseRowAction>>({});
  const busyActionsRef = useRef(busyActions);

  function markCourseAction(courseId: string, action: CourseRowAction | null) {
    const next = { ...busyActionsRef.current };
    if (action) next[courseId] = action;
    else delete next[courseId];
    busyActionsRef.current = next;
    setBusyActions(next);
  }

  async function load(requestedPage = page, requestedFilters = filtersRef.current) {
    const requestSequence = ++loadSequenceRef.current;
    loadControllerRef.current?.abort();
    const requestController = new AbortController();
    loadControllerRef.current = requestController;
    const currentFilters = { ...requestedFilters };
    setLoading(true); setError(''); setFailedRequest(null);
    try {
      const params = new URLSearchParams();
      if (currentFilters.status !== 'all') params.set('status', currentFilters.status);
      if (currentFilters.query.trim()) params.set('q', currentFilters.query.trim());
      params.set('page', String(requestedPage));
      const response = await api.get<CourseListResponse>(`/api/manage/courses?${params}`, { signal: requestController.signal });
      if (requestSequence === loadSequenceRef.current) {
        setCourses(response.courses); setTotal(response.total); setPage(response.page); setPageSize(response.pageSize);
      }
    } catch (cause) {
      if (requestSequence === loadSequenceRef.current) {
        setError(cause instanceof ApiError ? cause.message : 'Courses could not be loaded.');
        setFailedRequest({ page: requestedPage, ...currentFilters });
      }
    } finally {
      if (loadControllerRef.current === requestController) loadControllerRef.current = null;
      if (requestSequence === loadSequenceRef.current) setLoading(false);
    }
  }
  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextQuery = query.trim();
    setAppliedQuery(nextQuery);
    void load(1, { query: nextQuery, status });
  }
  useEffect(() => {
    load(1);
    return () => {
      loadSequenceRef.current += 1;
      loadControllerRef.current?.abort();
      loadControllerRef.current = null;
    };
  }, [status]);

  async function changeStatus(course: Course, nextStatus: Course['status']) {
    if (busyActionsRef.current[course.id]) return;
    const action: CourseRowAction = nextStatus === 'published' ? 'publish' : nextStatus === 'draft' ? 'unpublish' : 'archive';
    markCourseAction(course.id, action); setError('');
    try { await api.patch(`/api/manage/courses/${course.id}`, { status: nextStatus, ...(nextStatus === 'draft' ? { unpublish: true } : {}) }); await load(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Course status could not be changed.'); }
    finally { markCourseAction(course.id, null); }
  }

  async function deleteCourse(course: Course) {
    if (busyActionsRef.current[course.id]) return;
    if (!window.confirm(`Permanently delete “${course.title}” and its uploaded media? This cannot be undone.`)) return;
    markCourseAction(course.id, 'delete'); setError('');
    try { await api.delete(`/api/manage/courses/${course.id}`); await load(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Course could not be deleted.'); }
    finally { markCourseAction(course.id, null); }
  }

  const tabs = [
    { label: 'All courses', value: 'all' }, { label: 'Published', value: 'published' },
    { label: 'Drafts', value: 'draft' }, { label: 'Archived', value: 'archived' },
  ];
  const emptyCourseState = appliedQuery
    ? { title: 'No matching courses', detail: 'Try another search term or choose a different status filter.' }
    : status === 'published'
      ? { title: 'No published courses', detail: 'Courses published for learners will appear here.' }
      : status === 'draft'
        ? { title: 'No draft courses', detail: 'Courses saved as drafts will appear here.' }
        : status === 'archived'
          ? { title: 'No archived courses', detail: 'Courses you archive will appear here.' }
          : { title: 'Your course catalog is ready', detail: 'Create a course, add modules and video lessons, then publish it for learners.' };
  const hasEmptyCourseResult = !loading && !failedRequest && courses.length === 0;
  return <div className="management-page">
    <PageHeading title="Courses" action={<Link className="button button-primary" to="/manage/courses/new"><Plus size={18} />Create course</Link>} />
    <div className="management-tabs" role="group" aria-label="Filter courses by status">
      {tabs.map((tab) => <button type="button" key={tab.value} aria-pressed={status === tab.value} className={status === tab.value ? 'active' : ''} onClick={() => setStatus(tab.value)}>{tab.label}</button>)}
    </div>
    <form className="management-search" onSubmit={submitSearch}><Search size={19} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search courses" aria-label="Search courses" maxLength={120} /><button type="submit">Search</button></form>
    {error && (failedRequest
      ? <div className="course-list-error"><Notice>{error}</Notice><Button type="button" variant="secondary" onClick={() => { void load(failedRequest.page, failedRequest); }}>Try again</Button></div>
      : <Notice>{error}</Notice>)}
    {hasEmptyCourseResult && <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{emptyCourseState.title}. {emptyCourseState.detail}</p>}
    {loading ? <div className="page-loading" role="status" aria-live="polite">Loading courses…</div> : failedRequest ? null : courses.length ? <div className="course-table-wrap" role="region" aria-label="Scrollable course list" tabIndex={0}><p className="table-scroll-hint">Scroll horizontally to see all course columns.</p><table className="course-table"><caption className="sr-only">Courses</caption><thead><tr><th scope="col">Course</th><th scope="col">Owner</th><th scope="col">Visibility</th><th scope="col">Status</th><th scope="col">Updated</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead><tbody>
      {courses.map((course) => {
        const busyAction = busyActions[course.id];
        return <tr key={course.id}>
        <td><div className="table-course"><span className="table-thumb"><ImageWithFallback src={course.coverUrl} className="table-cover-image" alt="" loading="lazy" decoding="async" fallback={<BookOpen size={20} />} /></span><div><Link to={`/manage/courses/${course.id}/edit`}>{course.title}</Link><small>{course.category}</small></div></div></td>
        <td><span className="owner-cell"><UserInitial username={course.owner || ''} />{course.owner}</span></td>
        <td><VisibilityLabel visibility={course.visibility} /></td>
        <td><div className="course-list-status"><CourseStatus status={course.status} />{course.hasUnpublishedChanges && <CourseRevisionBadge status={course.reviewStatus} />}{busyAction && <span className="course-list-action-status" role="status" aria-live="polite" aria-atomic="true">{courseRowActionStatus(busyAction)}</span>}</div></td>
        <td><DateText value={course.updatedAt} /></td>
        <td><div className="table-actions"><Link className="text-action" to={`/manage/courses/${course.id}/edit`}>Edit</Link><Link className="text-action" to={`/manage/courses/${course.id}/analytics`}>Analytics</Link><CourseRowMenu course={course} busyAction={busyAction} onStatusChange={changeStatus} onDelete={deleteCourse} /></div></td>
        </tr>;
      })}
    </tbody></table></div> : <EmptyState title={emptyCourseState.title} detail={emptyCourseState.detail} action={status === 'all' && !appliedQuery && <Link className="button button-primary" to="/manage/courses/new"><Plus size={17} />Create course</Link>} />}
    {!loading && !failedRequest && total > 0 && <LogPagination page={page} pageSize={pageSize} total={total} loading={loading} onChange={(nextPage) => load(nextPage)} />}
  </div>;
}

function Percentage({ value }: { value: number }) {
  return <span className="analytics-percentage">{value}%</span>;
}

export function CourseAnalyticsPage() {
  const { courseId = '' } = useParams();
  const [data, setData] = useState<CourseAnalytics | null>(null);
  const [page, setPage] = useState(1);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [failedPage, setFailedPage] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setData(null); setError(''); setFailedPage(null); setLoading(true);
    api.get<CourseAnalytics>(`/api/manage/courses/${courseId}/analytics?page=${page}`, { signal: controller.signal })
      .then((result) => { if (active) { setData(result); setPage(result.page); } })
      .catch((cause) => { if (active) { setError(cause instanceof ApiError ? cause.message : 'Course analytics could not be loaded.'); setFailedPage(page); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [courseId, page, refreshVersion]);

  if (data && data.course.id !== courseId) return <div className="management-page page-loading" role="status" aria-live="polite">Loading course analytics…</div>;

  return <div className="management-page analytics-page">
    <div className="breadcrumbs"><Link to="/manage/courses">Courses</Link><span>/</span><span>Course dashboard</span></div>
    <PageHeading title={data?.course.title || 'Course dashboard'} subtitle="Learner progress and assessment performance across this course." action={<div className="analytics-heading-actions"><Link className="button button-secondary" to={`/manage/courses/${courseId}/access`}>Assign learners</Link><Link className="button button-secondary" to={`/manage/courses/${courseId}/edit`}>Edit course</Link></div>} />
    {error && <><Notice>{error}</Notice><Button variant="secondary" onClick={() => setRefreshVersion((version) => version + 1)}>Try again</Button></>}
    {loading ? <div className="page-loading" role="status" aria-live="polite">Loading course analytics…</div> : !failedPage && data && <>
      <div className="analytics-course-context"><CourseStatus status={data.course.status} /><VisibilityLabel visibility={data.course.visibility} /><span>{data.course.category}</span><span>{formatCountLabel(data.summary.learnerCount, 'learner', 'learners')} enrolled or assigned{data.summary.disabledLearnerCount ? ` · ${formatCountLabel(data.summary.disabledLearnerCount, 'learner', 'learners')} disabled` : ''}</span></div>
      <section className="analytics-kpi-grid" aria-label="Course summary metrics">
        <article className="analytics-kpi"><span>Completion rate</span><strong>{data.summary.completionRate === null ? '—' : `${data.summary.completionRate}%`}</strong><small>{data.summary.completedLearnerCount} of {formatCountLabel(data.summary.learnerCount, 'learner', 'learners')} completed</small></article>
        <article className="analytics-kpi"><span>Average progress</span><strong>{data.summary.averageProgress === null ? '—' : `${data.summary.averageProgress}%`}</strong><small>Across enrolled and assigned learners</small></article>
        <article className="analytics-kpi"><span>Started learning</span><strong>{data.summary.startedLearnerCount}</strong><small>At least one lesson or quiz activity</small></article>
        <article className="analytics-kpi"><span>Learning activity</span><strong>{data.summary.lessonCompletions + data.summary.quizAttempts}</strong><small>{formatCountLabel(data.summary.lessonCompletions, 'lesson completion', 'lesson completions')} · {formatCountLabel(data.summary.quizAttempts, 'quiz attempt', 'quiz attempts')}</small></article>
      </section>

      <section className="analytics-section">
        <div className="analytics-section-heading"><div><h2>Lesson completion</h2><p>Completion is measured against all enrolled and assigned learners.</p></div><span>{formatCountLabel(data.summary.lessonCount, 'lesson', 'lessons')}</span></div>
        {data.lessonMetrics.length ? <div className="analytics-table-wrap" role="region" aria-label="Scrollable lesson completion metrics" tabIndex={0}><table className="analytics-table"><caption className="sr-only">Lesson completion metrics</caption><thead><tr><th scope="col">Module</th><th scope="col">Lesson</th><th scope="col">Completed</th><th scope="col">Rate</th></tr></thead><tbody>{data.lessonMetrics.map((lesson) => <tr key={lesson.id}><td>{lesson.moduleTitle}</td><td><strong>{lesson.title}</strong></td><td>{lesson.completedCount} / {data.summary.learnerCount}</td><td>{lesson.completionRate === null ? '—' : <div className="analytics-rate-cell"><ProgressBar value={lesson.completionRate} label={`Completion rate for ${lesson.title}`} /><Percentage value={lesson.completionRate} /></div>}</td></tr>)}</tbody></table></div> : <EmptyState headingLevel={3} title="No lessons yet" detail="Add lessons to the course curriculum to see completion metrics." />}
      </section>

      <section className="analytics-section">
        <div className="analytics-section-heading"><div><h2>Quiz performance</h2><p>Pass rates use learners who attempted each quiz; average scores use all attempts.</p></div><span>{formatCountLabel(data.summary.quizCount, 'quiz', 'quizzes')}</span></div>
        {data.quizMetrics.length ? <div className="analytics-table-wrap" role="region" aria-label="Scrollable quiz performance metrics" tabIndex={0}><table className="analytics-table"><caption className="sr-only">Quiz performance metrics</caption><thead><tr><th scope="col">Module</th><th scope="col">Quiz</th><th scope="col">Participation</th><th scope="col">Passed</th><th scope="col">Pass rate</th><th scope="col">Average score</th><th scope="col">Attempts</th></tr></thead><tbody>{data.quizMetrics.map((quiz) => <tr key={quiz.id}><td>{quiz.moduleTitle}</td><td><strong>{quiz.title}</strong><small>Pass mark {quiz.passMark}%</small></td><td>{formatCountLabel(quiz.learnersAttempted, 'learner', 'learners')} · {quiz.participationRate === null ? '—' : `${quiz.participationRate}%`}</td><td>{quiz.learnersPassed} / {quiz.learnersAttempted}</td><td>{quiz.passRate === null ? '—' : <Percentage value={quiz.passRate} />}</td><td>{quiz.averageScore === null ? '—' : `${quiz.averageScore}%`}</td><td>{quiz.attempts}</td></tr>)}</tbody></table></div> : <EmptyState headingLevel={3} title="No quizzes yet" detail="Add module quizzes to see participation and score metrics." />}
      </section>

      <section className="analytics-section analytics-learners-section">
        <div className="analytics-section-heading"><div><h2>Learner progress</h2><p>Per-person lesson completion, quiz attempts, and course completion.</p></div><span>{formatCountLabel(data.summary.learnerCount, 'learner', 'learners')}</span></div>
        {data.learners.length ? <div className="analytics-table-wrap analytics-learners-table-wrap" role="region" aria-label="Scrollable learner progress" tabIndex={0}><table className="analytics-table analytics-learners-table"><caption className="sr-only">Learner-level course progress</caption><thead><tr><th scope="col">Learner</th><th scope="col">Progress</th><th scope="col">Lessons</th><th scope="col">Quizzes passed</th><th scope="col">Last activity</th><th scope="col">Status</th></tr></thead><tbody>{data.learners.map((learner) => <tr key={learner.id}>
          <td>
            <strong>{learner.username}</strong>
            {learner.disabled && <small className="analytics-disabled-label">Disabled account</small>}
            <details className="analytics-learner-details">
              <summary aria-label={`View activity details for ${learner.username}`}>View activity details</summary>
              <div className="analytics-detail-grid">
                <section>
                  <h3 id={`learner-${learner.id}-lesson-progress`}>Lesson progress</h3>
                  <ul tabIndex={0} aria-labelledby={`learner-${learner.id}-lesson-progress`}>
                    {learner.lessonProgress.map((lesson) => <li key={lesson.id}>
                      <span className={lesson.completed ? 'analytics-item-complete' : ''}>{lesson.completed ? 'Complete' : 'Not complete'}</span>
                      <strong>{lesson.moduleTitle}: {lesson.title}</strong>
                      {lesson.completedAt && <small><DateText value={lesson.completedAt} /></small>}
                    </li>)}
                  </ul>
                </section>
                <section>
                  <h3 id={`learner-${learner.id}-quiz-attempts`}>Quiz attempts</h3>
                  {learner.quizProgress.length ? <ul tabIndex={0} aria-labelledby={`learner-${learner.id}-quiz-attempts`}>
                    {learner.quizProgress.map((quiz) => <li key={quiz.id}>
                      <span className={quiz.passed ? 'analytics-item-complete' : ''}>{quiz.attempts ? `${quiz.attempts} attempt${quiz.attempts === 1 ? '' : 's'}` : 'Not attempted'}</span>
                      <strong>{quiz.moduleTitle}: {quiz.title}</strong>
                      <small>{quiz.attempts ? `Latest ${quiz.latestScore}% · Best ${quiz.highestScore}% · Pass mark ${quiz.passMark}%` : `Pass mark ${quiz.passMark}%`}</small>
                    </li>)}
                  </ul> : <p>This course has no quizzes.</p>}
                </section>
              </div>
            </details>
          </td>
          <td><div className="analytics-rate-cell"><ProgressBar value={learner.progress} label={`Course progress for ${learner.username}`} /><Percentage value={learner.progress} /></div></td>
          <td>{learner.completedLessonCount} / {learner.lessonCount}</td>
          <td>{learner.passedQuizCount} / {learner.quizCount}</td>
          <td>{learner.lastActivityAt ? <DateText value={learner.lastActivityAt} /> : '—'}</td>
          <td><span className={`analytics-learner-state ${learner.completed ? 'is-complete' : learner.started ? 'is-started' : ''}`}>{learner.completed ? 'Completed' : learner.started ? 'In progress' : 'Not started'}</span></td>
        </tr>)}</tbody></table></div> : <EmptyState headingLevel={3} title="No learners assigned or enrolled" detail="Assign learners to this course or wait for learners to open it." action={<Link className="button button-primary" to={`/manage/courses/${courseId}/access`}>Assign learners</Link>} />}
        {data.summary.learnerCount > 0 && <LogPagination page={data.page} pageSize={data.pageSize} total={data.summary.learnerCount} loading={loading} onChange={setPage} />}
      </section>
    </>}
  </div>;
}

function QuizEditor({ module, onSaved, onError }: { module: CourseModule; onSaved: () => void | Promise<void>; onError: (message: string) => void }) {
  const existing = module.quiz;
  const [title, setTitle] = useState(existing?.title || `${module.title} quiz`);
  const [passMark, setPassMark] = useState(existing?.passMark ?? 70);
  const [questions, setQuestions] = useState<EditableQuizQuestion[]>(existing?.questions || []);
  const [busyAction, setBusyAction] = useState<'save' | 'remove' | null>(null);
  const [focusTarget, setFocusTarget] = useState<{ questionIndex: number; choiceIndex?: number } | null>(null);
  const [showTextValidation, setShowTextValidation] = useState(false);
  const editorKeySequenceRef = useRef(0);
  const questionInputRefs = useRef<Array<HTMLTextAreaElement | null>>([]);
  const choiceInputRefs = useRef<Array<Array<HTMLInputElement | null>>>([]);
  const addQuestionButtonRef = useRef<HTMLButtonElement | null>(null);
  const quizContext = `${module.title} quiz (module ${module.position + 1})`;

  function nextEditorKey(kind: 'question' | 'choice') {
    editorKeySequenceRef.current += 1;
    return `quiz-editor-${kind}-${editorKeySequenceRef.current}`;
  }

  useEffect(() => {
    setTitle(existing?.title || `${module.title} quiz`);
    setPassMark(existing?.passMark ?? 70);
    setQuestions(existing?.questions || []);
  }, [module.id, module.title, existing?.id]);

  const normalizedQuestions = (items: EditableQuizQuestion[]) => JSON.stringify(items.map((question) => ({
    prompt: question.prompt.trim(),
    explanation: (question.explanation || '').trim(),
    choices: question.choices.map((choice) => ({ text: choice.text.trim(), isCorrect: choice.isCorrect === true })),
  })));
  const hasChanges = !existing
    || title.trim() !== existing.title.trim()
    || Number(passMark) !== existing.passMark
    || normalizedQuestions(questions) !== normalizedQuestions(existing.questions);
  const textValidationIssue = showTextValidation ? firstQuizTextIssue(questions) : null;

  useEffect(() => {
    if (!focusTarget) return;
    if (focusTarget.choiceIndex !== undefined) {
      const choices = questions[focusTarget.questionIndex]?.choices;
      if (choices?.length) {
        choiceInputRefs.current[focusTarget.questionIndex]?.[Math.min(focusTarget.choiceIndex, choices.length - 1)]?.focus();
      }
    } else {
      const questionIndex = Math.min(focusTarget.questionIndex, questions.length - 1);
      if (questionIndex >= 0) questionInputRefs.current[questionIndex]?.focus();
      else addQuestionButtonRef.current?.focus();
    }
    setFocusTarget(null);
  }, [focusTarget, questions]);

  function updateQuestion(index: number, patch: Partial<QuizQuestion>) {
    setShowTextValidation(false);
    setQuestions((current) => current.map((question, itemIndex) => itemIndex === index ? { ...question, ...patch } : question));
  }
  function updateChoice(questionIndex: number, choiceIndex: number, patch: { text?: string; isCorrect?: boolean }) {
    setShowTextValidation(false);
    setQuestions((current) => current.map((question, itemIndex) => {
      if (itemIndex !== questionIndex) return question;
      return { ...question, choices: question.choices.map((choice, itemChoice) => ({ ...choice, ...(itemChoice === choiceIndex ? patch : {}), ...(patch.isCorrect && itemChoice !== choiceIndex ? { isCorrect: false } : {}) })) };
    }));
  }
  function addQuestion() {
    const questionIndex = questions.length;
    const question: EditableQuizQuestion = {
      editorKey: nextEditorKey('question'),
      prompt: '',
      choices: [
        { editorKey: nextEditorKey('choice'), text: '', isCorrect: true },
        { editorKey: nextEditorKey('choice'), text: '', isCorrect: false },
      ],
    };
    setShowTextValidation(false);
    setQuestions((current) => [...current, question]);
    setFocusTarget({ questionIndex });
  }
  function addChoice(questionIndex: number) {
    const choiceIndex = questions[questionIndex].choices.length;
    updateQuestion(questionIndex, { choices: [...questions[questionIndex].choices, { editorKey: nextEditorKey('choice'), text: '', isCorrect: false }] });
    setFocusTarget({ questionIndex, choiceIndex });
  }
  function removeQuestion(index: number) {
    setShowTextValidation(false);
    setQuestions((current) => current.filter((_, itemIndex) => itemIndex !== index));
    setFocusTarget({ questionIndex: index });
  }
  function removeChoice(questionIndex: number, choiceIndex: number) {
    updateQuestion(questionIndex, { choices: questions[questionIndex].choices.filter((_, index) => index !== choiceIndex) });
    setFocusTarget({ questionIndex, choiceIndex });
  }
  async function save() {
    if (busyAction || !hasChanges) return;
    const missingText = firstQuizTextIssue(questions);
    if (missingText) {
      setShowTextValidation(true);
      setFocusTarget(missingText);
      return;
    }
    setBusyAction('save');
    try {
      const savedQuestions = questions.map(({ prompt, explanation, choices }) => ({
        prompt,
        explanation,
        choices: choices.map(({ text, isCorrect }) => ({ text, isCorrect })),
      }));
      await api.put(`/api/manage/modules/${module.id}/quiz`, { title, passMark: Number(passMark), questions: savedQuestions });
      await onSaved();
    } catch (cause) { onError(cause instanceof ApiError ? cause.message : 'Quiz could not be saved.'); }
    finally { setBusyAction(null); }
  }
  async function remove() {
    if (!existing || busyAction || !window.confirm('Remove this quiz from the module? Saved attempts will also be removed.')) return;
    setBusyAction('remove');
    try { await api.delete(`/api/manage/modules/${module.id}/quiz`); await onSaved(); }
    catch (cause) { onError(cause instanceof ApiError ? cause.message : 'Quiz could not be removed.'); }
    finally { setBusyAction(null); }
  }

  return <div className="quiz-editor" aria-busy={busyAction !== null}>
    <div className="quiz-editor-head"><div><span className="editor-type"><CircleHelp size={15} />Module quiz</span><h4>{existing ? 'Edit quiz' : 'Add a quiz'}</h4></div>{existing && <button type="button" className="icon-button danger-icon" aria-label={busyAction === 'remove' ? `Removing ${quizContext}` : `Remove ${quizContext}`} disabled={busyAction !== null} onClick={remove}><Trash2 size={16} /></button>}</div>
    {textValidationIssue && <Notice>Enter text for every quiz question and answer choice before saving.</Notice>}
    <fieldset className="quiz-editor-fields" aria-label={`Fields for ${quizContext}`} disabled={busyAction !== null}>
    <div className="quiz-settings-row"><label>Quiz title<input aria-label={`Quiz title for ${quizContext}`} value={title} maxLength={quizTitleLimit} onChange={(event) => setTitle(event.target.value)} /></label><div className="app-select-field"><span>Pass mark</span><AppSelect<number> ariaLabel={`Pass mark for ${quizContext}`} value={passMark} onChange={setPassMark} options={[50, 60, 70, 80, 90, 100].map((value) => ({ value, label: `${value}%` }))} /></div></div>
    {questions.map((question, questionIndex) => <div className="question-editor" key={question.id || question.editorKey || questionIndex}>
      <div className="question-editor-head"><span>Question {questionIndex + 1}</span><button type="button" className="text-action danger-text" aria-label={`Remove question ${questionIndex + 1} from ${quizContext}`} onClick={() => removeQuestion(questionIndex)}>Remove</button></div>
      <label className="sr-only" htmlFor={`question-${module.id}-${questionIndex}`}>Question {questionIndex + 1} text for {quizContext}</label><textarea ref={(node) => { questionInputRefs.current[questionIndex] = node; }} id={`question-${module.id}-${questionIndex}`} rows={2} maxLength={1000} placeholder="Write a question" value={question.prompt} onChange={(event) => updateQuestion(questionIndex, { prompt: event.target.value })} aria-invalid={textValidationIssue?.questionIndex === questionIndex && textValidationIssue.choiceIndex === undefined || undefined} aria-describedby={textValidationIssue?.questionIndex === questionIndex && textValidationIssue.choiceIndex === undefined ? `quiz-question-error-${module.id}-${questionIndex}` : undefined} />
      {textValidationIssue?.questionIndex === questionIndex && textValidationIssue.choiceIndex === undefined && <span className="sr-only" id={`quiz-question-error-${module.id}-${questionIndex}`}>Enter text for question {questionIndex + 1}.</span>}
      <fieldset className="quiz-answer-fieldset" aria-describedby={`correct-answer-hint-${module.id}-${questionIndex}`}>
        <legend className="sr-only">Correct answer for question {questionIndex + 1} in {quizContext}</legend>
        <p className="form-hint" id={`correct-answer-hint-${module.id}-${questionIndex}`}>Select one correct answer. Each question needs two to six answer choices.</p>
        {question.choices.map((choice, choiceIndex) => <div className="choice-editor-row" key={choice.id || choice.editorKey || choiceIndex}><input type="radio" name={`correct-${module.id}-${questionIndex}`} checked={Boolean(choice.isCorrect)} onChange={() => updateChoice(questionIndex, choiceIndex, { isCorrect: true })} aria-label={`Mark answer choice ${choiceIndex + 1} correct for question ${questionIndex + 1} in ${quizContext}`} /><input ref={(node) => { choiceInputRefs.current[questionIndex] ??= []; choiceInputRefs.current[questionIndex][choiceIndex] = node; }} value={choice.text} maxLength={500} onChange={(event) => updateChoice(questionIndex, choiceIndex, { text: event.target.value })} aria-label={`Answer choice ${choiceIndex + 1} for question ${questionIndex + 1} in ${quizContext}`} placeholder={`Answer ${choiceIndex + 1}`} aria-invalid={textValidationIssue?.questionIndex === questionIndex && textValidationIssue.choiceIndex === choiceIndex || undefined} aria-describedby={textValidationIssue?.questionIndex === questionIndex && textValidationIssue.choiceIndex === choiceIndex ? `quiz-choice-error-${module.id}-${questionIndex}-${choiceIndex}` : undefined} /><button type="button" className="icon-button danger-icon" aria-label={`Remove answer choice ${choiceIndex + 1} from question ${questionIndex + 1} in ${quizContext}`} disabled={question.choices.length <= 2} onClick={() => removeChoice(questionIndex, choiceIndex)}><Trash2 size={15} /></button>{textValidationIssue?.questionIndex === questionIndex && textValidationIssue.choiceIndex === choiceIndex && <span className="sr-only" id={`quiz-choice-error-${module.id}-${questionIndex}-${choiceIndex}`}>Enter text for answer choice {choiceIndex + 1}.</span>}</div>)}
      </fieldset>
      {question.choices.length < 6 && <button className="text-action add-choice" type="button" aria-label={`Add answer choice to question ${questionIndex + 1} in ${quizContext}`} onClick={() => addChoice(questionIndex)}><Plus size={15} />Add answer choice</button>}
      <label className="explanation-label">Explanation (optional)<input aria-label={`Explanation (optional) for question ${questionIndex + 1} in ${quizContext}`} value={question.explanation || ''} maxLength={1000} onChange={(event) => updateQuestion(questionIndex, { explanation: event.target.value })} /></label>
    </div>)}
    <div className="quiz-editor-actions">
      <button ref={addQuestionButtonRef} className="text-action" type="button" aria-label={questions.length >= 50 ? `Question limit reached for ${quizContext}` : `Add question to ${quizContext}`} disabled={busyAction !== null || questions.length >= 50} onClick={addQuestion}><Plus size={16} />{questions.length >= 50 ? 'Question limit reached' : 'Add question'}</button>
      <Button variant="secondary" type="button" aria-label={busyAction === 'save' ? `Saving quiz ${quizContext}` : hasChanges ? `Save quiz ${quizContext}` : `No changes to ${quizContext}`} disabled={busyAction !== null || !hasChanges} onClick={save}>{busyAction === 'save' ? 'Saving quiz…' : hasChanges ? 'Save quiz' : 'No changes'}</Button>
    </div>
    </fieldset>
  </div>;
}

function LessonDetailsEditor({ lesson, courseId, beforeChange, onChanged, onClose, onError, onNotice }: {
  lesson: Lesson;
  courseId: string;
  beforeChange: () => Promise<void>;
  onChanged: () => Promise<void>;
  onClose: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const documentFormatHelpId = useId();
  const [title, setTitle] = useState(lesson.title);
  const [description, setDescription] = useState(lesson.description);
  const [transcript, setTranscript] = useState(lesson.transcript);
  const [resources, setResources] = useState<LessonResource[]>(lesson.resources || []);
  const [captions, setCaptions] = useState<LessonCaption[]>(lesson.captions || []);
  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkUrlError, setLinkUrlError] = useState('');
  const [captionLanguage, setCaptionLanguage] = useState('');
  const [captionLanguageError, setCaptionLanguageError] = useState('');
  const [captionLabel, setCaptionLabel] = useState('');
  const [captionFile, setCaptionFile] = useState<File | null>(null);
  const [captionFileError, setCaptionFileError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadKind, setUploadKind] = useState<'document' | 'captions' | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const uploadControllerRef = useRef<{ controller: AbortController; input: HTMLInputElement; cancelledByUser: boolean } | null>(null);
  const linkUrlInputRef = useRef<HTMLInputElement>(null);
  const captionInputRef = useRef<HTMLInputElement>(null);
  const captionLanguageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTitle(lesson.title);
    setDescription(lesson.description);
    setTranscript(lesson.transcript);
    setResources(lesson.resources || []);
    setCaptions(lesson.captions || []);
  }, [lesson.id, lesson.title, lesson.description, lesson.transcript, lesson.resources, lesson.captions]);
  useEffect(() => () => { uploadControllerRef.current?.controller.abort(); }, [lesson.id]);

  async function persistLessonDetails() {
    const cleanTitle = title.trim();
    if (!cleanTitle) throw new ApiError(400, 'Lesson title is required.');
    await beforeChange();
    await api.patch(`/api/manage/lessons/${lesson.id}`, { title: cleanTitle, description, transcript });
    setTitle(cleanTitle);
  }

  async function saveDetails(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); onError('');
    try {
      await persistLessonDetails();
      await onChanged();
      onNotice('Lesson details saved.');
    } catch (cause) { onError(cause instanceof ApiError ? cause.message : 'Lesson details could not be saved.'); }
    finally { setBusy(false); }
  }

  async function addLink(event: React.FormEvent) {
    event.preventDefault();
    if (!linkTitle.trim() || !linkUrl.trim()) return;
    const urlError = lessonResourceUrlError(linkUrl);
    if (urlError) {
      setLinkUrlError(urlError);
      linkUrlInputRef.current?.focus();
      return;
    }
    setLinkUrlError('');
    setBusy(true); onError('');
    try {
      await persistLessonDetails();
      const { resource } = await api.post<{ resource: LessonResource }>(`/api/manage/lessons/${lesson.id}/resources`, { title: linkTitle.trim(), url: linkUrl.trim() });
      setResources((current) => [...current, resource]);
      await onChanged();
      setLinkTitle(''); setLinkUrl('');
      onNotice('Lesson link added.');
    } catch (cause) { onError(cause instanceof ApiError ? cause.message : 'Lesson link could not be added.'); }
    finally { setBusy(false); }
  }

  async function uploadDocument(file: File, input: HTMLInputElement) {
    const upload = { controller: new AbortController(), input, cancelledByUser: false };
    uploadControllerRef.current = upload;
    setBusy(true); setUploadKind('document'); setUploadProgress(0); onError('');
    try {
      await persistLessonDetails();
      if (upload.controller.signal.aborted) return;
      const titleFromFile = truncateUtf16CodeUnits(file.name.replace(/\.[^.]+$/, '').trim() || file.name, quizTitleLimit);
      const { resource } = await api.upload<{ resource: LessonResource }>(`/api/manage/courses/${courseId}/lesson-documents`, {
        kind: 'document', lessonId: lesson.id, title: titleFromFile,
      }, file, setUploadProgress, { signal: upload.controller.signal });
      if (upload.controller.signal.aborted) return;
      setResources((current) => [...current, resource]);
      await onChanged();
      if (!upload.controller.signal.aborted) onNotice(`${file.name} attached to this lesson.`);
    } catch (cause) {
      if (!upload.controller.signal.aborted) onError(cause instanceof ApiError ? cause.message : 'Document could not be uploaded.');
    } finally {
      if (uploadControllerRef.current === upload) uploadControllerRef.current = null;
      setBusy(false); setUploadKind(null); setUploadProgress(null);
      if (upload.cancelledByUser) requestAnimationFrame(() => { if (upload.input.isConnected) upload.input.focus(); });
    }
  }

  function cancelUpload() {
    const upload = uploadControllerRef.current;
    if (!upload) return;
    upload.cancelledByUser = true;
    upload.controller.abort();
  }

  async function uploadCaptions(event: React.FormEvent) {
    event.preventDefault();
    if (!captionFile || !captionLanguage.trim() || !captionLabel.trim()) return;
    const language = canonicalCaptionLanguageTag(captionLanguage);
    if (!language) {
      setCaptionLanguageError(captionLanguageErrorMessage);
      captionLanguageInputRef.current?.focus();
      return;
    }
    const fileError = captionFileSizeError(captionFile.size);
    if (fileError) {
      setCaptionFileError(fileError);
      captionInputRef.current?.focus();
      return;
    }
    const input = captionInputRef.current;
    if (!input) return;
    const upload = { controller: new AbortController(), input, cancelledByUser: false };
    uploadControllerRef.current = upload;
    setCaptionLanguageError('');
    setBusy(true); setUploadKind('captions'); setUploadProgress(0); onError('');
    try {
      await persistLessonDetails();
      if (upload.controller.signal.aborted) return;
      const { caption } = await api.upload<{ caption: LessonCaption }>(`/api/manage/courses/${courseId}/lesson-captions`, {
        lessonId: lesson.id, language, label: captionLabel.trim(),
      }, captionFile, setUploadProgress, { signal: upload.controller.signal });
      if (upload.controller.signal.aborted) return;
      setCaptions((current) => [...current.filter((item) => item.language.toLowerCase() !== caption.language.toLowerCase()), caption]
        .sort((a, b) => a.language.localeCompare(b.language)));
      await onChanged();
      if (!upload.controller.signal.aborted) onNotice(`${caption.label} captions uploaded.`);
      setCaptionFile(null);
      setCaptionLanguage('');
      setCaptionLabel('');
      if (input) input.value = '';
    } catch (cause) {
      if (!upload.controller.signal.aborted) onError(cause instanceof ApiError ? cause.message : 'Captions could not be uploaded.');
    } finally {
      if (uploadControllerRef.current === upload) uploadControllerRef.current = null;
      setBusy(false); setUploadKind(null); setUploadProgress(null);
      if (upload.cancelledByUser) requestAnimationFrame(() => { if (upload.input.isConnected) upload.input.focus(); });
    }
  }

  async function removeResource(resource: LessonResource) {
    if (!window.confirm(`Remove “${resource.title}” from this lesson?`)) return;
    setBusy(true); onError('');
    try {
      await persistLessonDetails();
      await api.delete(`/api/manage/lessons/${lesson.id}/resources/${resource.id}`);
      setResources((current) => current.filter((item) => item.id !== resource.id));
      await onChanged();
      onNotice('Lesson resource removed.');
    } catch (cause) { onError(cause instanceof ApiError ? cause.message : 'Lesson resource could not be removed.'); }
    finally { setBusy(false); }
  }

  async function removeCaption(caption: LessonCaption) {
    if (!window.confirm(`Remove “${caption.label}” captions (${caption.language}) from this lesson?`)) return;
    setBusy(true); onError('');
    try {
      await persistLessonDetails();
      await api.delete(`/api/manage/lessons/${lesson.id}/captions/${caption.id}`);
      setCaptions((current) => current.filter((item) => item.id !== caption.id));
      await onChanged();
      onNotice('Caption track removed.');
    } catch (cause) { onError(cause instanceof ApiError ? cause.message : 'Caption track could not be removed.'); }
    finally { setBusy(false); }
  }

  return <section id={`lesson-details-${lesson.id}`} className="lesson-details-editor" aria-labelledby={`lesson-details-heading-${lesson.id}`} aria-busy={busy}>
    <div className="lesson-details-heading"><div><h3 id={`lesson-details-heading-${lesson.id}`}>Lesson details</h3><span>Set what learners will see for this lesson.</span></div><button type="button" className="text-action" onClick={onClose} disabled={busy}>Close</button></div>
    <form className="lesson-details-form" onSubmit={saveDetails}>
      <div className="lesson-details-grid">
        <label>Lesson title<input value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} required disabled={busy} /></label>
        <label>Lesson description<textarea value={description} maxLength={2000} rows={3} onChange={(event) => setDescription(event.target.value)} placeholder="Add context, learning goals, or notes for this lesson." disabled={busy} /></label>
        <label className="lesson-transcript-field">Lesson transcript<textarea value={transcript} maxLength={50000} rows={7} aria-describedby={`lesson-transcript-help-${lesson.id}`} onChange={(event) => setTranscript(event.target.value)} placeholder="Paste the spoken words and meaningful audio cues from this lesson." disabled={busy} /><small id={`lesson-transcript-help-${lesson.id}`}>Optional plain text that learners can expand in the lesson player. {transcript.length}/50,000 characters.</small></label>
      </div>
      <div className="lesson-details-save"><Button type="submit" variant="secondary" disabled={busy}>{busy ? 'Saving…' : 'Save lesson details'}</Button></div>
    </form>

    <section className="lesson-resource-editor" aria-labelledby={`lesson-resource-heading-${lesson.id}`}>
      <div className="lesson-resource-heading"><div><h4 id={`lesson-resource-heading-${lesson.id}`}>Links and documents</h4><span>These resources will be available to learners alongside the lesson.</span></div></div>
      {resources.length ? <ul className="lesson-resource-list">{resources.map((resource) => <li className="lesson-resource-row" key={resource.id}>
        {resource.kind === 'link' ? <Link2 size={16} /> : <FileText size={16} />}
        <div><strong>{resource.title}</strong><small>{resource.kind === 'document' ? resource.fileName : resource.url}</small></div>
        <button type="button" className="icon-button danger-icon" title={`Remove ${resource.title}`} aria-label={`Remove ${resource.title}`} disabled={busy} onClick={() => removeResource(resource)}><Trash2 size={15} /></button>
      </li>)}</ul> : <p className="lesson-resource-empty">No resources added yet.</p>}
      <form className="lesson-link-form" onSubmit={addLink}>
        <label>Link title<input value={linkTitle} maxLength={160} onChange={(event) => setLinkTitle(event.target.value)} placeholder="e.g. Reference guide" required disabled={busy} /></label>
        <label>Link URL<input ref={linkUrlInputRef} type="url" value={linkUrl} maxLength={2048} aria-invalid={linkUrlError ? true : undefined} aria-describedby={linkUrlError ? `lesson-link-url-help-${lesson.id} lesson-link-url-error-${lesson.id}` : `lesson-link-url-help-${lesson.id}`} onChange={(event) => { setLinkUrl(event.target.value); setLinkUrlError(''); }} placeholder="https://example.com/resource" required disabled={busy} /></label>
        <Button type="submit" variant="secondary" disabled={busy || !linkTitle.trim() || !linkUrl.trim()}><Link2 size={15} />Add link</Button>
      </form>
      <small id={`lesson-link-url-help-${lesson.id}`} className="caption-language-help lesson-link-help">Use HTTP or HTTPS without a username or password.</small>
      {linkUrlError && <div id={`lesson-link-url-error-${lesson.id}`} className="inline-notice caption-form-error" role="alert">{linkUrlError}</div>}
      <div className="lesson-document-upload">
        <div><strong>Attach a document</strong><span id={documentFormatHelpId}>PDF, text, Word, PowerPoint, Excel, CSV/TSV, or OpenDocument.</span></div>
        <label className="button button-secondary file-button"><Upload size={15} />Choose document<input type="file" accept=".pdf,.txt,.md,.rtf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.tsv,.odt,.odp,.ods" aria-describedby={documentFormatHelpId} disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadDocument(file, event.currentTarget); event.currentTarget.value = ''; }} /></label>
        {uploadKind === 'document' && uploadProgress !== null && (uploadProgress >= 100 ? <div className="upload-progress upload-progress-saving lesson-document-progress" role="status">Saving document…</div> : <div className="upload-progress lesson-document-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploadProgress} aria-label="Lesson document upload progress"><span style={{ width: `${uploadProgress}%` }} /><small>{uploadProgress}%</small></div>)}
        {uploadKind === 'document' && uploadProgress !== null && uploadProgress < 100 && <button type="button" className="text-action upload-cancel-action" aria-label="Cancel document upload" onClick={cancelUpload}>Cancel upload</button>}
      </div>
      <section className="lesson-caption-editor" aria-labelledby={`lesson-caption-heading-${lesson.id}`}>
        <div className="lesson-resource-heading"><div><h4 id={`lesson-caption-heading-${lesson.id}`}>Video captions</h4><span>Upload WebVTT subtitle tracks. Learners can choose a language in the video controls.</span></div></div>
        {captions.length ? <ul className="lesson-resource-list">{captions.map((caption) => <li className="lesson-resource-row" key={caption.id}>
          <FileText size={16} />
          <div><strong>{caption.label} <span className="caption-language">({caption.language})</span></strong><small>{caption.fileName}</small></div>
          <button type="button" className="icon-button danger-icon" title={`Remove ${caption.label} captions`} aria-label={`Remove ${caption.label} captions (${caption.language})`} disabled={busy} onClick={() => removeCaption(caption)}><Trash2 size={15} /></button>
        </li>)}</ul> : <p className="lesson-resource-empty">No caption tracks added yet.</p>}
        <form className="lesson-caption-form" onSubmit={uploadCaptions}>
          <label>Language tag<input ref={captionLanguageInputRef} type="text" value={captionLanguage} maxLength={35} aria-invalid={captionLanguageError ? true : undefined} aria-describedby={captionLanguageError ? `caption-language-help-${lesson.id} caption-language-error-${lesson.id}` : `caption-language-help-${lesson.id}`} onChange={(event) => { setCaptionLanguage(event.target.value); setCaptionLanguageError(''); }} placeholder="en or en-GB" autoCapitalize="off" spellCheck={false} required disabled={busy} /></label>
          <label>Track label<input type="text" value={captionLabel} maxLength={80} onChange={(event) => setCaptionLabel(event.target.value)} placeholder="English" required disabled={busy} /></label>
          <label className="caption-file-label">WebVTT file<span className="caption-file-control"><span className="caption-file-button"><Upload size={14} aria-hidden="true" />Choose file</span><span className="caption-file-name" title={captionFile?.name || 'No file selected'}>{captionFile?.name || 'No file selected'}</span><input ref={captionInputRef} type="file" accept=".vtt,text/vtt" aria-invalid={captionFileError ? true : undefined} aria-describedby={captionFileError ? `caption-file-help-${lesson.id} caption-file-error-${lesson.id}` : `caption-file-help-${lesson.id}`} onChange={(event) => {
            const file = event.currentTarget.files?.[0] || null;
            const fileError = file ? captionFileSizeError(file.size) : null;
            if (fileError) {
              setCaptionFile(null);
              setCaptionFileError(fileError);
              event.currentTarget.value = '';
              return;
            }
            setCaptionFile(file);
            setCaptionFileError('');
          }} required disabled={busy} /></span></label>
          <Button type="submit" variant="secondary" disabled={busy || !captionFile || !captionLanguage.trim() || !captionLabel.trim()}><Upload size={15} />Upload captions</Button>
        </form>
        <small id={`caption-language-help-${lesson.id}`} className="caption-language-help lesson-caption-language-help">Use a tag such as en or en-GB.</small>
        <p id={`caption-file-help-${lesson.id}`} className="caption-upload-hint">One track per language; uploading that language again replaces the existing file. Maximum size: 5 MB.</p>
        {captionLanguageError && <div id={`caption-language-error-${lesson.id}`} className="inline-notice caption-form-error" role="alert">{captionLanguageError}</div>}
        {captionFileError && <div id={`caption-file-error-${lesson.id}`} className="inline-notice caption-form-error" role="alert">{captionFileError}</div>}
        {uploadKind === 'captions' && uploadProgress !== null && (uploadProgress >= 100 ? <div className="upload-progress upload-progress-saving lesson-caption-progress" role="status">Saving captions…</div> : <div className="upload-progress lesson-caption-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploadProgress} aria-label="Caption upload progress"><span style={{ width: `${uploadProgress}%` }} /><small>{uploadProgress}%</small></div>)}
        {uploadKind === 'captions' && uploadProgress !== null && uploadProgress < 100 && <button type="button" className="text-action upload-cancel-action" aria-label="Cancel captions upload" onClick={cancelUpload}>Cancel upload</button>}
      </section>
    </section>
  </section>;
}

export function CourseEditorPage() {
  const route = useParams();
  const navigate = useNavigate();
  const { user: editorUser } = useAuth();
  const coverHelpId = useId();
  const completionWindowInputRef = useRef<HTMLInputElement>(null);
  const createCourseRequestRef = useRef<Promise<{ course: Course }> | null>(null);
  const courseLoadSequenceRef = useRef(0);
  const governanceLoadSequenceRef = useRef(0);
  const courseLoadControllerRef = useRef<AbortController | null>(null);
  const governanceLoadControllerRef = useRef<AbortController | null>(null);
  const versionHistoryLoadControllerRef = useRef<AbortController | null>(null);
  const routeCourseIdRef = useRef(route.courseId || '');
  routeCourseIdRef.current = route.courseId || '';
  const [courseId, setCourseId] = useState(route.courseId || '');
  const [course, setCourse] = useState<Course | null>(null);
  const [title, setTitle] = useState('Untitled course');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('General');
  const [visibility, setVisibility] = useState<Course['visibility']>('public');
  const [completionWindowDays, setCompletionWindowDays] = useState('');
  const completionWindow = validateCompletionWindowDays(completionWindowDays);
  const [requiresRecompletion, setRequiresRecompletion] = useState(false);
  const [changeNote, setChangeNote] = useState('');
  const [versions, setVersions] = useState<CourseVersion[]>([]);
  const [currentVersion, setCurrentVersion] = useState<CourseVersion | null>(null);
  const [versionPage, setVersionPage] = useState(1);
  const [versionPageSize, setVersionPageSize] = useState(20);
  const [versionTotal, setVersionTotal] = useState(0);
  const [versionHistoryLoading, setVersionHistoryLoading] = useState(false);
  const [versionHistoryError, setVersionHistoryError] = useState('');
  const [review, setReview] = useState<{ status: string; author: string | null; submittedBy: string | null; submittedAt: string | null; reviewedBy: string | null; reviewNote: string } | null>(null);
  const [showChangeRequestForm, setShowChangeRequestForm] = useState(false);
  const [changeRequestNote, setChangeRequestNote] = useState('');
  const [savingReviewDecision, setSavingReviewDecision] = useState(false);
  const reviewDecisionRequestRef = useRef(false);
  const restoreVersionRequestsRef = useRef(new Set<string>());
  const [restoringVersionRequests, setRestoringVersionRequests] = useState<Set<string>>(() => new Set());
  const [submittingReview, setSubmittingReview] = useState(false);
  const reviewSubmissionRequestRef = useRef(false);
  const requestChangesButtonRef = useRef<HTMLButtonElement>(null);
  const [competencies, setCompetencies] = useState<Competency[]>([]);
  const [selectedCompetencies, setSelectedCompetencies] = useState<string[]>([]);
  const [competencySearch, setCompetencySearch] = useState('');
  const [competencySelectionLimit, setCompetencySelectionLimit] = useState(200);
  const [competencyMappingError, setCompetencyMappingError] = useState('');
  const [competencyMappingNotice, setCompetencyMappingNotice] = useState('');
  const [savingCompetencyMapping, setSavingCompetencyMapping] = useState(false);
  const competencyMappingSaveRef = useRef(false);
  const [governanceCourseId, setGovernanceCourseId] = useState('');
  const [governanceLoading, setGovernanceLoading] = useState(false);
  const [governanceError, setGovernanceError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingStatus, setSavingStatus] = useState<'draft' | 'published' | null>(null);
  const saving = savingStatus !== null;
  const deleteCourseRequestRef = useRef(false);
  const [deletingCourse, setDeletingCourse] = useState(false);
  const deleteCurriculumItemRef = useRef('');
  const [deletingCurriculumItem, setDeletingCurriculumItem] = useState('');
  const [movingCurriculumItems, setMovingCurriculumItems] = useState<Set<string>>(() => new Set());
  const movingCurriculumItemsRef = useRef(movingCurriculumItems);
  const isMovingCurriculum = movingCurriculumItems.size > 0;
  const [moduleTitle, setModuleTitle] = useState('');
  const [addingModule, setAddingModule] = useState(false);
  const [addingModuleBusy, setAddingModuleBusy] = useState(false);
  const addingModuleRequestRef = useRef(false);
  const addModuleButtonRef = useRef<HTMLButtonElement>(null);
  const addModuleInvokerRef = useRef<HTMLButtonElement | null>(null);
  const [addingLessonModuleIds, setAddingLessonModuleIds] = useState<Set<string>>(() => new Set());
  const addingLessonModuleIdsRef = useRef(addingLessonModuleIds);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editingLessonId, setEditingLessonId] = useState('');
  const [uploading, setUploading] = useState<Record<string, number>>({});
  const uploadingLessonIdsRef = useRef<Set<string>>(new Set());
  const [coverProgress, setCoverProgress] = useState<number | null>(null);
  const [coverValidating, setCoverValidating] = useState(false);
  const coverUploadRef = useRef(false);
  const coverValidationSequenceRef = useRef(0);
  const coverValidationControllerRef = useRef<AbortController | null>(null);
  const uploadControllersRef = useRef(new Map<string, { controller: AbortController; input: HTMLInputElement; cancelledByUser: boolean }>());
  const governanceReady = Boolean(route.courseId && governanceCourseId === route.courseId);
  const selectedCompetencyIds = new Set(selectedCompetencies);
  const visibleCompetencies = filterCourseCompetencies(competencies, competencySearch);
  const competencyMappingOverLimit = selectedCompetencies.length > competencySelectionLimit;
  const courseDetailsChanged = Boolean(course && (
    title.trim() !== course.title
    || description.trim() !== course.description
    || category.trim() !== course.category
    || visibility !== course.visibility
    || (completionWindowDays ? Number(completionWindowDays) : null) !== (course.completionWindowDays ?? null)
  ));

  function abortActiveUploads() {
    for (const upload of uploadControllersRef.current.values()) upload.controller.abort();
    uploadControllersRef.current.clear();
  }

  function abortCoverValidation() {
    coverValidationControllerRef.current?.abort();
    coverValidationControllerRef.current = null;
  }

  function abortGovernanceLoad() {
    governanceLoadSequenceRef.current += 1;
    governanceLoadControllerRef.current?.abort();
    governanceLoadControllerRef.current = null;
    versionHistoryLoadControllerRef.current?.abort();
    versionHistoryLoadControllerRef.current = null;
  }

  function cancelUpload(key: string) {
    const upload = uploadControllersRef.current.get(key);
    if (!upload) return;
    upload.cancelledByUser = true;
    upload.controller.abort();
  }

  async function load(id = courseId) {
    if (!id) return;
    const previousCourse = course;
    const requestSequence = ++courseLoadSequenceRef.current;
    courseLoadControllerRef.current?.abort();
    const controller = new AbortController();
    courseLoadControllerRef.current = controller;
    const isCurrentRequest = () => requestSequence === courseLoadSequenceRef.current && routeCourseIdRef.current === id;
    abortGovernanceLoad();
    setGovernanceCourseId(''); setGovernanceError(''); setCompetencyMappingError(''); setCompetencyMappingNotice(''); setGovernanceLoading(true);
    try {
      const response = await fetchCourse(id, true, { signal: controller.signal });
      if (!isCurrentRequest()) return;
      setCourse(response.course);
      setCompletionWindowDays(response.course.completionWindowDays ? String(response.course.completionWindowDays) : '');
      void loadGovernance(id, isCurrentRequest).catch((cause) => {
        if (isCurrentRequest()) setError(cause instanceof ApiError ? cause.message : 'Course settings could not be loaded.');
      });
      if (!previousCourse) {
        setTitle(response.course.title); setDescription(response.course.description); setCategory(response.course.category); setVisibility(response.course.visibility);
      } else {
        setCompletionWindowDays((current) => current === String(previousCourse.completionWindowDays ?? '') ? String(response.course.completionWindowDays ?? '') : current);
        setTitle((current) => current === previousCourse.title ? response.course.title : current);
        setDescription((current) => current === previousCourse.description ? response.course.description : current);
        setCategory((current) => current === previousCourse.category ? response.course.category : current);
        setVisibility((current) => current === previousCourse.visibility ? response.course.visibility : current);
      }
    } catch (cause) {
      if (isCurrentRequest()) {
        setError(cause instanceof ApiError ? cause.message : 'Course could not be loaded.');
        setGovernanceLoading(false);
      }
    } finally {
      if (isCurrentRequest()) {
        courseLoadControllerRef.current = null;
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    let active = true;
    coverValidationSequenceRef.current += 1;
    abortCoverValidation();
    coverUploadRef.current = false;
    setCoverValidating(false);
    setCoverProgress(null);
    setRequiresRecompletion(false);
    setChangeNote('');
    setCompetencySearch('');
    if (route.courseId) {
      uploadingLessonIdsRef.current = new Set(); setUploading({});
      createCourseRequestRef.current = null;
      setCourseId(route.courseId);
      setCourse(null);
      setVersions([]); setCurrentVersion(null); setVersionPage(1); setVersionPageSize(20); setVersionTotal(0); setVersionHistoryLoading(false); setVersionHistoryError('');
      setReview(null); setCompetencies([]); setSelectedCompetencies([]);
      setShowChangeRequestForm(false); setChangeRequestNote('');
      abortGovernanceLoad();
      setGovernanceCourseId(''); setGovernanceLoading(false); setGovernanceError('');
      setError(''); setNotice(''); setSavingStatus(null);
      setLoading(true);
      load(route.courseId);
      return () => {
        active = false;
        coverValidationSequenceRef.current += 1;
        abortCoverValidation();
        courseLoadSequenceRef.current += 1;
        abortGovernanceLoad();
        courseLoadControllerRef.current?.abort();
        abortActiveUploads();
      };
    }
    setCourse(null);
    setError('');
    setLoading(true);
    const createRequest = createCourseRequestRef.current ?? api.post<{ course: Course }>('/api/manage/courses', { title: 'Untitled course', description: '', category: 'General', visibility: 'public' });
    createCourseRequestRef.current = createRequest;
    createRequest
      .then((response) => {
        if (!active) return;
        setCourseId(response.course.id);
        navigate(`/manage/courses/${response.course.id}/edit`, { replace: true });
        setCourse(response.course); setTitle(response.course.title); setDescription(response.course.description); setCategory(response.course.category); setVisibility(response.course.visibility); setCompletionWindowDays(response.course.completionWindowDays ? String(response.course.completionWindowDays) : '');
      }).catch((cause) => {
        if (active) setError(cause instanceof ApiError ? cause.message : 'Course could not be created.');
      }).finally(() => {
        if (createCourseRequestRef.current === createRequest) createCourseRequestRef.current = null;
        if (active) setLoading(false);
      });
    return () => { active = false; courseLoadSequenceRef.current += 1; abortGovernanceLoad(); courseLoadControllerRef.current?.abort(); abortActiveUploads(); };
  }, [route.courseId]);

  async function saveCourse(status: 'draft' | 'published') {
    if (!courseId) return;
    const requestedCourseId = courseId;
    const requestSequence = ++courseLoadSequenceRef.current;
    courseLoadControllerRef.current?.abort();
    setSavingStatus(status); setError(''); setNotice('');
    let courseSaved = false;
    try {
      if (completionWindow.error) {
        completionWindowInputRef.current?.focus();
        throw new ApiError(400, completionWindow.error, 'validation_error');
      }
      const response = await api.patch<{ course: Course }>(`/api/manage/courses/${requestedCourseId}`, {
        title, description, category, visibility,
        completionWindowDays: completionWindow.value,
        ...(status ? { status } : {}),
      ...(status === 'published' ? { requiresRecompletion, changeNote } : {}),
      });
      if (routeCourseIdRef.current !== requestedCourseId || requestSequence !== courseLoadSequenceRef.current) return;
      courseSaved = true;
      setCourse(response.course); setNotice(status === 'published' ? 'Course published for learners.' : status === 'draft' ? 'Draft saved.' : 'Course details saved.');
      if (status === 'published') { setRequiresRecompletion(false); setChangeNote(''); await loadGovernance(requestedCourseId); }
    } catch (cause) {
      if (routeCourseIdRef.current === requestedCourseId && requestSequence === courseLoadSequenceRef.current) {
        setError(courseSaved
          ? `Course was saved, but the editor settings could not be refreshed. ${cause instanceof ApiError ? cause.message : 'Retry loading course settings.'}`
          : cause instanceof ApiError ? cause.message : 'Course could not be saved.');
      }
    } finally {
      if (routeCourseIdRef.current === requestedCourseId) setSavingStatus(null);
    }
  }

  async function saveCourseDetailsIfChanged() {
    if (!courseId || !course) return;
    if (completionWindow.error) {
      completionWindowInputRef.current?.focus();
      throw new ApiError(400, completionWindow.error, 'validation_error');
    }
    if (title === course.title && description === course.description && category === course.category && visibility === course.visibility
      && (completionWindowDays ? Number(completionWindowDays) : null) === (course.completionWindowDays ?? null)) return;
    const response = await api.patch<{ course: Course }>(`/api/manage/courses/${courseId}`, {
      title, description, category, visibility,
      completionWindowDays: completionWindow.value,
    });
    setCourse(response.course);
  }

  async function loadGovernance(id = courseId, isRouteRequestCurrent = () => routeCourseIdRef.current === id) {
    if (!id || routeCourseIdRef.current !== id || !isRouteRequestCurrent()) return;
    versionHistoryLoadControllerRef.current?.abort();
    versionHistoryLoadControllerRef.current = null;
    governanceLoadControllerRef.current?.abort();
    const controller = new AbortController();
    const requestSequence = ++governanceLoadSequenceRef.current;
    governanceLoadControllerRef.current = controller;
    const isCurrentRequest = () => requestSequence === governanceLoadSequenceRef.current
      && routeCourseIdRef.current === id && isRouteRequestCurrent()
      && governanceLoadControllerRef.current === controller;
    setGovernanceCourseId(''); setGovernanceError(''); setGovernanceLoading(true);
    setVersionHistoryLoading(false); setVersionHistoryError('');
    try {
      const [history, mapping] = await Promise.all([
        api.get<CourseVersionHistoryPage & { revision: typeof review }>(`/api/manage/courses/${id}/versions?page=1`, { signal: controller.signal }),
        api.get<{ competencies: Competency[]; selected: string[]; selectionLimit: number }>(`/api/manage/courses/${id}/competencies`, { signal: controller.signal }),
      ]);
      if (!isCurrentRequest()) return;
      setVersions(history.versions); setCurrentVersion(history.currentVersion); setReview(history.revision);
      setVersionPage(history.page); setVersionPageSize(history.pageSize); setVersionTotal(history.total);
      setCompetencies(mapping.competencies); setSelectedCompetencies(mapping.selected); setCompetencySelectionLimit(mapping.selectionLimit);
      setGovernanceCourseId(id);
    } catch (cause) {
      if (!isCurrentRequest() && controller.signal.aborted) return;
      if (isCurrentRequest()) {
        setGovernanceError(cause instanceof ApiError ? cause.message : 'Course settings could not be loaded.');
        controller.abort();
      }
      throw cause;
    } finally {
      if (governanceLoadControllerRef.current === controller) {
        governanceLoadControllerRef.current = null;
        setGovernanceLoading(false);
      }
    }
  }

  async function loadVersionHistory(requestedPage: number, id = courseId) {
    if (!id || routeCourseIdRef.current !== id || governanceCourseId !== id) return;
    versionHistoryLoadControllerRef.current?.abort();
    const controller = new AbortController();
    versionHistoryLoadControllerRef.current = controller;
    setVersionHistoryLoading(true); setVersionHistoryError('');
    try {
      const result = await api.get<CourseVersionHistoryPage>(`/api/manage/courses/${id}/versions?page=${requestedPage}`, { signal: controller.signal });
      if (!controller.signal.aborted && versionHistoryLoadControllerRef.current === controller && routeCourseIdRef.current === id) {
        setVersions(result.versions);
        setCurrentVersion(result.currentVersion); setVersionPage(result.page); setVersionPageSize(result.pageSize); setVersionTotal(result.total);
      }
    } catch (cause) {
      if (!controller.signal.aborted && versionHistoryLoadControllerRef.current === controller && routeCourseIdRef.current === id) {
        setVersionHistoryError(cause instanceof ApiError ? cause.message : 'Course version history could not be loaded.');
      }
    } finally {
      if (versionHistoryLoadControllerRef.current === controller) {
        versionHistoryLoadControllerRef.current = null;
        setVersionHistoryLoading(false);
      }
    }
  }

  function retryGovernanceLoad() {
    const id = route.courseId;
    if (!id) return;
    setError('');
    void loadGovernance(id).catch((cause) => {
      if (routeCourseIdRef.current === id) setError(cause instanceof ApiError ? cause.message : 'Course settings could not be loaded.');
    });
  }

  async function submitForReview() {
    if (!courseId || reviewSubmissionRequestRef.current) return;
    const requestedCourseId = courseId;
    const isCurrentRequest = () => routeCourseIdRef.current === requestedCourseId;
    reviewSubmissionRequestRef.current = true;
    setSubmittingReview(true);
    setError(''); setNotice('');
    let reviewRequestSubmitted = false;
    try {
      await saveCourseDetailsIfChanged();
      if (!isCurrentRequest()) return;
      await api.post(`/api/manage/courses/${requestedCourseId}/review`, { note: changeNote });
      if (!isCurrentRequest()) return;
      reviewRequestSubmitted = true;
      setNotice('Course revision submitted for review.');
      await loadGovernance(requestedCourseId);
    } catch (cause) {
      if (isCurrentRequest()) setError(reviewRequestSubmitted
        ? `Review request was submitted, but course settings could not be refreshed. ${cause instanceof ApiError ? cause.message : 'Retry loading course settings.'}`
        : cause instanceof ApiError ? cause.message : 'The course could not be submitted for review.');
    }
    finally { reviewSubmissionRequestRef.current = false; setSubmittingReview(false); }
  }

  async function decideReview(decision: 'approve' | 'changes_requested', reviewNote = changeNote) {
    if (!courseId || reviewDecisionRequestRef.current) return;
    const requestedCourseId = courseId;
    const isCurrentRequest = () => routeCourseIdRef.current === requestedCourseId;
    const note = decision === 'changes_requested' ? reviewNote.trim() : reviewNote;
    if (decision === 'changes_requested' && !note) {
      setError('Describe the changes the editor should make.');
      return;
    }
    reviewDecisionRequestRef.current = true;
    setSavingReviewDecision(true);
    setError(''); setNotice('');
    let reviewDecisionSaved = false;
    try {
      await api.post(`/api/manage/courses/${requestedCourseId}/review/decision`, {
        decision, note, requiresRecompletion: decision === 'approve' && requiresRecompletion,
      });
      if (!isCurrentRequest()) return;
      reviewDecisionSaved = true;
      setNotice(decision === 'approve' ? 'Revision approved and published.' : 'Changes requested from the editor.');
      if (decision === 'changes_requested') { setShowChangeRequestForm(false); setChangeRequestNote(''); }
      try {
        await loadGovernance(requestedCourseId);
      } finally {
        if (isCurrentRequest()) await load(requestedCourseId);
      }
    } catch (cause) {
      if (isCurrentRequest()) setError(reviewDecisionSaved
        ? `Review decision was saved, but the course editor could not be refreshed. ${cause instanceof ApiError ? cause.message : 'Retry loading course settings.'}`
        : cause instanceof ApiError ? cause.message : 'The review decision could not be saved.');
    }
    finally { reviewDecisionRequestRef.current = false; setSavingReviewDecision(false); }
  }

  async function restoreVersion(version: CourseVersion) {
    const requestedCourseId = courseId;
    if (!requestedCourseId) return;
    const requestKey = `${requestedCourseId}:${version.id}`;
    if (restoreVersionRequestsRef.current.has(requestKey)
      || !window.confirm(`Publish version ${version.version_number} as a new course version?`)) return;
    restoreVersionRequestsRef.current.add(requestKey);
    setRestoringVersionRequests((current) => new Set(current).add(requestKey));
    setError(''); setNotice('');
    let versionRestored = false;
    try {
      await api.post(`/api/manage/courses/${requestedCourseId}/versions/${version.id}/restore`, { requiresRecompletion });
      if (routeCourseIdRef.current !== requestedCourseId) return;
      versionRestored = true;
      setRequiresRecompletion(false);
      setNotice(`Version ${version.version_number} was restored and published as a new version.`);
      try {
        await load(requestedCourseId);
      } finally {
        if (routeCourseIdRef.current === requestedCourseId) await loadGovernance(requestedCourseId);
      }
    } catch (cause) {
      if (routeCourseIdRef.current === requestedCourseId) setError(versionRestored
        ? `Version ${version.version_number} was restored, but the course editor could not be refreshed. ${cause instanceof ApiError ? cause.message : 'Retry loading course settings.'}`
        : cause instanceof ApiError ? cause.message : 'This version could not be restored.');
    } finally {
      restoreVersionRequestsRef.current.delete(requestKey);
      setRestoringVersionRequests((current) => {
        if (!current.has(requestKey)) return current;
        const next = new Set(current);
        next.delete(requestKey);
        return next;
      });
    }
  }

  async function saveCompetencyMapping() {
    if (!courseId || competencyMappingSaveRef.current) return;
    if (competencyMappingOverLimit) {
      setCompetencyMappingError(`Remove at least ${selectedCompetencies.length - competencySelectionLimit} competencies before saving this mapping.`);
      return;
    }
    const requestedCourseId = courseId;
    const isCurrentRequest = () => routeCourseIdRef.current === requestedCourseId;
    competencyMappingSaveRef.current = true;
    setSavingCompetencyMapping(true);
    setCompetencyMappingError(''); setCompetencyMappingNotice('');
    try {
      const response = await api.put<{ selected: string[] }>(`/api/manage/courses/${requestedCourseId}/competencies`, { competencyIds: selectedCompetencies });
      if (!isCurrentRequest()) return;
      setSelectedCompetencies(response.selected);
      setCompetencyMappingNotice('Course competencies saved.');
    } catch (cause) { if (isCurrentRequest()) setCompetencyMappingError(cause instanceof ApiError ? cause.message : 'Course competencies could not be saved.'); }
    finally { competencyMappingSaveRef.current = false; setSavingCompetencyMapping(false); }
  }

  async function deleteArchivedCourse() {
    if (deleteCourseRequestRef.current || deleteCurriculumItemRef.current || saving || !course || course.status !== 'archived') return;
    if (!window.confirm(`Permanently delete “${course.title}” and its uploaded media?`)) return;
    deleteCourseRequestRef.current = true;
    setDeletingCourse(true);
    setError('');
    try {
      await api.delete(`/api/manage/courses/${course.id}`);
      navigate('/manage/courses');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Course could not be deleted.');
    } finally {
      deleteCourseRequestRef.current = false;
      setDeletingCourse(false);
    }
  }

  async function addModule(event: React.FormEvent) {
    event.preventDefault();
    if (addingModuleRequestRef.current || !moduleTitle.trim() || !courseId) return;
    addingModuleRequestRef.current = true; setAddingModuleBusy(true);
    setError('');
    try {
      await saveCourseDetailsIfChanged();
      await api.post(`/api/manage/courses/${courseId}/modules`, { title: moduleTitle.trim() });
      setModuleTitle(''); setAddingModule(false); addModuleButtonRef.current?.focus(); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Module could not be added.'); }
    finally { addingModuleRequestRef.current = false; setAddingModuleBusy(false); }
  }

  async function addLesson(moduleId: string) {
    if (addingLessonModuleIdsRef.current.has(moduleId)) return;
    const pending = new Set(addingLessonModuleIdsRef.current);
    pending.add(moduleId); addingLessonModuleIdsRef.current = pending; setAddingLessonModuleIds(pending);
    setError('');
    try { await saveCourseDetailsIfChanged(); await api.post(`/api/manage/modules/${moduleId}/lessons`, { title: 'New lesson' }); await load(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Lesson could not be added.'); }
    finally {
      const nextPending = new Set(addingLessonModuleIdsRef.current);
      nextPending.delete(moduleId); addingLessonModuleIdsRef.current = nextPending; setAddingLessonModuleIds(nextPending);
    }
  }

  async function editModule(module: CourseModule) {
    const nextTitle = window.prompt('Module title', module.title);
    const normalizedTitle = nextTitle?.trim();
    if (!normalizedTitle || normalizedTitle === module.title) return;
    setError('');
    if (normalizedTitle.length > 160) { setError('Module title must be 160 characters or fewer.'); return; }
    try { await saveCourseDetailsIfChanged(); await api.patch(`/api/manage/modules/${module.id}`, { title: normalizedTitle }); await load(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Module could not be updated.'); }
  }

  async function deleteModule(module: CourseModule) {
    if (deleteCurriculumItemRef.current || deleteCourseRequestRef.current || saving) return;
    if (!window.confirm(`Remove “${module.title}” and all of its lessons and quiz?`)) return;
    const target = `module:${module.id}`;
    deleteCurriculumItemRef.current = target; setDeletingCurriculumItem(target); setError('');
    try { await saveCourseDetailsIfChanged(); await api.delete(`/api/manage/modules/${module.id}`); await load(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Module could not be removed.'); }
    finally { deleteCurriculumItemRef.current = ''; setDeletingCurriculumItem(''); }
  }

  async function deleteLesson(lessonId: string, currentTitle: string) {
    if (deleteCurriculumItemRef.current || deleteCourseRequestRef.current || saving) return;
    if (!window.confirm(`Remove “${currentTitle}”, its video, and its lesson resources?`)) return;
    const target = `lesson:${lessonId}`;
    deleteCurriculumItemRef.current = target; setDeletingCurriculumItem(target); setError('');
    try { await saveCourseDetailsIfChanged(); await api.delete(`/api/manage/lessons/${lessonId}`); setEditingLessonId(''); await load(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Lesson could not be removed.'); }
    finally { deleteCurriculumItemRef.current = ''; setDeletingCurriculumItem(''); }
  }

  function markCurriculumItemMoving(itemKey: string, moving: boolean) {
    const next = new Set(movingCurriculumItemsRef.current);
    if (moving) next.add(itemKey);
    else next.delete(itemKey);
    movingCurriculumItemsRef.current = next;
    setMovingCurriculumItems(next);
  }

  async function moveItem(path: string, direction: 'up' | 'down', itemKey: string) {
    if (movingCurriculumItemsRef.current.size > 0) return;
    markCurriculumItemMoving(itemKey, true);
    setError('');
    try { await saveCourseDetailsIfChanged(); await api.post(path, { direction }); await load(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Order could not be updated.'); }
    finally { markCurriculumItemMoving(itemKey, false); }
  }

  async function uploadVideo(lessonId: string, file: File, input: HTMLInputElement) {
    if (uploadingLessonIdsRef.current.has(lessonId)) return;
    const requestedCourseId = courseId;
    const uploadKey = `video:${lessonId}`;
    const upload = { controller: new AbortController(), input, cancelledByUser: false };
    uploadControllersRef.current.set(uploadKey, upload);
    const pending = new Set(uploadingLessonIdsRef.current);
    pending.add(lessonId); uploadingLessonIdsRef.current = pending;
    setError(''); setUploading((current) => ({ ...current, [lessonId]: 0 }));
    try {
      await saveCourseDetailsIfChanged();
      if (upload.controller.signal.aborted || routeCourseIdRef.current !== requestedCourseId) return;
      await api.upload(`/api/manage/courses/${requestedCourseId}/media`, { kind: 'video', lessonId }, file, (progress) => {
        if (!upload.controller.signal.aborted && routeCourseIdRef.current === requestedCourseId) setUploading((current) => ({ ...current, [lessonId]: progress }));
      }, { signal: upload.controller.signal });
      if (upload.controller.signal.aborted || routeCourseIdRef.current !== requestedCourseId) return;
      await load(requestedCourseId);
      if (!upload.controller.signal.aborted && routeCourseIdRef.current === requestedCourseId) setNotice(`${file.name} uploaded.`);
    } catch (cause) {
      if (!upload.controller.signal.aborted && routeCourseIdRef.current === requestedCourseId) setError(cause instanceof ApiError ? cause.message : 'Video could not be uploaded.');
    }
    finally {
      if (uploadControllersRef.current.get(uploadKey) === upload) uploadControllersRef.current.delete(uploadKey);
      if (routeCourseIdRef.current === requestedCourseId) {
        const nextPending = new Set(uploadingLessonIdsRef.current);
        nextPending.delete(lessonId); uploadingLessonIdsRef.current = nextPending;
        setUploading((current) => { const next = { ...current }; delete next[lessonId]; return next; });
        if (upload.cancelledByUser) requestAnimationFrame(() => { if (routeCourseIdRef.current === requestedCourseId && upload.input.isConnected) upload.input.focus(); });
      }
    }
  }

  async function uploadCover(file: File, input: HTMLInputElement) {
    if (coverUploadRef.current) return;
    const requestedCourseId = courseId;
    const validationSequence = ++coverValidationSequenceRef.current;
    const validationController = new AbortController();
    coverValidationControllerRef.current = validationController;
    const isCurrentRequest = () => validationSequence === coverValidationSequenceRef.current
      && routeCourseIdRef.current === requestedCourseId;
    coverUploadRef.current = true;
    setCoverValidating(true);
    setError(''); setNotice('');
    let upload: { controller: AbortController; input: HTMLInputElement; cancelledByUser: boolean } | null = null;
    try {
      const dimensions = await readImageDimensions(file, validationController.signal);
      if (coverValidationControllerRef.current === validationController) coverValidationControllerRef.current = null;
      if (!isCurrentRequest()) return;
      if (!isCourseCoverDimensionAllowed(dimensions.width, dimensions.height)) {
        setError(`Course cover must be ${MAX_COURSE_COVER_DIMENSION} × ${MAX_COURSE_COVER_DIMENSION} pixels or smaller.`);
        return;
      }

      const activeUpload = { controller: new AbortController(), input, cancelledByUser: false };
      upload = activeUpload;
      uploadControllersRef.current.set('cover', activeUpload);
      setCoverValidating(false);
      setCoverProgress(0);
      await saveCourseDetailsIfChanged();
      if (activeUpload.controller.signal.aborted || !isCurrentRequest()) return;
      await api.upload(`/api/manage/courses/${requestedCourseId}/media`, { kind: 'cover' }, file, (progress) => {
        if (!activeUpload.controller.signal.aborted && isCurrentRequest()) setCoverProgress(progress);
      }, { signal: activeUpload.controller.signal });
      if (activeUpload.controller.signal.aborted || !isCurrentRequest()) return;
      await load(requestedCourseId);
      if (!activeUpload.controller.signal.aborted && isCurrentRequest()) setNotice('Course cover uploaded.');
    } catch (cause) {
      if (isCurrentRequest() && (!upload || !upload.controller.signal.aborted)) {
        setError(upload
          ? cause instanceof ApiError ? cause.message : 'Course cover could not be uploaded.'
          : 'Course cover could not be displayed. Choose a different image.');
      }
    }
    finally {
      if (coverValidationControllerRef.current === validationController) coverValidationControllerRef.current = null;
      if (upload && uploadControllersRef.current.get('cover') === upload) uploadControllersRef.current.delete('cover');
      if (isCurrentRequest()) {
        coverUploadRef.current = false;
        setCoverValidating(false);
        setCoverProgress(null);
        const completedUpload = upload;
        if (completedUpload?.cancelledByUser) requestAnimationFrame(() => { if (isCurrentRequest() && completedUpload.input.isConnected) completedUpload.input.focus(); });
      }
    }
  }

  if (loading || (course && (!route.courseId || route.courseId !== course.id))) return <div className="page-loading" role="status" aria-live="polite">Loading course editor…</div>;
  if (!course) return <div className="management-page">{error && <Notice>{error}</Notice>}<Link className="back-link" to="/manage/courses"><ArrowLeft size={17} />Back to courses</Link></div>;

  return <div className="editor-page">
    <div className="editor-topbar"><div><div className="breadcrumbs"><Link to="/manage/courses">Courses</Link><span>/</span><span>Edit course</span></div><h1>{course.title || 'Edit course'}</h1></div><div className="editor-actions"><CourseStatus status={course.status} /><Button type="button" variant="secondary" onClick={() => saveCourse('draft')} disabled={saving || (course.status === 'draft' && !courseDetailsChanged)} aria-busy={savingStatus === 'draft'}>{savingStatus === 'draft' ? 'Saving draft…' : course.status === 'draft' && !courseDetailsChanged ? 'Draft saved' : 'Save draft'}</Button><Button type="button" onClick={() => saveCourse('published')} disabled={saving || (review?.status === 'in_review' && review.submittedBy === editorUser?.id)} aria-busy={savingStatus === 'published'}>{savingStatus === 'published' ? 'Publishing…' : 'Publish course'}<span className="sr-only">{course.status === 'published' && !courseDetailsChanged ? ' (recheck course readiness)' : ''}</span></Button>{savingStatus && <span className="sr-only" role="status" aria-live="polite">{savingStatus === 'published' ? 'Publishing course…' : 'Saving draft…'}</span>}</div></div>
    {error && error !== COMPLETION_WINDOW_ERROR && <Notice>{error}</Notice>}{notice && <Notice kind="success">{notice}</Notice>}
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{movingCurriculumItems.size ? 'Updating course content order…' : ''}</p>
    <p className="course-editing-note">{courseEditingNote(course.status, course.visibility)}</p>
    <section className="editor-section course-details-form" aria-label="Course details">
      <div className="editor-field-grid"><label className="field-wide">Course title<input value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} placeholder="Give your course a clear title" disabled={saving} /></label>
        <label>Category<input value={category} maxLength={100} onChange={(event) => setCategory(event.target.value)} placeholder="e.g. Professional development" disabled={saving} /></label>
        <fieldset className="visibility-field" disabled={saving}><legend>Visibility</legend><label><input type="radio" name="visibility" checked={visibility === 'public'} onChange={() => setVisibility('public')} />Public</label><label><input type="radio" name="visibility" checked={visibility === 'private'} onChange={() => setVisibility('private')} />Private</label></fieldset>
        <label className="completion-window-field">Completion window (optional)<input ref={completionWindowInputRef} type="number" min="1" max="3650" step="1" inputMode="numeric" value={completionWindowDays} aria-invalid={completionWindow.error ? true : undefined} aria-describedby={completionWindow.error ? 'completion-window-help completion-window-error' : 'completion-window-help'} onChange={(event) => { setCompletionWindowDays(event.target.value); setError((currentError) => currentError === COMPLETION_WINDOW_ERROR ? '' : currentError); }} placeholder="No deadline" disabled={saving} /><small id="completion-window-help">Days are 24-hour periods. Deadlines do not block course access.</small>{completionWindow.error && <small id="completion-window-error" className="completion-window-error">{completionWindow.error}</small>}</label>
        <label className="field-wide">Description<textarea rows={3} maxLength={6000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What will learners understand or be able to do after this course?" disabled={saving} /></label>
      </div>
      <div className="cover-upload-row" aria-busy={coverValidating || coverProgress !== null || undefined}>
        <div>
          <ImageWithFallback src={course.coverUrl} className="course-cover-image" alt="Course cover preview" fallback={<span className="cover-preview-empty"><BookOpen size={22} /></span>} />
          <div><strong>Course cover</strong><small id={coverHelpId}>JPG, PNG, or WebP · max {MAX_COURSE_COVER_DIMENSION} × {MAX_COURSE_COVER_DIMENSION} px</small></div>
        </div>
        <label className={`button button-secondary file-button ${coverValidating || coverProgress !== null || saving ? 'file-button-busy' : ''}`} aria-disabled={coverValidating || coverProgress !== null || saving}>
          <Upload size={16} />{coverValidating ? 'Checking cover…' : coverProgress === null ? course.coverUrl ? 'Replace cover' : 'Upload cover' : coverProgress >= 100 ? 'Saving cover…' : 'Uploading cover…'}
          <input type="file" accept="image/jpeg,image/png,image/webp" aria-describedby={coverHelpId} disabled={coverValidating || coverProgress !== null || saving} onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadCover(file, event.currentTarget); event.currentTarget.value = ''; }} />
        </label>
        {coverValidating && <span className="upload-percent" role="status">Checking cover dimensions…</span>}
        {coverProgress !== null && (coverProgress >= 100 ? <span className="upload-percent upload-progress-saving-compact" role="status">Saving cover…</span> : <span className="upload-percent" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={coverProgress} aria-label="Course cover upload progress">{coverProgress}%</span>)}
        {coverProgress !== null && coverProgress < 100 && <button type="button" className="text-action upload-cancel-action" aria-label="Cancel cover upload" onClick={() => cancelUpload('cover')}>Cancel upload</button>}
      </div>
    </section>
    <section className="editor-section course-governance-section" aria-label="Course publication and learning settings" aria-busy={governanceLoading}>
      <div className="curriculum-editor-title"><div><h2>Publication and learning settings</h2><p>Choose how a new publication affects learners and manage its review history.</p></div></div>
      <label className="program-toggle version-reset-option"><input type="checkbox" checked={requiresRecompletion} onChange={(event) => setRequiresRecompletion(event.target.checked)} /><span><strong>Require learners to complete the next published version</strong><small>Previous completions, quiz attempts, and certificates remain in history. The default keeps existing completions valid.</small></span></label>
      <label className="version-change-note">Publication note (up to 500 characters)<input value={changeNote} onChange={(event) => setChangeNote(event.target.value)} maxLength={500} placeholder="Optional note for the version history" /><small>Saved with this version in its history.</small></label>
      {governanceLoading && <p className="course-governance-load-status" role="status">Loading version history and competency settings…</p>}
      {governanceError && <div className="course-governance-load-error"><Button type="button" variant="secondary" onClick={retryGovernanceLoad}>Retry loading course settings</Button></div>}
      {course.status === 'published' && governanceReady && <div className="revision-actions">
        {review?.status === 'in_review' && <div className="review-state"><span className="program-status draft">Awaiting review</span><p>Submitted by {review.author || 'a staff member'}{review.submittedAt ? ` · ${logTimestampFormatter.format(new Date(review.submittedAt))}` : ''}</p>{review.reviewNote && <small>{review.reviewNote}</small>}</div>}
        {review?.status !== 'in_review' && <div className="review-submit-actions">{review?.status === 'changes_requested' && <div className="review-state"><span className="program-status draft">Changes requested</span>{review.reviewNote && <small>{review.reviewNote}</small>}</div>}<Button type="button" variant="secondary" onClick={() => void submitForReview()} disabled={saving || submittingReview || savingReviewDecision} aria-busy={submittingReview}>{submittingReview ? 'Submitting revision…' : 'Submit revision for review'}</Button></div>}
        {review?.status === 'in_review' && review.submittedBy !== editorUser?.id && <>
          <div className="review-decision-actions">
            <Button ref={requestChangesButtonRef} type="button" variant="secondary" aria-expanded={showChangeRequestForm} aria-controls={showChangeRequestForm ? `review-change-request-${courseId}` : undefined} onClick={() => setShowChangeRequestForm(true)} disabled={savingReviewDecision}>Request changes</Button>
            <Button type="button" onClick={() => void decideReview('approve')} disabled={saving || savingReviewDecision} aria-busy={savingReviewDecision}>{savingReviewDecision ? 'Saving review…' : 'Approve and publish'}</Button>
          </div>
          {showChangeRequestForm && <form id={`review-change-request-${courseId}`} className="review-request-form" onSubmit={(event) => { event.preventDefault(); void decideReview('changes_requested', changeRequestNote); }} aria-busy={savingReviewDecision}>
            <label htmlFor={`review-change-note-${courseId}`}>Changes requested (up to 1,000 characters)
              <textarea id={`review-change-note-${courseId}`} value={changeRequestNote} onChange={(event) => setChangeRequestNote(event.target.value)} maxLength={1000} rows={4} required autoFocus aria-describedby={`review-change-note-help-${courseId}`} placeholder="Describe what the editor should update before this revision can be published." />
            </label>
            <div className="review-request-form-footer"><small id={`review-change-note-help-${courseId}`}>The course editor will see this feedback. {changeRequestNote.length}/1,000 characters.</small><div className="review-request-form-actions">
              <Button type="button" variant="secondary" disabled={savingReviewDecision} onClick={() => { setShowChangeRequestForm(false); setChangeRequestNote(''); setError(''); requestChangesButtonRef.current?.focus(); }}>Cancel</Button>
              <Button type="submit" disabled={savingReviewDecision}>{savingReviewDecision ? 'Sending…' : 'Send request'}</Button>
            </div></div>
          </form>}
        </>}
      </div>}
      {governanceReady && competencies.length > 0 && <fieldset className="course-competency-picker" disabled={savingCompetencyMapping} aria-busy={savingCompetencyMapping}><legend>Mapped competencies</legend><p>Any completed mapped course marks an active competency achieved for that learner.</p><label className="course-competency-filter">Search competencies<input type="search" maxLength={160} placeholder="Search by competency name" value={competencySearch} onChange={(event) => setCompetencySearch(event.target.value)} /></label><div>{visibleCompetencies.map((competency) => {
        const selected = selectedCompetencyIds.has(competency.id);
        const addBlocked = !selected && selectedCompetencies.length >= competencySelectionLimit;
        return <label key={competency.id} className={addBlocked ? 'competency-selection-disabled' : undefined}><input type="checkbox" checked={selected} disabled={addBlocked} onChange={(event) => { setCompetencyMappingError(''); setCompetencyMappingNotice(''); setSelectedCompetencies((current) => updateCourseCompetencySelection(current, competency.id, event.target.checked, competencySelectionLimit)); }} /><span>{competency.title}{!competency.active && <small>Inactive · hidden from learners</small>}</span></label>;
      })}</div>{visibleCompetencies.length === 0 && <p className="course-competency-no-results" role="status">No competencies match your search.</p>}{competencyMappingError && <div className="inline-notice" role="alert">{competencyMappingError}</div>}{competencyMappingNotice && <div className="inline-notice inline-notice-success" role="status">{competencyMappingNotice}</div>}<p className="course-competency-selection-status" role="status" aria-live="polite">{selectedCompetencies.length} of {competencySelectionLimit} competencies selected.{competencyMappingOverLimit ? ` Remove at least ${selectedCompetencies.length - competencySelectionLimit} before saving.` : selectedCompetencies.length === competencySelectionLimit ? ' Remove one before adding another.' : ''}</p><Button type="button" variant="secondary" onClick={() => void saveCompetencyMapping()} disabled={savingCompetencyMapping || competencyMappingOverLimit}>{savingCompetencyMapping ? 'Saving mapping…' : 'Save competency mapping'}</Button></fieldset>}
      {governanceReady && (versionTotal > 0 || currentVersion) && <div className="course-version-history"><h3>Published version history</h3>
        {versionHistoryError && <div className="error-notice-actionable" role="alert"><span>{versionHistoryError}</span><Button variant="secondary" disabled={versionHistoryLoading} onClick={() => void loadVersionHistory(versionPage)}>Retry version history</Button></div>}
        {versionHistoryLoading && <p role="status">Loading course versions…</p>}
        {currentVersion && <ol className="course-version-current"><li key={currentVersion.id}>
          <div><strong>Version {currentVersion.version_number}<span className="current-version-label">Current</span></strong><small>{currentVersion.title} · Published {logTimestampFormatter.format(new Date(currentVersion.published_at))}{currentVersion.publisher ? ` by ${currentVersion.publisher}` : ''}</small>{currentVersion.change_note && <p>{currentVersion.change_note}</p>}</div>
        </li></ol>}
        {versionTotal > 0 && <details className="course-version-history-disclosure">
          <summary>Previous versions <span>{versionTotal}</span></summary>
          <ol>{versions.map((version) => {
          const restoring = restoringVersionRequests.has(`${courseId}:${version.id}`);
          return <li key={version.id}>
        <div><strong>Version {version.version_number}</strong><small>{version.title} · Published {logTimestampFormatter.format(new Date(version.published_at))}{version.publisher ? ` by ${version.publisher}` : ''}</small>{version.change_note && <p>{version.change_note}</p>}</div>
        <Button type="button" variant="secondary" aria-label={`Restore version ${version.version_number} as a new course version`} disabled={restoring} aria-busy={restoring} onClick={() => void restoreVersion(version)}>{restoring ? 'Restoring version…' : 'Restore as new version'}</Button>
      </li>;
          })}</ol>
          <CourseVersionPagination page={versionPage} pageSize={versionPageSize} total={versionTotal} versions={versions} loading={versionHistoryLoading} onChange={(nextPage) => void loadVersionHistory(nextPage)} />
        </details>}
      </div>}
    </section>
    <section className="editor-section curriculum-editor-section">
      <div className="curriculum-editor-title"><div><h2>Course curriculum</h2><p>Organize lessons into modules and add a quiz when you are ready.</p></div><div className="curriculum-editor-actions"><Button ref={addModuleButtonRef} variant="secondary" aria-expanded={addingModule} aria-controls={addingModule ? 'add-module-form' : undefined} onClick={(event) => { if (addingModule) setAddingModule(false); else { addModuleInvokerRef.current = event.currentTarget; setAddingModule(true); } }}><Plus size={17} />Add module</Button></div></div>
      {addingModule && <form id="add-module-form" className="inline-add-form" onSubmit={addModule}><input autoFocus value={moduleTitle} onChange={(event) => setModuleTitle(event.target.value)} placeholder="Module title" aria-label="Module title" maxLength={160} disabled={addingModuleBusy} /><Button type="submit" disabled={!moduleTitle.trim() || addingModuleBusy}>{addingModuleBusy ? 'Adding module…' : 'Add module'}</Button><button type="button" className="text-action" disabled={addingModuleBusy} onClick={() => { setAddingModule(false); addModuleInvokerRef.current?.focus(); }}>Cancel</button></form>}
      <div className="module-editor-list">
        {course.modules?.map((module, moduleIndex) => <div className="module-editor" key={module.id}>
          <div className="module-editor-heading"><button type="button" className="module-disclosure" onClick={() => setExpanded({ ...expanded, [module.id]: !(expanded[module.id] ?? true) })} aria-label={`${expanded[module.id] ?? true ? 'Collapse' : 'Expand'} ${module.title}`} aria-expanded={expanded[module.id] ?? true}><ChevronDown className={(expanded[module.id] ?? true) ? '' : 'chevron-collapsed'} size={18} /></button><BookOpen size={18} /><h3 className="module-name-heading"><button type="button" className="module-name-button" onClick={() => editModule(module)}>{module.title}</button></h3><span className="module-item-count">{formatCountLabel(module.lessons.length + (module.quiz ? 1 : 0), 'item', 'items')}</span><div className="module-tools"><button type="button" title={movingCurriculumItems.has(`module:${module.id}`) ? 'Moving module…' : 'Move module up'} aria-label={movingCurriculumItems.has(`module:${module.id}`) ? `Moving ${module.title}` : `Move ${module.title} up`} aria-busy={movingCurriculumItems.has(`module:${module.id}`)} disabled={moduleIndex === 0 || isMovingCurriculum} onClick={() => moveItem(`/api/manage/modules/${module.id}/move`, 'up', `module:${module.id}`)}><ArrowUp size={16} /></button><button type="button" title={movingCurriculumItems.has(`module:${module.id}`) ? 'Moving module…' : 'Move module down'} aria-label={movingCurriculumItems.has(`module:${module.id}`) ? `Moving ${module.title}` : `Move ${module.title} down`} aria-busy={movingCurriculumItems.has(`module:${module.id}`)} disabled={moduleIndex === (course.modules?.length || 0) - 1 || isMovingCurriculum} onClick={() => moveItem(`/api/manage/modules/${module.id}/move`, 'down', `module:${module.id}`)}><ArrowDown size={16} /></button><button type="button" title={deletingCurriculumItem === `module:${module.id}` ? 'Removing module…' : 'Remove module'} aria-label={deletingCurriculumItem === `module:${module.id}` ? `Removing module ${module.title}` : `Remove module ${module.title}`} aria-busy={deletingCurriculumItem === `module:${module.id}`} disabled={saving || deletingCourse || Boolean(deletingCurriculumItem)} className="danger-icon" onClick={() => deleteModule(module)}><Trash2 size={16} /></button></div></div>
          {(expanded[module.id] ?? true) && <div className="module-editor-content">
            {module.lessons.map((lesson, lessonIndex) => <div className="lesson-editor-item" key={lesson.id}>
              <div className="lesson-editor-row">
                <span className="lesson-grip"><FileText size={17} /></span><button type="button" className="lesson-name-button" aria-expanded={editingLessonId === lesson.id} aria-controls={editingLessonId === lesson.id ? `lesson-details-${lesson.id}` : undefined} onClick={() => setEditingLessonId(editingLessonId === lesson.id ? '' : lesson.id)}>{lesson.title}</button>
                {lesson.hasVideo ? <span className="video-file-label"><Check size={15} />{lesson.videoName}</span> : <><label className={`button button-upload-small file-button ${uploading[lesson.id] !== undefined ? 'file-button-busy' : ''}`} aria-disabled={uploading[lesson.id] !== undefined}><Upload size={15} />{uploading[lesson.id] === undefined ? 'Upload video' : uploading[lesson.id] >= 100 ? 'Saving video…' : 'Uploading video…'}<input type="file" accept="video/mp4,.mp4" aria-describedby={`lesson-video-format-help-${lesson.id}`} disabled={uploading[lesson.id] !== undefined} onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadVideo(lesson.id, file, event.currentTarget); event.currentTarget.value = ''; }} /></label><span id={`lesson-video-format-help-${lesson.id}`} className="sr-only">Choose an MP4 video file.</span></>}
                {uploading[lesson.id] !== undefined && (uploading[lesson.id] >= 100 ? <div className="upload-progress upload-progress-saving" role="status">Saving video…</div> : <div className="upload-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploading[lesson.id]} aria-label={`Video upload progress for ${lesson.title}`}><span style={{ width: `${uploading[lesson.id]}%` }} /><small>{uploading[lesson.id]}%</small></div>)}
                {uploading[lesson.id] !== undefined && uploading[lesson.id] < 100 && <button type="button" className="text-action upload-cancel-action" aria-label={`Cancel video upload for ${lesson.title}`} onClick={() => cancelUpload(`video:${lesson.id}`)}>Cancel upload</button>}
                <div className="lesson-tools"><button type="button" className="lesson-edit-action" title="Edit lesson details" aria-label={`Edit details for ${lesson.title}`} aria-expanded={editingLessonId === lesson.id} aria-controls={editingLessonId === lesson.id ? `lesson-details-${lesson.id}` : undefined} onClick={() => setEditingLessonId(editingLessonId === lesson.id ? '' : lesson.id)}><Pencil size={14} /><span>Details</span></button><button type="button" title={movingCurriculumItems.has(`lesson:${lesson.id}`) ? 'Moving lesson…' : 'Move lesson up'} aria-label={movingCurriculumItems.has(`lesson:${lesson.id}`) ? `Moving ${lesson.title}` : `Move ${lesson.title} up`} aria-busy={movingCurriculumItems.has(`lesson:${lesson.id}`)} disabled={lessonIndex === 0 || isMovingCurriculum} onClick={() => moveItem(`/api/manage/lessons/${lesson.id}/move`, 'up', `lesson:${lesson.id}`)}><ArrowUp size={15} /></button><button type="button" title={movingCurriculumItems.has(`lesson:${lesson.id}`) ? 'Moving lesson…' : 'Move lesson down'} aria-label={movingCurriculumItems.has(`lesson:${lesson.id}`) ? `Moving ${lesson.title}` : `Move ${lesson.title} down`} aria-busy={movingCurriculumItems.has(`lesson:${lesson.id}`)} disabled={lessonIndex === module.lessons.length - 1 || isMovingCurriculum} onClick={() => moveItem(`/api/manage/lessons/${lesson.id}/move`, 'down', `lesson:${lesson.id}`)}><ArrowDown size={15} /></button><button type="button" title={deletingCurriculumItem === `lesson:${lesson.id}` ? 'Removing lesson…' : 'Remove lesson'} aria-label={deletingCurriculumItem === `lesson:${lesson.id}` ? `Removing lesson ${lesson.title}` : `Remove lesson ${lesson.title}`} aria-busy={deletingCurriculumItem === `lesson:${lesson.id}`} disabled={saving || deletingCourse || Boolean(deletingCurriculumItem)} className="danger-icon" onClick={() => deleteLesson(lesson.id, lesson.title)}><Trash2 size={15} /></button></div>
              </div>
              {editingLessonId === lesson.id && <LessonDetailsEditor lesson={lesson} courseId={courseId} beforeChange={saveCourseDetailsIfChanged} onChanged={load} onClose={() => setEditingLessonId('')} onError={setError} onNotice={setNotice} />}
            </div>)}
            <div className="module-add-actions"><button type="button" className="text-action" disabled={addingLessonModuleIds.has(module.id)} onClick={() => addLesson(module.id)}><Plus size={15} />{addingLessonModuleIds.has(module.id) ? 'Adding lesson…' : 'Add lesson'}</button><span className="add-action-divider" /><button type="button" className="text-action" onClick={async () => {
              if (module.quiz) { setError('This module already has a quiz.'); return; }
              try { await saveCourseDetailsIfChanged(); await api.put(`/api/manage/modules/${module.id}/quiz`, { title: defaultQuizTitle(module.title), passMark: 70, questions: [] }); await load(); }
              catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Quiz could not be added.'); }
            }} disabled={Boolean(module.quiz)}><CircleHelp size={15} />{module.quiz ? 'Quiz added' : 'Add module quiz'}</button></div>
            {module.quiz && <QuizEditor module={module} onSaved={async () => {
              try { await saveCourseDetailsIfChanged(); await load(); setNotice('Quiz saved.'); }
              catch (cause) { setError(cause instanceof ApiError ? `Quiz saved, but course details could not be saved: ${cause.message}` : 'Quiz saved, but course details could not be saved.'); }
            }} onError={setError} />}
          </div>}
        </div>)}
        {!course.modules?.length && <EmptyState headingLevel={3} icon={<BookOpen size={22} />} title="Start with a module" detail="Modules organize the video lessons in your course." action={<Button variant="secondary" onClick={(event) => { addModuleInvokerRef.current = event.currentTarget; setAddingModule(true); }}><Plus size={16} />Add module</Button>} />}
      </div>
    </section>
    {course.status === 'archived' && <div className="delete-course-row"><div><strong>Delete this course permanently</strong><span>This also removes its uploaded media and cannot be undone.</span></div><Button variant="danger" onClick={deleteArchivedCourse} disabled={saving || deletingCourse || Boolean(deletingCurriculumItem)} aria-busy={deletingCourse}><Trash2 size={16} />{deletingCourse ? 'Deleting course…' : 'Delete course'}</Button></div>}
  </div>;
}

export function CourseAccessPage() {
  const { courseId = '' } = useParams();
  const { user } = useAuth();
  const loadSequenceRef = useRef(0);
  const loadControllerRef = useRef<AbortController | null>(null);
  const routeCourseIdRef = useRef(courseId);
  routeCourseIdRef.current = courseId;
  const [course, setCourse] = useState<Course | null>(null);
  const [users, setUsers] = useState<CourseAccessUser[]>([]);
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [page, setPage] = useState(1);
  const accessListStateRef = useRef({ query: appliedQuery, page });
  accessListStateRef.current = { query: appliedQuery, page };
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [failedRequest, setFailedRequest] = useState<{ query: string; page: number } | null>(null);
  const [savingIds, setSavingIds] = useState<Set<string>>(() => new Set());
  const savingIdsRef = useRef(savingIds);

  function markSaving(userId: string, saving: boolean) {
    const next = new Set(savingIdsRef.current);
    if (saving) next.add(userId);
    else next.delete(userId);
    savingIdsRef.current = next;
    setSavingIds(next);
  }

  async function load(search = appliedQuery, requestedPage = page, failureMessage = 'Access list could not be loaded.') {
    accessListStateRef.current = { query: search, page: requestedPage };
    const requestSequence = ++loadSequenceRef.current;
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    const requestedCourseId = courseId;
    const isCurrentRequest = () => requestSequence === loadSequenceRef.current && routeCourseIdRef.current === requestedCourseId;
    setLoading(true);
    setError('');
    setFailedRequest(null);
    try {
      const courseRequest = course?.id === requestedCourseId ? Promise.resolve({ course }) : fetchCourse(requestedCourseId, true, { signal: controller.signal });
      const [courseResponse, accessResponse] = await Promise.all([courseRequest, fetchAccess(requestedCourseId, search.trim(), requestedPage, { signal: controller.signal })]);
      if (!isCurrentRequest()) return;
      setCourse(courseResponse.course); setUsers(accessResponse.users); setTotal(accessResponse.total); setPage(accessResponse.page); setPageSize(accessResponse.pageSize);
    } catch (cause) {
      if (isCurrentRequest()) {
        controller.abort();
        const detail = cause instanceof ApiError ? cause.message : '';
        setError(failureMessage === 'Access list could not be loaded.' ? detail || failureMessage : `${failureMessage}${detail ? ` ${detail}` : ''}`);
        setFailedRequest({ query: search, page: requestedPage });
      }
    } finally {
      if (isCurrentRequest()) {
        loadControllerRef.current = null;
        setLoading(false);
      }
    }
  }
  useEffect(() => {
    setCourse(null); setUsers([]); setQuery(''); setAppliedQuery(''); setPage(1); setTotal(0);
    savingIdsRef.current = new Set(); setSavingIds(savingIdsRef.current);
    load('', 1);
    return () => { loadSequenceRef.current += 1; loadControllerRef.current?.abort(); };
  }, [courseId]);

  async function toggle(user: CourseAccessUser) {
    if (savingIdsRef.current.has(user.id)) return;
    const requestedCourseId = courseId;
    markSaving(user.id, true); setError('');
    try {
      if (user.granted) await api.delete(`/api/manage/courses/${requestedCourseId}/access/${user.id}`);
      else await api.put(`/api/manage/courses/${requestedCourseId}/access/${user.id}`);
      if (routeCourseIdRef.current === requestedCourseId) {
        const currentListState = accessListStateRef.current;
        await load(currentListState.query, currentListState.page, 'Access changed, but the learner list could not be refreshed.');
      }
    } catch (cause) {
      if (routeCourseIdRef.current === requestedCourseId) setError(cause instanceof ApiError ? cause.message : 'Access could not be changed.');
    } finally {
      if (routeCourseIdRef.current === requestedCourseId) markSaving(user.id, false);
    }
  }

  if (loading || (course && course.id !== courseId)) return <div className="page-loading" role="status" aria-live="polite">Loading course access…</div>;
  return <div className="access-page"><div className="breadcrumbs"><Link to="/manage/courses">Courses</Link><span>/</span><Link to={`/manage/courses/${courseId}/edit`}>{course?.title || 'Course'}</Link><span>/</span><span>Assign learners</span></div>
    <PageHeading title="Assign learners" subtitle={`Choose which learners should see ${course?.title || 'this course'} in My learning.`} action={<Link className="button button-secondary" to={`/manage/courses/${courseId}/edit`}><ArrowLeft size={16} />Back to course</Link>} />
    {error && (failedRequest
      ? <div className="account-list-error"><Notice>{error}</Notice><Button type="button" variant="secondary" onClick={() => { void load(failedRequest.query, failedRequest.page); }}>Try again</Button></div>
      : <Notice>{error}</Notice>)}
    <form className="access-search" onSubmit={(event) => { event.preventDefault(); const search = query.trim(); setAppliedQuery(search); setPage(1); load(search, 1); }}><Search size={18} /><input placeholder="Search learners by username or email" aria-label="Search learners by username or email" maxLength={100} value={query} onChange={(event) => setQuery(event.target.value)} /><Button variant="secondary" type="submit">Search</Button></form>
    <div className="access-list">
      <div className="access-list-head"><span>Learner</span><span>Assignment</span><span>Action</span></div>
      {!failedRequest && users.length ? <ul className="access-rows" aria-label="Learner access">
        {users.map((learner) => <li className="access-row" key={learner.id}>
          <div className="access-user"><UserInitial username={learner.username} /><div><strong>{learner.username}</strong>{learner.granted && learner.grantedAt && <small>Assigned <DateText value={learner.grantedAt} />{learner.grantedBy ? ` by ${learner.grantedBy}` : ''}</small>}</div></div>
          <span className={learner.granted ? 'access-state access-state-granted' : 'access-state'}>{learner.granted ? 'Assigned' : 'Not assigned'}</span>
          <div>{learner.disabled ? <span className="muted">Account disabled</span> : <button type="button" className={learner.granted ? 'text-action danger-text' : 'text-action'} aria-label={learner.granted ? `Unassign ${learner.username} from ${course?.title || 'this course'}` : `Assign ${learner.username} to ${course?.title || 'this course'}`} disabled={savingIds.has(learner.id)} onClick={() => toggle(learner)}>{learner.granted ? 'Unassign' : 'Assign course'}</button>}</div>
        </li>)}
      </ul> : !failedRequest && <div className="access-empty">{appliedQuery ? 'No learners match that search.' : user?.role === 'admin' ? <>No learner accounts are available. <Link className="text-action" to="/admin/users/new">Create a learner account.</Link></> : 'No learner accounts are available. Registered learners and accounts created by an administrator will appear here.'}</div>}
    </div>
    {!failedRequest && total > 0 && <LogPagination page={page} pageSize={pageSize} total={total} loading={loading} onChange={(nextPage) => load(appliedQuery, nextPage)} />}
    <p className="access-footnote"><LockKeyhole size={15} />Assigned learners will find this course in My learning. Public courses remain available in the catalog; private courses require an active assignment. Removing an assignment does not erase learning progress.</p>
  </div>;
}

type UserApprovalFilter = 'all' | 'pending' | 'approved';

export function AdminUsersPage() {
  const { user: signedInUser, refresh } = useAuth();
  const resetPasswordHintId = useId();
  const loadSequenceRef = useRef(0);
  const loadControllerRef = useRef<AbortController | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRoleFilter>('all');
  const [approvalFilter, setApprovalFilter] = useState<UserApprovalFilter>('all');
  const [page, setPage] = useState(1);
  const userListStateRef = useRef({ query: appliedQuery, roleFilter, approvalFilter, page });
  userListStateRef.current = { query: appliedQuery, roleFilter, approvalFilter, page };
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [failedRequest, setFailedRequest] = useState<{ page: number; query: string; roleFilter: UserRoleFilter; approvalFilter: UserApprovalFilter } | null>(null);
  const [savingIds, setSavingIds] = useState<Set<string>>(() => new Set());
  const savingIdsRef = useRef(savingIds);
  const [resetUser, setResetUser] = useState<User | null>(null);
  const resetUserRef = useRef<User | null>(null);
  const resetDialogRef = useRef<HTMLElement | null>(null);
  const resetTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [success, setSuccess] = useState('');

  function markSaving(userId: string, saving: boolean) {
    const next = new Set(savingIdsRef.current);
    if (saving) next.add(userId);
    else next.delete(userId);
    savingIdsRef.current = next;
    setSavingIds(next);
  }

  function openPasswordReset(user: User, trigger: HTMLButtonElement) {
    resetUserRef.current = user;
    resetTriggerRef.current = trigger;
    setNewPassword('');
    setConfirmPassword('');
    setError('');
    setSuccess('');
    setResetUser(user);
  }

  function closePasswordReset(expectedUserId?: string) {
    if (expectedUserId && resetUserRef.current?.id !== expectedUserId) return;
    if (resetUserRef.current && savingIdsRef.current.has(resetUserRef.current.id)) return;
    resetUserRef.current = null;
    setResetUser(null);
    setNewPassword('');
    setConfirmPassword('');
    setError('');
  }

  async function load(requestedPage = page, requestedQuery = appliedQuery, requestedRoleFilter = roleFilter, requestedApprovalFilter = approvalFilter): Promise<boolean> {
    userListStateRef.current = { query: requestedQuery, roleFilter: requestedRoleFilter, approvalFilter: requestedApprovalFilter, page: requestedPage };
    const requestSequence = ++loadSequenceRef.current;
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    setLoading(true); setError(''); setFailedRequest(null);
    try {
      const params = new URLSearchParams(); if (requestedQuery.trim()) params.set('q', requestedQuery.trim()); if (requestedRoleFilter !== 'all') params.set('role', requestedRoleFilter); if (requestedApprovalFilter !== 'all') params.set('registrationStatus', requestedApprovalFilter);
      params.set('page', String(requestedPage));
      const response = await api.get<{ users: User[]; total: number; page: number; pageSize: number }>(`/api/admin/users?${params}`, { signal: controller.signal });
      if (requestSequence === loadSequenceRef.current) {
        setUsers(response.users); setTotal(response.total); setPage(response.page); setPageSize(response.pageSize);
        setAppliedQuery(requestedQuery.trim());
        return true;
      }
      return false;
    } catch (cause) {
      if (requestSequence === loadSequenceRef.current) {
        setError(cause instanceof ApiError ? cause.message : 'Users could not be loaded.');
        setFailedRequest({ page: requestedPage, query: requestedQuery, roleFilter: requestedRoleFilter, approvalFilter: requestedApprovalFilter });
      }
      return false;
    } finally {
      if (requestSequence === loadSequenceRef.current) {
        loadControllerRef.current = null;
        setLoading(false);
      }
    }
  }
  useEffect(() => {
    load(1);
    return () => { loadSequenceRef.current += 1; loadControllerRef.current?.abort(); };
  }, [roleFilter, approvalFilter]);

  useEffect(() => {
    if (!resetUser) return;
    const dialog = resetDialogRef.current;
    const previousFocus = resetTriggerRef.current;
    const getFocusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    ) ?? []);
    dialog?.querySelector<HTMLElement>('[autofocus]')?.focus();

    // A document listener keeps Tab inside the aria-modal dialog if focus leaves its controls.
    function handleDialogKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePasswordReset();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = getFocusable();
      if (!focusable.length) {
        event.preventDefault();
        dialog?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog || !dialog?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog || !dialog?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleDialogKeyDown);
    return () => {
      document.removeEventListener('keydown', handleDialogKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [resetUser]);

  async function updateUser(user: User, changes: { role?: Role; disabled?: boolean }) {
    if (savingIdsRef.current.has(user.id)) return;
    if (changes.disabled === true && !window.confirm(accountDisableConfirmation(user.username))) return;
    markSaving(user.id, true); setError(''); setSuccess('');
    try {
      const response = await api.patch<{ user: User }>(`/api/admin/users/${user.id}`, changes);
      const selfAccessChanged = signedInUser?.id === response.user.id
        && (signedInUser.role !== response.user.role || signedInUser.disabled !== response.user.disabled);
      if (selfAccessChanged) {
        try { await refresh(); }
        catch {
          setError('Account updated, but your access could not be refreshed. Reload this page to apply the change.');
          return;
        }
      } else if (changes.role !== undefined || (changes.disabled !== undefined && user.role === 'admin')) {
        const currentListState = userListStateRef.current;
        if (!(await load(currentListState.page, currentListState.query, currentListState.roleFilter, currentListState.approvalFilter))) return;
      } else {
        setUsers((current) => current.map((row) => row.id === user.id ? { ...row, ...response.user } : row));
      }
      setSuccess(`${user.username}'s account was updated.`);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'last_admin') {
        const currentListState = userListStateRef.current;
        if (await load(currentListState.page, currentListState.query, currentListState.roleFilter, currentListState.approvalFilter)) setError(cause.message);
      } else {
        setError(cause instanceof ApiError ? cause.message : 'User could not be updated.');
      }
    }
    finally { markSaving(user.id, false); }
  }

  async function resetPassword(event: React.FormEvent) {
    event.preventDefault();
    const user = resetUser;
    if (!user || savingIdsRef.current.has(user.id)) return;
    const confirmationError = getPasswordConfirmationError(newPassword, confirmPassword);
    if (confirmationError) { setError(confirmationError); return; }
    markSaving(user.id, true); setError(''); setSuccess('');
    try {
      await api.put(`/api/admin/users/${user.id}/password`, { password: newPassword, confirmPassword });
      markSaving(user.id, false);
      if (signedInUser?.id === user.id) {
        if (resetUserRef.current?.id === user.id) closePasswordReset(user.id);
        try { await refresh(); }
        catch { setError('Password reset, but your access could not be refreshed. Reload this page to sign in again.'); }
        return;
      }
      const activeDialogUserId = resetUserRef.current?.id;
      if (!activeDialogUserId || activeDialogUserId === user.id) {
        setSuccess(`Password reset for ${user.username}. They will need to sign in again.`);
        if (activeDialogUserId === user.id) closePasswordReset(user.id);
      }
    } catch (cause) {
      if (!resetUserRef.current || resetUserRef.current.id === user.id) {
        setError(cause instanceof ApiError ? cause.message : 'Password could not be reset.');
      }
    }
    finally { markSaving(user.id, false); }
  }

  async function approveRegistration(user: User) {
    if (savingIdsRef.current.has(user.id)) return;
    markSaving(user.id, true); setError(''); setSuccess('');
    try {
      const response = await api.patch<{ user: User }>(`/api/admin/users/${user.id}/approval`, {});
      const currentListState = userListStateRef.current;
      if (!(await load(currentListState.page, currentListState.query, currentListState.roleFilter, currentListState.approvalFilter))) return;
      setSuccess(response.user.disabled
        ? `${user.username}'s registration was approved. The account is disabled, so enable it before they can sign in.`
        : `${user.username}'s registration was approved. They can now sign in.`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Registration could not be approved.');
    } finally { markSaving(user.id, false); }
  }

  return <div className="management-page users-page"><PageHeading title="Users" subtitle="Create accounts, review learning activity, and manage roles and access." action={<Link className="button button-primary" to="/admin/users/new"><Plus size={17} />Create account</Link>} />
    <div className="user-filter-row"><form className="management-search" onSubmit={(event) => { event.preventDefault(); const search = query.trim(); setAppliedQuery(search); void load(1, search, roleFilter, approvalFilter); }}><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search username or email" aria-label="Search username or email" maxLength={100} /><button type="submit">Search</button></form><div className="select-wrap role-filter user-role-filter"><span className="catalog-filter-label">Role</span><AppSelect className="app-select--filter" ariaLabel="Filter by role" leadingIcon={<UsersRound size={16} />} value={roleFilter} onChange={setRoleFilter} options={[{ value: 'all', label: 'All roles' }, { value: 'admin', label: 'Administrators' }, { value: 'moderator', label: 'Moderators' }, { value: 'learner', label: 'Learners' }]} /></div><div className="select-wrap role-filter user-approval-filter"><span className="catalog-filter-label">Registration</span><AppSelect className="app-select--filter" ariaLabel="Filter by registration approval" value={approvalFilter} onChange={setApprovalFilter} options={[{ value: 'all', label: 'All accounts' }, { value: 'pending', label: 'Pending approval' }, { value: 'approved', label: 'Approved' }]} /></div></div>
    {error && !resetUser && (failedRequest
      ? <div className="account-list-error"><Notice>{error}</Notice><Button type="button" variant="secondary" onClick={() => { void load(failedRequest.page, failedRequest.query, failedRequest.roleFilter, failedRequest.approvalFilter); }}>Try again</Button></div>
      : <Notice>{error}</Notice>)}
    {success && <Notice kind="success">{success}</Notice>}
    {loading ? <div className="page-loading" role="status" aria-live="polite">Loading accounts…</div> : failedRequest ? null : <div className="user-table-wrap" role="region" aria-label="Scrollable account list" tabIndex={0}><p className="table-scroll-hint">Scroll horizontally to see all account columns.</p><table className="user-table"><caption className="sr-only">Accounts</caption><thead><tr><th scope="col">User</th><th scope="col">Role</th><th scope="col">Account</th><th scope="col">Created</th><th scope="col">Actions</th></tr></thead><tbody>{users.map((user) => {
      const lastAdminHelpId = `last-active-admin-${user.id}`;
      return <tr key={user.id}>
        <td><Link className="owner-cell user-detail-link" to={`/admin/users/${user.id}`}><UserInitial username={user.username} /><span className="user-detail-link-copy"><strong>{user.username}</strong>{user.email && <small>{user.email}</small>}</span></Link></td>
        <td><AppSelect<Role> className="app-select--compact" ariaLabel={`Role for ${user.username}`} describedBy={user.isLastActiveAdmin ? lastAdminHelpId : undefined} value={user.role} disabled={savingIds.has(user.id) || user.isLastActiveAdmin} onChange={(role) => updateUser(user, { role })} options={[{ value: 'admin', label: 'Administrator' }, { value: 'moderator', label: 'Moderator' }, { value: 'learner', label: 'Learner' }]} /></td>
        <td><span className={`account-state ${user.registrationStatus === 'pending' ? 'account-pending' : user.disabled ? 'account-disabled' : 'account-active'}`}><span />{user.registrationStatus === 'pending' ? 'Pending approval' : user.disabled ? 'Disabled' : 'Active'}</span>{user.isLastActiveAdmin && <small className="last-active-admin-note" id={lastAdminHelpId}>This is the only active administrator. Add another administrator before changing this account’s role or status.</small>}</td>
        <td>{user.createdAt ? <DateText value={user.createdAt} /> : '—'}</td>
        <td><div className="user-row-actions">{user.registrationStatus === 'pending' && <button type="button" className="text-action" aria-label={`Approve registration for ${user.username}`} disabled={savingIds.has(user.id)} onClick={() => approveRegistration(user)}>{savingIds.has(user.id) ? 'Approving…' : 'Approve'}</button>}<Link className="text-action" to={`/admin/users/${user.id}`} aria-label={`Details for ${user.username}`}>Details</Link><button type="button" className="text-action" aria-label={`Reset password for ${user.username}`} disabled={savingIds.has(user.id)} onClick={(event) => openPasswordReset(user, event.currentTarget)}>Reset password</button><button type="button" className={user.disabled ? 'text-action' : 'text-action danger-text'} aria-label={`${user.disabled ? 'Enable' : 'Disable'} account for ${user.username}`} aria-describedby={user.isLastActiveAdmin ? lastAdminHelpId : undefined} disabled={savingIds.has(user.id) || user.isLastActiveAdmin} onClick={() => updateUser(user, { disabled: !user.disabled })}>{user.disabled ? 'Enable' : 'Disable'}</button></div></td>
      </tr>;
    })}</tbody></table>{!users.length && <div className="access-empty">{approvalFilter === 'pending' ? appliedQuery ? 'No pending registrations match that search.' : 'No registrations are waiting for approval.' : userListEmptyMessage(appliedQuery, roleFilter)}</div>}</div>}
    {!loading && !failedRequest && total > 0 && <LogPagination page={page} pageSize={pageSize} total={total} loading={loading} onChange={(nextPage) => load(nextPage)} />}
    {resetUser && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closePasswordReset(); }}><section ref={resetDialogRef} className="modal-card" role="dialog" aria-modal="true" aria-labelledby="reset-title" aria-describedby="reset-description" tabIndex={-1}><button className="modal-close" type="button" onClick={() => closePasswordReset()} aria-label="Close" disabled={savingIds.has(resetUser.id)}>×</button><h2 id="reset-title">Reset password</h2><p id="reset-description">Set a temporary password for <strong>{resetUser.username}</strong>. Their active sessions will be signed out.</p><form className="form-stack" onSubmit={resetPassword} aria-busy={savingIds.has(resetUser.id)}><PasswordField label="New password" autoFocus required minLength={12} maxLength={256} autoComplete="new-password" value={newPassword} hint="Use at least 12 characters." hintId={resetPasswordHintId} onChange={(event) => { setNewPassword(event.target.value); setError((currentError) => clearPasswordConfirmationError(currentError)); }} disabled={savingIds.has(resetUser.id)} /><PasswordField label="Confirm password" required minLength={12} maxLength={256} autoComplete="new-password" value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setError((currentError) => clearPasswordConfirmationError(currentError)); }} disabled={savingIds.has(resetUser.id)} />{error && <Notice>{error}</Notice>}<Button type="submit" disabled={savingIds.has(resetUser.id)}>{savingIds.has(resetUser.id) ? 'Saving…' : 'Reset password'}</Button></form></section></div>}
  </div>;
}

export function AdminUserCreatePage() {
  const navigate = useNavigate();
  const roleHelpId = useId();
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<Role>('learner');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function createAccount(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    const confirmationError = getPasswordConfirmationError(password, confirmPassword);
    if (confirmationError) { setError(confirmationError); return; }
    setSaving(true); setError('');
    try {
      const response = await api.post<{ user: User }>('/api/admin/users', { email, firstName, lastName, username, role, password, confirmPassword });
      navigate(`/admin/users/${response.user.id}`, { replace: true });
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'The account could not be created.'); }
    finally { setSaving(false); }
  }

  return <div className="management-page account-form-page"><div className="breadcrumbs"><Link to="/admin/users">Users</Link><span>/</span><span>Create account</span></div>
    <PageHeading title="Create account" subtitle="Set up a sign-in account and assign its platform role." action={<Link className="button button-secondary" to="/admin/users"><ArrowLeft size={16} />Back to users</Link>} />
    <section className="account-form-card"><form className="form-stack" onSubmit={createAccount} aria-busy={saving}>
      <label>Email<input required type="email" maxLength={254} autoComplete="email" autoFocus value={email} onChange={(event) => setEmail(event.target.value)} disabled={saving} /></label>
      <div className="account-name-fields"><label>First name<input required maxLength={80} autoComplete="given-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} disabled={saving} /></label><label>Last name<input required maxLength={80} autoComplete="family-name" value={lastName} onChange={(event) => setLastName(event.target.value)} disabled={saving} /></label></div>
      <label>Username<input required minLength={3} maxLength={32} pattern="[A-Za-z0-9_.-]+" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} disabled={saving} /><small>3–32 letters, numbers, dots, underscores, or hyphens.</small></label>
      <div className="account-form-role-field"><span>Platform role</span><AppSelect<Role> ariaLabel="Platform role" describedBy={roleHelpId} value={role} onChange={setRole} disabled={saving} options={[{ value: 'learner', label: 'Learner' }, { value: 'moderator', label: 'Moderator' }, { value: 'admin', label: 'Administrator' }]} /><small id={roleHelpId}>Choose administrator or moderator only when the person needs management access.</small></div>
      <PasswordField label="Password" required minLength={12} maxLength={256} autoComplete="new-password" value={password} onChange={(event) => { setPassword(event.target.value); setError((currentError) => clearPasswordConfirmationError(currentError)); }} disabled={saving} hint="Use at least 12 characters. You can reset it later from account details." />
      <PasswordField label="Confirm password" required minLength={12} maxLength={256} autoComplete="new-password" value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setError((currentError) => clearPasswordConfirmationError(currentError)); }} disabled={saving} />
      {error && <Notice>{error}</Notice>}
      <div className="account-form-actions"><Button type="submit" disabled={saving}>{saving ? 'Creating account…' : 'Create account'}</Button><span>Manual accounts can be created while public registration is closed. The account limit still applies; no email invitation is sent.</span></div>
    </form></section>
  </div>;
}

type AdminAccountCourse = Course & {
  quizCount: number;
  enrolledAt: string | null;
  grantedAt: string | null;
  learningPathEnrolled: boolean;
};
type AdminAccountDetails = {
  user: User & { createdAt: string; updatedAt: string; lastLoginAt: string | null; isCurrentUser: boolean; isLastActiveAdmin: boolean };
  courses: AdminAccountCourse[];
  registrationFields: SavedRegistrationFieldValue[];
  total: number;
  page: number;
  pageSize: number;
};

function normalizeAccountNameDraft(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

export function AdminUserDetailsPage() {
  const { userId = '' } = useParams();
  const { user: signedInUser, refresh } = useAuth();
  const passwordInputId = `${useId().replaceAll(':', '')}-admin-reset-password`;
  const passwordHintId = `${passwordInputId}-hint`;
  const lastAdminHelpId = `${passwordInputId}-last-admin-help`;
  const routeUserIdRef = useRef(userId);
  const actionSequenceRef = useRef(0);
  if (routeUserIdRef.current !== userId) {
    routeUserIdRef.current = userId;
    actionSequenceRef.current += 1;
  }
  const [account, setAccount] = useState<AdminAccountDetails | null>(null);
  const [page, setPage] = useState(1);
  const [loadRetryVersion, setLoadRetryVersion] = useState(0);
  const [canRetryLoad, setCanRetryLoad] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingAction, setSavingAction] = useState<'account' | 'approval' | 'password' | null>(null);
  const saving = savingAction !== null;
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [profileFirstName, setProfileFirstName] = useState('');
  const [profileLastName, setProfileLastName] = useState('');
  const [profileNamesUserId, setProfileNamesUserId] = useState('');

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setAccount(null); setError(''); setCanRetryLoad(false); setLoading(true);
    api.get<AdminAccountDetails>(`/api/admin/users/${userId}?page=${page}`, { signal: controller.signal })
      .then((result) => { if (active) { setAccount(result); setPage(result.page); } })
      .catch((cause) => {
        if (active) {
          setError(cause instanceof ApiError ? cause.message : 'Account details could not be loaded.');
          setCanRetryLoad(!(cause instanceof ApiError) || [0, 408, 429].includes(cause.status) || cause.status >= 500);
        }
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [userId, page, loadRetryVersion]);
  useEffect(() => {
    if (!account || account.user.id !== userId) return;
    setProfileFirstName(account.user.firstName || '');
    setProfileLastName(account.user.lastName || '');
    setProfileNamesUserId(account.user.id);
  }, [account?.user.id, account?.user.firstName, account?.user.lastName, userId]);
  useEffect(() => {
    setError(''); setSuccess(''); setSavingAction(null); setPassword(''); setConfirmPassword('');
  }, [userId]);

  async function updateAccount(changes: { role?: Role; disabled?: boolean; firstName?: string; lastName?: string }, successMessage = 'Account settings were updated.') {
    if (!account || saving) return;
    if (changes.disabled === true && !window.confirm(accountDisableConfirmation(account.user.username))) return;
    const requestedUserId = account.user.id;
    const actionSequence = ++actionSequenceRef.current;
    const isCurrentAction = () => actionSequenceRef.current === actionSequence && routeUserIdRef.current === requestedUserId;
    setSavingAction('account'); setError(''); setSuccess('');
    try {
      const response = await api.patch<{ user: User & { createdAt?: string; updatedAt?: string; isCurrentUser?: boolean; isLastActiveAdmin: boolean } }>(`/api/admin/users/${requestedUserId}`, changes);
      if (!isCurrentAction()) return;
      setAccount((current) => current?.user.id === requestedUserId ? { ...current, user: {
        ...current.user,
        ...response.user,
        createdAt: current.user.createdAt,
        updatedAt: response.user.updatedAt ?? current.user.updatedAt,
        isCurrentUser: current.user.isCurrentUser,
        isLastActiveAdmin: response.user.isLastActiveAdmin,
      } } : current);
      if (changes.firstName !== undefined || changes.lastName !== undefined) {
        setProfileFirstName(response.user.firstName || '');
        setProfileLastName(response.user.lastName || '');
        setProfileNamesUserId(response.user.id);
      }
      if (signedInUser?.id === response.user.id && (signedInUser.role !== response.user.role || signedInUser.disabled !== response.user.disabled
        || signedInUser.firstName !== response.user.firstName || signedInUser.lastName !== response.user.lastName)) {
        try { await refresh(); }
        catch {
          if (isCurrentAction()) setError('Account updated, but your access could not be refreshed. Reload this page to apply the change.');
          return;
        }
      }
      if (isCurrentAction()) setSuccess(successMessage);
    } catch (cause) {
      if (!isCurrentAction()) return;
      if (cause instanceof ApiError && cause.code === 'last_admin') {
        try {
          const refreshedAccount = await api.get<AdminAccountDetails>(`/api/admin/users/${requestedUserId}?page=${page}`);
          if (!isCurrentAction()) return;
          setAccount(refreshedAccount);
          setPage(refreshedAccount.page);
          setError(cause.message);
        } catch (refreshCause) {
          if (!isCurrentAction()) return;
          setAccount(null);
          setError(refreshCause instanceof ApiError ? refreshCause.message : 'Account details could not be refreshed.');
          setCanRetryLoad(!(refreshCause instanceof ApiError) || [0, 408, 429].includes(refreshCause.status) || refreshCause.status >= 500);
        }
      } else {
        setError(cause instanceof ApiError ? cause.message : 'Account settings could not be updated.');
      }
    }
    finally { if (isCurrentAction()) setSavingAction(null); }
  }

  async function saveAccountName(event: React.FormEvent) {
    event.preventDefault();
    await updateAccount({ firstName: profileFirstName, lastName: profileLastName }, 'Certificate name was updated.');
  }

  async function approveRegistration() {
    if (!account || saving || account.user.registrationStatus !== 'pending') return;
    const requestedUserId = account.user.id;
    const actionSequence = ++actionSequenceRef.current;
    const isCurrentAction = () => actionSequenceRef.current === actionSequence && routeUserIdRef.current === requestedUserId;
    setSavingAction('approval'); setError(''); setSuccess('');
    try {
      const result = await api.patch<{ user: User }>(`/api/admin/users/${requestedUserId}/approval`, {});
      if (!isCurrentAction()) return;
      setAccount((current) => current && current.user.id === requestedUserId ? { ...current, user: { ...current.user, ...result.user } } : current);
      setSuccess(result.user.disabled
        ? `${result.user.username}'s registration was approved. The account is disabled, so enable it before they can sign in.`
        : `${result.user.username}'s registration was approved. They can now sign in.`);
    } catch (cause) {
      if (isCurrentAction()) setError(cause instanceof ApiError ? cause.message : 'Registration could not be approved.');
    } finally { if (isCurrentAction()) setSavingAction(null); }
  }

  async function resetPassword(event: React.FormEvent) {
    event.preventDefault();
    if (!account || saving) return;
    const confirmationError = getPasswordConfirmationError(password, confirmPassword);
    if (confirmationError) { setError(confirmationError); setSuccess(''); return; }
    const requestedUserId = account.user.id;
    const requestedUsername = account.user.username;
    const actionSequence = ++actionSequenceRef.current;
    const isCurrentAction = () => actionSequenceRef.current === actionSequence && routeUserIdRef.current === requestedUserId;
    setSavingAction('password'); setError(''); setSuccess('');
    try {
      await api.put(`/api/admin/users/${requestedUserId}/password`, { password, confirmPassword });
      if (!isCurrentAction()) return;
      setPassword(''); setConfirmPassword('');
      if (signedInUser?.id === requestedUserId) {
        try { await refresh(); }
        catch { if (isCurrentAction()) setError('Password reset, but your access could not be refreshed. Reload this page to sign in again.'); }
        return;
      }
      if (isCurrentAction()) setSuccess(`Password reset for ${requestedUsername}. Their active sessions will be signed out.`);
    } catch (cause) { if (isCurrentAction()) setError(cause instanceof ApiError ? cause.message : 'Password could not be reset.'); }
    finally { if (isCurrentAction()) setSavingAction(null); }
  }

  if (loading || (account && account.user.id !== userId)) return <div className="management-page page-loading" role="status" aria-live="polite">Loading account details…</div>;
  if (!account) return <div className="management-page">{error && <div className="account-list-error"><Notice>{error}</Notice>{canRetryLoad && <Button type="button" variant="secondary" onClick={() => setLoadRetryVersion((version) => version + 1)}>Try again</Button>}</div>}<Link className="back-link" to="/admin/users"><ArrowLeft size={17} />Back to users</Link></div>;
  const { user, courses, registrationFields } = account;
  const certificateNameReady = profileNamesUserId === user.id;
  const certificateNameChanged = certificateNameReady && (normalizeAccountNameDraft(profileFirstName) !== (user.firstName || '')
    || normalizeAccountNameDraft(profileLastName) !== (user.lastName || ''));
  return <div className="management-page account-details-page">
    <div className="breadcrumbs"><Link to="/admin/users">Users</Link><span>/</span><span>{user.username}</span></div>
    <PageHeading title={user.username} subtitle="Account controls, enrolled courses, and learning activity." action={<Link className="button button-secondary" to="/admin/users"><ArrowLeft size={16} />Back to users</Link>} />
    {error && <Notice>{error}</Notice>}{success && <Notice kind="success">{success}</Notice>}
    <section className="account-detail-grid">
      <article className="account-detail-card account-overview-card" aria-labelledby="account-overview-heading"><div className="account-detail-card-heading"><div className="access-user"><UserInitial username={user.username} /><div><strong>{user.username}</strong><h2 id="account-overview-heading" className="account-overview-title">Account overview</h2></div></div><span className={`account-state ${user.registrationStatus === 'pending' ? 'account-pending' : user.disabled ? 'account-disabled' : 'account-active'}`}><span />{user.registrationStatus === 'pending' ? 'Pending approval' : user.disabled ? 'Disabled' : 'Active'}</span></div>
        <dl className="account-meta-list"><div><dt>Email</dt><dd>{user.email || 'Not provided'}</dd></div><div><dt>Registration approval</dt><dd>{user.registrationStatus === 'pending' ? 'Pending' : 'Approved'}</dd></div><div><dt>User ID</dt><dd>{user.id}</dd></div><div><dt>Created</dt><dd><DateText value={user.createdAt} /></dd></div><div><dt>Last login</dt><dd>{user.lastLoginAt ? <DateTimeText value={user.lastLoginAt} /> : 'Not recorded'}</dd></div><div><dt>Last updated</dt><dd><DateText value={user.updatedAt} /></dd></div><div><dt>Courses assigned or enrolled</dt><dd>{account.total}</dd></div></dl>
        <form className="account-profile-form form-stack" onSubmit={saveAccountName} aria-busy={savingAction === 'account'}><div><h3>Certificate name</h3><p>Set the first and last name shown on this user’s certificates.</p></div><div className="account-name-fields"><label>First name<input required maxLength={80} autoComplete="given-name" value={profileFirstName} onChange={(event) => setProfileFirstName(event.target.value)} disabled={saving} /></label><label>Last name<input required maxLength={80} autoComplete="family-name" value={profileLastName} onChange={(event) => setProfileLastName(event.target.value)} disabled={saving} /></label></div><Button type="submit" variant="secondary" disabled={saving || !certificateNameReady || !certificateNameChanged}>{savingAction === 'account' ? 'Saving…' : !certificateNameReady ? 'Loading…' : certificateNameChanged ? 'Save certificate name' : 'No changes'}</Button></form>
        {registrationFields.length > 0 && <section className="account-registration-fields"><h3>Registration details</h3><dl>{registrationFields.map((field) => <div key={field.id}><dt>{field.label}</dt><dd>{typeof field.value === 'boolean' ? field.value ? 'Yes' : 'No' : field.value || 'Not provided'}</dd></div>)}</dl></section>}
        <div className="account-control-row" aria-busy={savingAction === 'account'}>
          <div className="account-role-control"><span id="account-platform-role-label">Platform role</span><AppSelect<Role> className="account-role-select" controlId="account-platform-role" ariaLabel="Platform role" ariaLabelledBy="account-platform-role-label" describedBy={user.isLastActiveAdmin ? lastAdminHelpId : undefined} matchTriggerWidth value={user.role} disabled={saving || user.isLastActiveAdmin} onChange={(role) => updateAccount({ role })} options={[{ value: 'learner', label: 'Learner' }, { value: 'moderator', label: 'Moderator' }, { value: 'admin', label: 'Administrator' }]} /></div>
          {user.registrationStatus === 'pending' && <Button variant="secondary" onClick={approveRegistration} disabled={saving} aria-busy={savingAction === 'approval'}>{savingAction === 'approval' ? 'Approving registration…' : 'Approve registration'}</Button>}
          <Button variant={user.disabled ? 'secondary' : 'danger'} onClick={() => updateAccount({ disabled: !user.disabled })} disabled={saving || user.isLastActiveAdmin} aria-describedby={user.isLastActiveAdmin ? lastAdminHelpId : undefined} aria-busy={savingAction === 'account'}>{savingAction === 'account' ? 'Saving account…' : user.disabled ? 'Enable account' : 'Disable account'}</Button>
          {savingAction && <span className="sr-only" role="status" aria-live="polite">{savingAction === 'approval' ? 'Approving registration…' : savingAction === 'account' ? 'Saving account settings…' : 'Resetting password…'}</span>}
        </div>
        {user.isLastActiveAdmin && <p className="account-admin-protection" id={lastAdminHelpId}>This is the only active administrator. Add another administrator before changing this account’s role or status.</p>}
      </article>
      <article className="account-detail-card"><div className="account-detail-card-heading"><div><h2>Reset password</h2><p>Set a new password and sign out existing sessions.</p></div></div><form className="form-stack account-password-form" onSubmit={resetPassword} aria-busy={savingAction === 'password'}><PasswordField label="New password" id={passwordInputId} required minLength={12} maxLength={256} autoComplete="new-password" value={password} onChange={(event) => { setPassword(event.target.value); setError((currentError) => clearPasswordConfirmationError(currentError)); }} disabled={saving} hint="Use at least 12 characters." hintId={passwordHintId} /><PasswordField label="Confirm password" required minLength={12} maxLength={256} autoComplete="new-password" value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setError((currentError) => clearPasswordConfirmationError(currentError)); }} disabled={saving} /><Button type="submit" disabled={saving} aria-busy={savingAction === 'password'}>{savingAction === 'password' ? 'Saving…' : 'Reset password'}</Button></form></article>
    </section>
    <section className="analytics-section account-courses-section"><div className="analytics-section-heading"><div><h2>Course activity</h2><p>Courses this account has enrolled in or been assigned.</p></div><span>{formatCountLabel(account.total, 'course', 'courses')}</span></div>
      {courses.length ? <div className="analytics-table-wrap" role="region" aria-label="Scrollable course activity" tabIndex={0}><table className="analytics-table"><caption className="sr-only">Account course activity</caption><thead><tr><th scope="col">Course</th><th scope="col">Assignment</th><th scope="col">Progress</th><th scope="col">Lessons</th><th scope="col">Quizzes</th><th scope="col">Completion</th><th scope="col">Dashboard</th></tr></thead><tbody>{courses.map((course) => <tr key={course.id}><td><strong>{course.title}</strong><small><CourseStatus status={course.status} /></small></td><td>{accountCourseAssignmentLabel(course)}</td><td>{course.progress}%</td><td>{course.completedLessons} / {course.lessonCount}</td><td>{course.quizCount}</td><td>{course.completed ? 'Completed' : course.progress ? 'In progress' : 'Not started'}</td><td><Link className="text-action" to={`/manage/courses/${course.id}/analytics`} aria-label={`Open dashboard for ${course.title}`}>Open dashboard</Link></td></tr>)}</tbody></table></div> : <EmptyState headingLevel={3} title="No course activity" detail="This account has not enrolled in or been assigned a course." />}
      {account.total > 0 && <LogPagination page={account.page} pageSize={account.pageSize} total={account.total} loading={loading} onChange={setPage} />}
    </section>
  </div>;
}

export function AdminSettingsPage() {
  const { platformName, platformIcon, themePalette, connectionProtocol, registrationEnabled, registrationApprovalRequired, userLimit, setBranding, setPlatformAccessSettings } = useAuth();
  const [name, setName] = useState(platformName);
  const [icon, setIcon] = useState<string | null>(platformIcon);
  const [iconEdited, setIconEdited] = useState(false);
  const [palette, setPalette] = useState<BrandingPalette>(themePalette);
  const [protocol, setProtocol] = useState<ConnectionProtocol>(connectionProtocol);
  const [allowRegistration, setAllowRegistration] = useState(registrationEnabled);
  const [requireRegistrationApproval, setRequireRegistrationApproval] = useState(registrationApprovalRequired);
  const [userLimitValue, setUserLimitValue] = useState(String(userLimit));
  const [registeredUserCount, setRegisteredUserCount] = useState<number | null>(null);
  const [registeredUserCountError, setRegisteredUserCountError] = useState('');
  const [registeredUserCountRetryVersion, setRegisteredUserCountRetryVersion] = useState(0);
  const registeredUserCountRevisionRef = useRef(0);
  const registeredUserCountControllerRef = useRef<AbortController | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [resetState, setResetState] = useState<PlatformResetStatus>({ pending: false });
  const [resetPhrase, setResetPhrase] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetSuccess, setResetSuccess] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [resetStatusLoaded, setResetStatusLoaded] = useState(false);
  useEffect(() => { setName(platformName); setIcon(platformIcon); setIconEdited(false); setPalette(themePalette); setProtocol(connectionProtocol); setAllowRegistration(registrationEnabled); setRequireRegistrationApproval(registrationApprovalRequired); setUserLimitValue(String(userLimit)); }, [platformName, platformIcon, themePalette, connectionProtocol, registrationEnabled, registrationApprovalRequired, userLimit]);
  useEffect(() => {
    let active = true;
    const revision = registeredUserCountRevisionRef.current;
    const controller = new AbortController();
    setRegisteredUserCountError('');
    registeredUserCountControllerRef.current = controller;
    api.get<{ registeredUserCount: number }>('/api/admin/settings', { signal: controller.signal })
      .then((result) => { if (active && revision === registeredUserCountRevisionRef.current) setRegisteredUserCount(result.registeredUserCount); })
      .catch((cause) => { if (active && revision === registeredUserCountRevisionRef.current) setRegisteredUserCountError(cause instanceof ApiError ? cause.message : 'Registered account count could not be loaded.'); })
      .finally(() => { if (registeredUserCountControllerRef.current === controller) registeredUserCountControllerRef.current = null; });
    return () => {
      active = false;
      controller.abort();
      if (registeredUserCountControllerRef.current === controller) registeredUserCountControllerRef.current = null;
    };
  }, [registeredUserCountRetryVersion]);
  useEffect(() => {
    let active = true;
    api.get<PlatformResetStatus>('/api/admin/platform-reset')
      .then((result) => { if (active) setResetState(result); })
      .catch((cause) => { if (active) setResetError(cause instanceof ApiError ? cause.message : 'Reset status could not be loaded.'); })
      .finally(() => { if (active) setResetStatusLoaded(true); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.palette = palette;
    return () => { document.documentElement.dataset.palette = themePalette; };
  }, [palette, themePalette]);
  function choosePalette(nextPalette: BrandingPalette) {
    setPalette(nextPalette);
    document.documentElement.dataset.palette = nextPalette;
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const normalizedName = name.trim();
    if (normalizedName.length < 2 || normalizedName.length > 80) {
      setError('Platform name must be between 2 and 80 characters.'); setSuccess('');
      return;
    }
    setError(''); setSuccess(''); setSaving(true);
    try {
      const result = await api.put<{ platformName: string; platformIcon: string | null; themePalette: BrandingPalette; connectionProtocol: ConnectionProtocol; registrationEnabled: boolean; registrationApprovalRequired: boolean; registrationAvailable: boolean; userLimit: number; registeredUserCount: number }>('/api/admin/settings', {
        platformName: normalizedName,
        themePalette: palette,
        connectionProtocol: protocol,
        registrationEnabled: allowRegistration,
        registrationApprovalRequired: requireRegistrationApproval,
        userLimit: Number(userLimitValue),
        ...(iconEdited ? { platformIcon: icon } : {}),
      });
      registeredUserCountRevisionRef.current += 1;
      registeredUserCountControllerRef.current?.abort();
      registeredUserCountControllerRef.current = null;
      setError(''); setRegisteredUserCountError(''); setName(result.platformName); setBranding(result.platformName, result.themePalette, result.platformIcon); setPlatformAccessSettings(result.connectionProtocol, result.registrationEnabled, result.registrationApprovalRequired, result.registrationAvailable, result.userLimit); setIconEdited(false); setRegisteredUserCount(result.registeredUserCount); setSuccess('Platform settings saved.');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Settings could not be saved.'); }
    finally { setSaving(false); }
  }
  async function prepareReset() {
    setResetError(''); setResetSuccess(''); setResetBusy(true);
    try {
      const result = await api.post<typeof resetState>('/api/admin/platform-reset/prepare');
      setResetState(result); setResetPhrase('');
    } catch (cause) {
      const status = await readResetStatusAfterConflict(cause, () => api.get<PlatformResetStatus>('/api/admin/platform-reset'));
      if (status) {
        setResetState(status); setResetPhrase(''); setResetError('');
      } else {
        setResetError(cause instanceof ApiError ? cause.message : 'A backup could not be created, so nothing was reset.');
      }
    }
    finally { setResetBusy(false); }
  }
  async function cancelReset() {
    if (!resetState.confirmationId) return;
    setResetError(''); setResetBusy(true);
    try {
      await api.post('/api/admin/platform-reset/cancel', { confirmationId: resetState.confirmationId });
      setResetState({ pending: false }); setResetPhrase('');
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'platform_reset_confirmation_invalid') { setResetState({ pending: false }); setResetPhrase(''); }
      setResetError(cause instanceof ApiError ? cause.message : 'The pending reset could not be canceled.');
    }
    finally { setResetBusy(false); }
  }
  async function confirmReset() {
    if (!resetState.confirmationId || resetPhrase !== 'RESET') return;
    setResetError(''); setResetBusy(true);
    try {
      await api.post('/api/admin/platform-reset/confirm', { confirmationId: resetState.confirmationId, confirmationPhrase: resetPhrase });
      setResetSuccess('The platform has been reset. Redirecting you to sign in…');
      window.setTimeout(() => window.location.assign('/login'), 900);
    } catch (cause) {
      if (shouldClearResetConfirmationAfterFailure(cause)) { setResetState({ pending: false }); setResetPhrase(''); }
      setResetError(cause instanceof ApiError ? cause.message : 'The platform could not be reset. Your backup remains available.'); setResetBusy(false);
    }
  }
  const parsedAccountLimit = Number(userLimitValue);
  const accountLimit = Number.isFinite(parsedAccountLimit) && parsedAccountLimit > 0 ? Math.floor(parsedAccountLimit) : 0;
  const accountUsagePercent = accountLimit > 0 && registeredUserCount !== null
    ? Math.min(100, Math.round((registeredUserCount / accountLimit) * 100))
    : 0;
  return <div className="management-page settings-page"><PageHeading title="Settings" subtitle="Customize platform branding, connection security, and learner registration." /><AdminSettingsTabs />{error && <Notice>{error}</Notice>}{success && <Notice kind="success">{success}</Notice>}
    <form className="settings-card form-stack" onSubmit={submit} aria-busy={saving}>
      <fieldset className="settings-fields" aria-label="Platform settings" disabled={saving}>
      <div className="settings-card-heading"><span className="settings-icon"><Settings2 size={19} /></span><div><h2>Platform identity</h2><p>Choose the brand learners see throughout the platform.</p></div></div>
      <label>Platform name<input required minLength={2} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <PlatformIconPicker value={icon} onChange={(nextIcon) => { setIcon(nextIcon); setIconEdited(true); }} />
      <div className="branding-choice-field"><span className="branding-choice-label">Color palette</span><small>Preview a palette and save to apply it for everyone.</small><PalettePicker value={palette} onChange={choosePalette} /></div>
      <div className="settings-section-divider"><span>Connection and accounts</span></div>
      <div className="app-select-field"><span>Public connection protocol</span><AppSelect<ConnectionProtocol> ariaLabel="Public connection protocol" describedBy="protocol-help" value={protocol} onChange={setProtocol} options={[{ value: 'http', label: 'HTTP' }, { value: 'https', label: 'HTTPS' }]} /></div>
      <p id="protocol-help" className="protocol-help">This controls secure session cookies. HTTPS requires a TLS certificate on this server or a reverse proxy. For TLS behind a proxy, set <code>TRUST_PROXY=true</code>.{connectionProtocol === 'https' && protocol === 'http' && <span className="protocol-session-warning">If you then open the site over HTTP, browsers will not send the existing secure session cookie, so you will need to sign in again.</span>}</p>
      <label className="setup-toggle"><span><strong>Allow new registrations</strong><small>Let people create learner accounts from the sign-in page.</small></span><input type="checkbox" checked={allowRegistration} onChange={(event) => setAllowRegistration(event.target.checked)} /></label>
      <label className="setup-toggle"><span><strong>Require admin approval for new registrations</strong><small>New learners must be approved by an administrator before they can sign in or use the platform.</small></span><input type="checkbox" checked={requireRegistrationApproval} onChange={(event) => setRequireRegistrationApproval(event.target.checked)} /></label>
      <label>Maximum registered accounts<input className="user-limit-input" type="number" min={0} max={1000000} step={1} required value={userLimitValue} onChange={(event) => setUserLimitValue(event.target.value)} /><small>0 means no limit. The cap includes administrators, moderators, and learners.</small></label>
      {registeredUserCountError
        ? <div className="registered-count-recovery"><Notice>{registeredUserCountError}</Notice><Button type="button" variant="secondary" onClick={() => setRegisteredUserCountRetryVersion((version) => version + 1)}>Retry account count</Button></div>
        : <div className="registered-account-usage" role="status" aria-live="polite" aria-atomic="true">
          <div className="registered-count-status">
            <span>{registeredUserCount === null ? 'Loading registered accounts…' : accountLimit > 0 ? `${registeredUserCount} of ${accountLimit} accounts registered` : `${registeredUserCount} registered accounts · no account cap`}</span>
            {accountLimit > 0 && registeredUserCount !== null && <strong>{accountUsagePercent}%</strong>}
          </div>
          {accountLimit > 0 && registeredUserCount !== null && <div className="account-usage-track" role="progressbar" aria-label="Registered account limit usage" aria-valuemin={0} aria-valuemax={accountLimit} aria-valuenow={Math.min(registeredUserCount, accountLimit)} aria-valuetext={`${registeredUserCount} of ${accountLimit} accounts registered`}>
            <span style={{ width: `${accountUsagePercent}%` }} />
          </div>}
        </div>}
      <div className="settings-card-footer"><span>Database and media paths remain managed through the server environment.</span><Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</Button></div>
      </fieldset>
    </form>
    <section className="platform-reset-card" aria-labelledby="platform-reset-heading">
      <div className="platform-reset-heading"><span className="platform-reset-icon"><AlertTriangle size={19} aria-hidden="true" /></span><div><h2 id="platform-reset-heading">Reset platform</h2><p>Remove learning content and account data, then restore platform settings to their defaults.</p></div></div>
      <div className="platform-reset-content">
        {resetError && <Notice>{resetError}</Notice>}
        {resetSuccess && <Notice kind="success">{resetSuccess}</Notice>}
        {!resetState.pending && <>
          <p>This keeps your administrator account and the audit and system logs. Courses, course media, learner accounts, progress, certificates, paths, competencies, and custom registration fields will be removed.</p>
          <p>A full database and course-media backup will be created and verified before the final confirmation appears. The backup is retained under the server data directory.</p>
          <Button type="button" variant="danger" onClick={prepareReset} disabled={resetBusy || !resetStatusLoaded}>{resetBusy ? 'Preparing backup…' : 'Create backup and begin reset'}</Button>
        </>}
        {resetState.pending && resetState.phase === 'preparing' && <div className="platform-reset-pending" role="status" aria-live="polite"><strong>{resetState.confirmationId ? 'Creating and verifying your backup…' : 'Another administrator is creating and verifying a backup…'}</strong><span>Platform requests are paused until the administrator confirms or preparation ends.</span></div>}
        {resetState.pending && resetState.phase === 'ready' && resetState.confirmationId && <div className="platform-reset-confirmation">
          <div className="platform-reset-backup"><strong>Verified backup</strong><code>{resetState.backupLocation}</code><span>This backup will remain available even if you cancel the reset.</span></div>
          <label htmlFor="platform-reset-phrase">Type RESET to confirm<input id="platform-reset-phrase" autoComplete="off" value={resetPhrase} onChange={(event) => setResetPhrase(event.target.value)} disabled={resetBusy} /></label>
          {resetState.expiresAt && <small>This confirmation expires at {new Date(resetState.expiresAt).toLocaleTimeString()}.</small>}
          <div className="platform-reset-actions"><Button type="button" variant="secondary" onClick={cancelReset} disabled={resetBusy}>{resetBusy ? 'Please wait…' : 'Cancel reset'}</Button><Button type="button" variant="danger" onClick={confirmReset} disabled={resetBusy || resetPhrase !== 'RESET'}>{resetBusy ? 'Resetting…' : 'Reset platform'}</Button></div>
        </div>}
        {resetState.pending && resetState.phase === 'resetting' && <div className="platform-reset-pending" role="status" aria-live="polite"><strong>Platform reset in progress…</strong><span>Platform requests remain paused until the reset completes.</span></div>}
        {resetState.pending && resetState.phase === 'ready' && !resetState.confirmationId && <div className="platform-reset-pending" role="status"><strong>Another administrator has prepared a verified backup and can now confirm or cancel the reset.</strong><span>Platform requests remain paused until they confirm or cancel the reset.</span></div>}
      </div>
    </section>
  </div>;
}

function AdminSettingsTabs() {
  return <nav className="settings-tabs" aria-label="Settings sections">
    <NavLink to="/admin/settings" end className={({ isActive }) => isActive ? 'settings-tab active' : 'settings-tab'}>Platform</NavLink>
    <NavLink to="/admin/settings/registration-fields" className={({ isActive }) => isActive ? 'settings-tab active' : 'settings-tab'}>Registration fields</NavLink>
  </nav>;
}

const registrationFieldTypeOptions: Array<{ value: RegistrationFieldType; label: string }> = [
  { value: 'text', label: 'Free text' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'Select list' },
  { value: 'checkbox', label: 'Checkbox' },
];

export function AdminRegistrationFieldsPage() {
  const [fields, setFields] = useState<RegistrationField[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [configurationWarning, setConfigurationWarning] = useState('');
  const [success, setSuccess] = useState('');
  const [retryVersion, setRetryVersion] = useState(0);
  const [invalidField, setInvalidField] = useState<ReturnType<typeof validateRegistrationFieldEditor>>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');
    api.get<{ fields: RegistrationField[]; configurationValid: boolean }>('/api/admin/registration-fields', { signal: controller.signal })
      .then((result) => { if (active) { setFields(result.fields); setConfigurationWarning(result.configurationValid ? '' : 'The saved registration form is invalid. Public signup is paused. Add replacement fields and save, or save with no fields to clear the custom questions.'); } })
      .catch((cause) => { if (active) setLoadError(cause instanceof ApiError ? cause.message : 'Registration fields could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [retryVersion]);

  function updateField(id: string, changes: Partial<RegistrationField>) {
    setFields((current) => current.map((field) => field.id === id ? { ...field, ...changes } : field));
    setError(''); setSuccess(''); setInvalidField(null);
  }

  function addField() {
    setFields((current) => [...current, { id: crypto.randomUUID(), label: '', type: 'text', required: false, options: [] }]);
    setError(''); setSuccess(''); setInvalidField(null);
  }

  async function saveFields(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setError(''); setSuccess('');
    const issue = validateRegistrationFieldEditor(fields);
    if (issue) {
      setInvalidField(issue);
      setError(issue.message);
      window.requestAnimationFrame(() => document.getElementById(`registration-field-editor-${issue.fieldId}-${issue.target}`)?.focus());
      return;
    }
    setInvalidField(null);
    setSaving(true);
    try {
      const result = await api.put<{ fields: RegistrationField[] }>('/api/admin/registration-fields', { fields });
      setFields(result.fields);
      setConfigurationWarning('');
      setSuccess('Registration fields saved. New and future signups will use this form.');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Registration fields could not be saved.'); }
    finally { setSaving(false); }
  }

  return <div className="management-page settings-page"><PageHeading title="Settings" subtitle="Customize platform branding, connection security, and learner registration." /><AdminSettingsTabs />
    {loadError && !loading && <div className="registration-fields-page-notice"><Notice>{loadError}</Notice><Button type="button" variant="secondary" onClick={() => setRetryVersion((version) => version + 1)}>Try again</Button></div>}
    {success && <Notice kind="success">{success}</Notice>}
    {loading ? <div className="page-loading" role="status" aria-live="polite">Loading registration fields…</div> : !loadError && <form className="settings-card form-stack registration-fields-card" onSubmit={saveFields} aria-busy={saving}>
      <fieldset className="settings-fields" aria-label="Registration fields" disabled={saving}>
        <div className="settings-card-heading"><span className="settings-icon"><UsersRound size={19} /></span><div><h2>Registration form</h2><p>Collect the information your organization needs when learners create an account.</p></div></div>
        {configurationWarning && <Notice>{configurationWarning}</Notice>}
        <p className="registration-fields-intro">These fields appear after email and username during public registration. Existing learner answers are kept if a field is changed or removed.</p>
        {fields.length ? <div className="registration-field-editor-list">{fields.map((field, index) => <section className="registration-field-editor" key={field.id} aria-labelledby={`registration-field-title-${field.id}`}>
          <div className="registration-field-editor-heading"><h3 id={`registration-field-title-${field.id}`}>Field {index + 1}</h3><Button type="button" variant="quiet" className="registration-field-remove" aria-label={`Remove ${field.label || `field ${index + 1}`}`} onClick={() => { setFields((current) => current.filter((item) => item.id !== field.id)); setError(''); setSuccess(''); setInvalidField(null); }}><Trash2 size={15} />Remove</Button></div>
          <div className="registration-field-editor-grid">
            <label>Field label<input id={`registration-field-editor-${field.id}-label`} required minLength={1} maxLength={80} value={field.label} aria-invalid={invalidField?.fieldId === field.id && invalidField.target === 'label' || undefined} aria-describedby={invalidField?.fieldId === field.id && invalidField.target === 'label' ? 'registration-fields-error' : undefined} onChange={(event) => updateField(field.id, { label: event.target.value })} placeholder="e.g. Department" /></label>
            <div className="app-select-field"><span>Field type</span><AppSelect<RegistrationFieldType> ariaLabel={`Field type for field ${index + 1}`} value={field.type} onChange={(type) => updateField(field.id, { type, options: type === 'select' ? (field.options.length >= 2 ? field.options : ['Option 1', 'Option 2']) : [] })} options={registrationFieldTypeOptions} /></div>
            <label className="registration-required-toggle"><input type="checkbox" checked={field.required} onChange={(event) => updateField(field.id, { required: event.target.checked })} /><span>Required for signup</span></label>
          </div>
          {field.type === 'select' && <label className="registration-options-field">Options<textarea id={`registration-field-editor-${field.id}-options`} required rows={4} value={field.options.join('\n')} aria-invalid={invalidField?.fieldId === field.id && invalidField.target === 'options' || undefined} aria-describedby={invalidField?.fieldId === field.id && invalidField.target === 'options' ? 'registration-fields-error' : undefined} onChange={(event) => updateField(field.id, { options: event.target.value.split('\n') })} placeholder={'One option per line\nDepartment A\nDepartment B'} /><small>Enter one choice per line, with 2–30 unique choices.</small></label>}
        </section>)}</div> : <EmptyState headingLevel={3} title="No custom fields yet" detail="Add fields such as department, date of birth, or an acknowledgement checkbox to the signup form." />}
        <div className="registration-fields-actions"><Button type="button" variant="secondary" onClick={addField} disabled={fields.length >= 30}><Plus size={16} />Add field</Button><span>Choose from free text, date, select list, or checkbox. Up to 30 fields.</span></div>
        {error && <Notice id="registration-fields-error">{error}</Notice>}
        <div className="settings-card-footer"><span>Changes apply to new registrations. Saved learner responses stay on their account.</span><Button type="submit" disabled={saving}>{saving ? 'Saving fields…' : 'Save fields'}</Button></div>
      </fieldset>
    </form>}
  </div>;
}

type AuditLogEntry = {
  id: number;
  occurredAt: string;
  actorUsername: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  details: Record<string, unknown>;
};

type SystemLogEntry = {
  id: number;
  occurredAt: string;
  level: 'info' | 'warn' | 'error';
  source: string;
  message: string;
  details: Record<string, unknown>;
};

function LogTimestamp({ value }: { value: string }) {
  const date = new Date(value.includes('Z') ? value : `${value.replace(' ', 'T')}Z`);
  const valid = !Number.isNaN(date.getTime());
  return <time dateTime={valid ? date.toISOString() : undefined}>{valid ? logTimestampFormatter.format(date) : value}</time>;
}

function LogDetailsDisclosure({ details, label, columnCount, children }: { details: Record<string, unknown>; label: string; columnCount: number; children: (toggle: ReactNode) => ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const rows = Object.entries(details || {});
  const toggle = rows.length ? <button type="button" className="log-details-toggle" aria-expanded={expanded} aria-controls={contentId} aria-label={`${expanded ? 'Hide' : 'View'} details for ${(label.trim() || 'log entry').slice(0, 120)}`} onClick={() => setExpanded((current) => !current)}><ChevronDown size={14} aria-hidden="true" /><span>{expanded ? 'Hide details' : 'View details'}</span></button> : <span className="log-no-details">—</span>;
  return <>
    {children(toggle)}
    {rows.length > 0 && <tr className="log-details-row" hidden={!expanded}><td colSpan={columnCount}><dl id={contentId} className="log-details-content">{rows.map(([key, value]) => <div key={key}><dt>{key}</dt><dd><code>{typeof value === 'string' ? value : JSON.stringify(value)}</code></dd></div>)}</dl></td></tr>}
  </>;
}

function LogPagination({ page, pageSize, total, loading, onChange }: { page: number; pageSize: number; total: number; loading: boolean; onChange: (page: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const first = total ? (page - 1) * pageSize + 1 : 0;
  const last = Math.min(page * pageSize, total);
  return <div className="log-pagination"><span role="status" aria-live="polite" aria-atomic="true">Showing {first}–{last} of {total}</span><div><Button variant="secondary" disabled={loading || page <= 1} onClick={() => onChange(page - 1)}>Previous</Button><span>Page {page} of {totalPages}</span><Button variant="secondary" disabled={loading || page >= totalPages} onClick={() => onChange(page + 1)}>Next</Button></div></div>;
}

export function AdminAuditLogPage() {
  const requestSequenceRef = useRef(0);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [actions, setActions] = useState<{ action: string; count: number }[]>([]);
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [failedRequest, setFailedRequest] = useState<{ page: number; query: string; action: string } | null>(null);

  useEffect(() => {
    const requestSequence = ++requestSequenceRef.current;
    const controller = new AbortController();
    let active = true;
    setLoading(true); setError(''); setFailedRequest(null);
    const params = new URLSearchParams({ page: String(page) });
    if (appliedQuery) params.set('q', appliedQuery);
    if (action) params.set('action', action);
    api.get<{ entries: AuditLogEntry[]; actions: { action: string; count: number }[]; total: number; page: number; pageSize: number }>(`/api/admin/audit-logs?${params}`, { signal: controller.signal })
      .then((result) => {
        if (!active || requestSequence !== requestSequenceRef.current) return;
        setEntries(result.entries); setActions(result.actions); setTotal(result.total); setPageSize(result.pageSize); setPage(result.page);
      })
      .catch((cause) => { if (active && requestSequence === requestSequenceRef.current) { setError(cause instanceof ApiError ? cause.message : 'The audit log could not be loaded.'); setFailedRequest({ page, query: appliedQuery, action }); } })
      .finally(() => { if (active && requestSequence === requestSequenceRef.current) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [appliedQuery, action, page, refreshVersion]);
  const emptyMessage = appliedQuery || action ? 'No audit entries match these filters.' : 'No audit entries have been recorded yet.';
  const hasEmptyResult = !loading && !failedRequest && entries.length === 0;

  return <div className="management-page logs-page"><PageHeading title="Audit log" subtitle="Review account, course, and platform changes, including access and comment removals." action={<Button variant="secondary" onClick={() => setRefreshVersion((current) => current + 1)}>Refresh</Button>} />
    <div className="log-filters"><form className="management-search" onSubmit={(event) => { event.preventDefault(); setPage(1); setAppliedQuery(query.trim()); }}><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search changes" aria-label="Search audit log" maxLength={100} /><button type="submit">Search</button></form><div className="select-wrap role-filter log-role-filter"><span className="catalog-filter-label">Action</span><AppSelect className="app-select--filter" ariaLabel="Filter by action" leadingIcon={<Filter size={16} />} value={action} onChange={(value) => { setAction(value); setPage(1); }} options={[{ value: '', label: 'All actions' }, ...actions.map((item) => ({ value: item.action, label: `${item.action.replaceAll('_', ' ')} (${item.count})` }))]} /></div></div>
    {error && <div className="log-list-error"><Notice>{error}</Notice><Button type="button" variant="secondary" onClick={() => setRefreshVersion((current) => current + 1)}>Try again</Button></div>}
    {hasEmptyResult && <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{emptyMessage}</p>}
    <div className="log-table-wrap" role="region" aria-label="Scrollable audit log" tabIndex={0}><table className="log-table" aria-busy={loading}><caption className="sr-only">Audit log entries</caption><thead><tr><th scope="col">When</th><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Change</th><th scope="col">Details</th></tr></thead><tbody>
      {failedRequest ? <tr><td colSpan={5} className="log-empty">Audit entries are unavailable until the request succeeds.</td></tr> : entries.map((entry) => <LogDetailsDisclosure key={entry.id} details={entry.details} label={entry.summary} columnCount={5}>{(toggle) => <tr><td><LogTimestamp value={entry.occurredAt} /></td><td>{entry.actorUsername}</td><td><span className="log-action">{entry.action.replaceAll('_', ' ')}</span></td><td><strong>{entry.summary}</strong><small>{entry.entityType}{entry.entityId ? ` · ${entry.entityId}` : ''}</small></td><td>{toggle}</td></tr>}</LogDetailsDisclosure>)}
      {!loading && !failedRequest && !entries.length && <tr><td colSpan={5} className="log-empty">{emptyMessage}</td></tr>}
    </tbody></table>{loading && <div className="log-loading" role="status" aria-live="polite">Loading audit entries…</div>}</div>
    {!failedRequest && total > 0 && <LogPagination page={page} pageSize={pageSize} total={total} loading={loading} onChange={setPage} />}
  </div>;
}

export function AdminSystemLogPage() {
  const requestSequenceRef = useRef(0);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [entries, setEntries] = useState<SystemLogEntry[]>([]);
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [level, setLevel] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [failedRequest, setFailedRequest] = useState<{ page: number; query: string; level: string } | null>(null);

  useEffect(() => {
    const requestSequence = ++requestSequenceRef.current;
    const controller = new AbortController();
    let active = true;
    setLoading(true); setError(''); setFailedRequest(null);
    const params = new URLSearchParams({ page: String(page) });
    if (appliedQuery) params.set('q', appliedQuery);
    if (level !== 'all') params.set('level', level);
    api.get<{ entries: SystemLogEntry[]; total: number; page: number; pageSize: number }>(`/api/admin/system-logs?${params}`, { signal: controller.signal })
      .then((result) => {
        if (!active || requestSequence !== requestSequenceRef.current) return;
        setEntries(result.entries); setTotal(result.total); setPageSize(result.pageSize); setPage(result.page);
      })
      .catch((cause) => { if (active && requestSequence === requestSequenceRef.current) { setError(cause instanceof ApiError ? cause.message : 'The system log could not be loaded.'); setFailedRequest({ page, query: appliedQuery, level }); } })
      .finally(() => { if (active && requestSequence === requestSequenceRef.current) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [appliedQuery, level, page, refreshVersion]);
  const emptyMessage = appliedQuery || level !== 'all' ? 'No system events match these filters.' : 'No system events have been recorded yet.';
  const hasEmptyResult = !loading && !failedRequest && entries.length === 0;

  return <div className="management-page logs-page"><PageHeading title="System log" subtitle="Inspect server startup, runtime errors, and operational events." action={<Button variant="secondary" onClick={() => setRefreshVersion((current) => current + 1)}>Refresh</Button>} />
    <div className="log-filters"><form className="management-search" onSubmit={(event) => { event.preventDefault(); setPage(1); setAppliedQuery(query.trim()); }}><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search system events" aria-label="Search system log" maxLength={100} /><button type="submit">Search</button></form><div className="select-wrap role-filter log-role-filter"><span className="catalog-filter-label">Severity</span><AppSelect className="app-select--filter" ariaLabel="Filter by severity" leadingIcon={<Activity size={16} />} value={level} onChange={(value) => { setLevel(value); setPage(1); }} options={[{ value: 'all', label: 'All levels' }, { value: 'error', label: 'Errors' }, { value: 'warn', label: 'Warnings' }, { value: 'info', label: 'Info' }]} /></div></div>
    {error && <div className="log-list-error"><Notice>{error}</Notice><Button type="button" variant="secondary" onClick={() => setRefreshVersion((current) => current + 1)}>Try again</Button></div>}
    {hasEmptyResult && <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{emptyMessage}</p>}
    <div className="log-table-wrap" role="region" aria-label="Scrollable system log" tabIndex={0}><table className="log-table" aria-busy={loading}><caption className="sr-only">System log entries</caption><thead><tr><th scope="col">When</th><th scope="col">Level</th><th scope="col">Source</th><th scope="col">Event</th><th scope="col">Details</th></tr></thead><tbody>
      {failedRequest ? <tr><td colSpan={5} className="log-empty">System events are unavailable until the request succeeds.</td></tr> : entries.map((entry) => <LogDetailsDisclosure key={entry.id} details={entry.details} label={entry.message} columnCount={5}>{(toggle) => <tr><td><LogTimestamp value={entry.occurredAt} /></td><td><span className={`log-level log-level-${entry.level}`}>{entry.level}</span></td><td>{entry.source}</td><td><strong>{entry.message}</strong></td><td>{toggle}</td></tr>}</LogDetailsDisclosure>)}
      {!loading && !failedRequest && !entries.length && <tr><td colSpan={5} className="log-empty">{emptyMessage}</td></tr>}
    </tbody></table>{loading && <div className="log-loading" role="status" aria-live="polite">Loading system events…</div>}</div>
    {!failedRequest && total > 0 && <LogPagination page={page} pageSize={pageSize} total={total} loading={loading} onChange={setPage} />}
  </div>;
}
