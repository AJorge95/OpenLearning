import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Activity, AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, BookOpen, Check, ChevronDown, CircleHelp, Download, FileText, Filter, Link2, LockKeyhole, MoreVertical, Pencil, Plus, Search, Settings2, Trash2, Upload, UsersRound } from 'lucide-react';
import { createPortal } from 'react-dom';
import { Link, NavLink, useBeforeUnload, useBlocker, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { BlockerFunction } from 'react-router-dom';
import { api, ApiError, assignCourseToGroup, createCourseGroup, fetchAccess, fetchAppVersion, fetchCourse, fetchCourseGroups, removeCourseFromGroup } from './api';
import { requestPendingRegistrationCountRefresh } from './admin-navigation-events';
import { AppSelect, Button, ConfirmationDialog, CourseStatus, EmptyState, ImageWithFallback, PageHeading, PalettePicker, PasswordField, PlatformIconPicker, ProgressBar, UserInitial, VisibilityLabel } from './components';
import type { AppSelectOption } from './components';
import type { CourseGroup } from './types';
import { formatCountLabel } from './count-label';
import { parseApiTimestamp } from './api-timestamp';
import { formatApiTimestamp } from './format-api-timestamp';
import { accountCourseAssignmentLabel } from './account-course-activity';
import { accountDisableConfirmation } from './account-disable-confirmation';
import { courseAccessAction, courseAccessActionLabel, courseAccessStatusLabel } from './course-access-action';
import { courseDeletionConfirmation } from './course-deletion-confirmation';
import { courseRowActionStatus } from './course-row-action-status';
import { isCourseCreationEditorState } from './course-editor-state';
import { getAppSelectVerticalPosition } from './app-select-position';
import { filterCourseCompetencies, updateCourseCompetencySelection } from './course-competency-selection';
import type { CourseRowAction } from './course-row-action-status';
import { hasUnsavedRegistrationFieldChanges, validateRegistrationFieldEditor } from './registration-fields';
import { CONNECTION_PROTOCOL_OPTIONS } from './branding';
import type { BrandingPalette, ConnectionProtocol } from './branding';
import { useAuth } from './auth-context';
import { canonicalCaptionLanguageTag, captionFileSizeError, captionLanguageErrorMessage } from './caption-validation';
import { uploadSizeError } from './upload-size-validation';
import { accountNameError, MAX_ACCOUNT_NAME_LENGTH, normalizeAccountName } from './account-name-validation';
import { MAX_PLATFORM_NAME_LENGTH, MIN_PLATFORM_NAME_LENGTH, normalizePlatformName, platformNameValidationError } from './platform-name-validation';
import { courseEditingNote } from './course-editing-note';
import { coursePublishedNotice } from './course-published-notice';
import { COMPLETION_WINDOW_ERROR, COURSE_CATEGORY_REQUIRED_ERROR, COURSE_CATEGORY_TOO_LONG_ERROR, COURSE_TITLE_REQUIRED_ERROR, COURSE_TITLE_TOO_LONG_ERROR, MAX_COURSE_CATEGORY_LENGTH, MAX_COURSE_TITLE_LENGTH, validateCompletionWindowDays, validateCourseCategory, validateCourseTitle } from './course-editor-validation';
import { isCourseCoverDimensionAllowed, MAX_COURSE_COVER_DIMENSION } from './course-cover-validation';
import { readImageDimensions } from './image-dimensions';
import { firstQuizTextIssue, MAX_QUIZ_TITLE_LENGTH, QUIZ_TITLE_REQUIRED_ERROR, QUIZ_TITLE_TOO_LONG_ERROR, validateQuizTitle } from './quiz-validation';
import { downloadFinalExamImportTemplate, parseDelimitedFinalExamFile, parseFinalExamImportRows } from './final-exam-import';
import type { FinalExamImportPreview } from './final-exam-import';
import { lessonResourceUrlError } from './resource-validation';
import { clearPasswordConfirmationError, getPasswordConfirmationError, passwordConfirmationFieldProps } from './password-confirmation';
import { validateEmail } from './email-validation';
import { userListEmptyMessage } from './user-list-empty-state';
import { formatPercentage } from './percentage';
import { buildAuditActionOptions } from './audit-log-filter';
import { readResetStatusAfterConflict, shouldClearResetConfirmationAfterFailure } from './platform-reset-status';
import type { PlatformResetStatus } from './platform-reset-status';
import type { UserApprovalFilter, UserRoleFilter } from './user-list-empty-state';
import type { Competency, Course, CourseAccessUser, CourseAnalytics, CourseAnalyticsLearner, CourseAnalyticsLearnerDetails, CourseAnalyticsLearnerPage, CourseModule, CourseVersion, Lesson, LessonCaption, LessonResource, QuizQuestion, RegistrationField, RegistrationFieldType, Role, SavedRegistrationFieldValue, User } from './types';

type CourseListResponse = { courses: Course[]; total: number; page: number; pageSize: number };
type FailedCourseListRequest = { page: number; query: string; status: string };
type CourseVersionHistoryPage = { currentVersion: CourseVersion | null; versions: CourseVersion[]; total: number; page: number; pageSize: number; hasMore: boolean };

const courseDateFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const logTimestampFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const quizTitleLimit = MAX_QUIZ_TITLE_LENGTH;
const defaultQuizTitleSuffix = ' quiz';
// Keep this shared across the 50-row account table so each update does not revalidate every select's options.
const ADMIN_USER_ROLE_OPTIONS: AppSelectOption<Role>[] = [
  { value: 'admin', label: 'Administrator' },
  { value: 'moderator', label: 'Moderator' },
  { value: 'learner', label: 'Learner' },
];
const ACCOUNT_ROLE_OPTIONS: AppSelectOption<Role>[] = [
  { value: 'learner', label: 'Learner' },
  { value: 'moderator', label: 'Moderator' },
  { value: 'admin', label: 'Administrator' },
];
// QuizEditor rerenders while authors type; keep its fixed selector choices stable.
const QUIZ_PASS_MARK_OPTIONS: AppSelectOption<number>[] = [50, 60, 70, 80, 90, 100]
  .map((value) => ({ value, label: `${value}%` }));
const USER_ROLE_FILTER_OPTIONS: AppSelectOption<UserRoleFilter>[] = [
  { value: 'all', label: 'All roles' },
  { value: 'admin', label: 'Administrators' },
  { value: 'moderator', label: 'Moderators' },
  { value: 'learner', label: 'Learners' },
];
const USER_APPROVAL_FILTER_OPTIONS: AppSelectOption<UserApprovalFilter>[] = [
  { value: 'all', label: 'All accounts' },
  { value: 'pending', label: 'Pending approval' },
  { value: 'approved', label: 'Approved' },
];
const SYSTEM_LOG_LEVEL_OPTIONS: AppSelectOption<string>[] = [
  { value: 'all', label: 'All levels' },
  { value: 'error', label: 'Errors' },
  { value: 'warn', label: 'Warnings' },
  { value: 'info', label: 'Info' },
];

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
  const itemCount = course.status === 'archived' ? 3 : 4;
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
    <button ref={triggerRef} type="button" className="row-menu-trigger" aria-label={`More actions for ${course.title}`} aria-haspopup="menu" aria-expanded={open} aria-controls={`${id}-menu`} onClick={(event) => open ? closeMenu() : openMenu(event.detail === 0)} onKeyDown={(event) => { if (event.key === 'ArrowDown' && !open) { event.preventDefault(); openMenu(true); } }}><MoreVertical size={18} aria-hidden="true" /></button>
    {open && createPortal(<div ref={menuRef} id={`${id}-menu`} className="row-menu-popover" role="menu" aria-label={`Actions for ${course.title}`} style={position} onKeyDown={handleMenuKeyDown}>
      <Link to={`/manage/courses/${course.id}/access`} role="menuitem" onClick={() => closeMenu()}>Assign learners</Link>
      <Link to="/manage/course-groups" role="menuitem" onClick={() => closeMenu()}>Manage course groups</Link>
      {course.status === 'draft' && <button type="button" role="menuitem" onClick={() => { closeMenu(true); onStatusChange(course, 'published'); }} disabled={isBusy} aria-busy={busyAction === 'publish'}>{busyAction === 'publish' ? 'Publishing…' : 'Publish'}</button>}
      {course.status === 'published' && <button type="button" role="menuitem" onClick={() => { closeMenu(true); onStatusChange(course, 'draft'); }} disabled={isBusy} aria-busy={busyAction === 'unpublish'}>{busyAction === 'unpublish' ? 'Unpublishing…' : 'Unpublish'}</button>}
      {course.status !== 'archived' && <button type="button" role="menuitem" onClick={() => { closeMenu(true); onStatusChange(course, 'archived'); }} disabled={isBusy} aria-busy={busyAction === 'archive'}>{busyAction === 'archive' ? 'Archiving…' : 'Archive'}</button>}
      {course.status === 'archived' && <button type="button" role="menuitem" className="danger-menu-item" onClick={() => { closeMenu(true); onDelete(course); }} disabled={isBusy} aria-busy={busyAction === 'delete'}>{busyAction === 'delete' ? 'Deleting…' : 'Delete permanently'}</button>}
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
  return <span>{formatApiTimestamp(value, courseDateFormatter)}</span>;
}

function DateTimeText({ value }: { value: string }) {
  return <span>{formatApiTimestamp(value, logTimestampFormatter)}</span>;
}

function CourseRevisionBadge({ status }: { status: Course['reviewStatus'] }) {
  const label = status === 'in_review' ? 'In review'
    : status === 'changes_requested' ? 'Changes requested'
      : 'Draft changes';
  return <span className={status === 'in_review' ? 'program-status' : 'program-status draft'} aria-hidden="true">{label}</span>;
}

// Keep the compact badge visual while giving assistive technology the pending-publication meaning.
function courseRevisionAnnouncement(status: Course['reviewStatus']) {
  return status === 'in_review'
    ? 'A revision is awaiting review.'
    : status === 'changes_requested'
      ? 'A revision has changes requested.'
      : 'There are unpublished draft changes.';
}

export function CourseManagementPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const courseSearchInputRef = useRef<HTMLInputElement>(null);
  const loadSequenceRef = useRef(0);
  const loadControllerRef = useRef<AbortController | null>(null);
  const filtersRef = useRef({ query: appliedQuery, status });
  filtersRef.current = { query: appliedQuery, status };
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [failedRequest, setFailedRequest] = useState<FailedCourseListRequest | null>(null);
  const [busyActions, setBusyActions] = useState<Record<string, CourseRowAction>>({});
  const busyActionsRef = useRef(busyActions);
  const [pendingDeleteCourse, setPendingDeleteCourse] = useState<Course | null>(null);

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
  function changeCourseStatusFilter(nextStatus: string) {
    const nextQuery = query.trim();
    const searchChanged = nextQuery !== appliedQuery;
    setQuery(nextQuery);
    setAppliedQuery(nextQuery);
    setPage(1);
    if (status === nextStatus) {
      if (searchChanged) void load(1, { query: nextQuery, status: nextStatus });
      return;
    }
    // The status effect reloads changed tabs with the normalized search state.
    setStatus(nextStatus);
  }
  // The empty-state action disappears after clearing, so return keyboard focus to the persistent input.
  function clearCourseSearch() {
    setQuery('');
    setAppliedQuery('');
    setPage(1);
    void load(1, { query: '', status });
    courseSearchInputRef.current?.focus();
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
    try {
      await api.patch(`/api/manage/courses/${course.id}`, { status: nextStatus, ...(nextStatus === 'draft' ? { unpublish: true } : {}) });
      await load();
      if (filtersRef.current.status !== 'all' && filtersRef.current.status !== nextStatus) {
        // A changed status can remove its row from the active filter; focus the persistent search instead.
        courseSearchInputRef.current?.focus();
      }
    }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Course status could not be changed.'); }
    finally { markCourseAction(course.id, null); }
  }

  async function deleteCourse(course: Course, confirmed = false) {
    if (busyActionsRef.current[course.id]) return;
    if (!confirmed) { setPendingDeleteCourse(course); return; }
    markCourseAction(course.id, 'delete'); setError('');
    try {
      await api.delete(`/api/manage/courses/${course.id}`);
      await load();
      // The deleted row no longer provides a stable place to return keyboard focus.
      courseSearchInputRef.current?.focus();
    }
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
  const emptyCourseAction = appliedQuery
    ? <Button type="button" variant="secondary" onClick={clearCourseSearch}>Clear search</Button>
    : status === 'all' && <Link className="button button-primary" to="/manage/courses/new"><Plus size={17} aria-hidden="true" />Create first course</Link>;
  return <div className="management-page">
    <PageHeading title="Courses" action={<div className="analytics-heading-actions"><Link className="button button-secondary" to="/manage/course-groups"><UsersRound size={16} aria-hidden="true" />Course groups</Link><Link className="button button-primary" to="/manage/courses/new"><Plus size={18} aria-hidden="true" />Create course</Link></div>} />
    <div className="management-tabs" role="group" aria-label="Filter courses by status">
      {tabs.map((tab) => <button type="button" key={tab.value} aria-pressed={status === tab.value} className={status === tab.value ? 'active' : ''} onClick={() => changeCourseStatusFilter(tab.value)}>{tab.label}</button>)}
    </div>
    <form role="search" aria-label="Search courses" className="management-search" onSubmit={submitSearch}><Search size={19} aria-hidden="true" /><input ref={courseSearchInputRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search courses" aria-label="Search courses" maxLength={120} /><button type="submit">Search</button></form>
    {error && (failedRequest
      ? <div className="course-list-error"><Notice>{error}</Notice><Button type="button" variant="secondary" onClick={() => { void load(failedRequest.page, failedRequest); }}>Try again</Button></div>
      : <Notice>{error}</Notice>)}
    {hasEmptyCourseResult && <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{emptyCourseState.title}. {emptyCourseState.detail}</p>}
    {loading ? <div className="page-loading" role="status" aria-live="polite">Loading courses…</div> : failedRequest ? null : courses.length ? <div className="course-table-wrap" role="region" aria-label="Scrollable course list" tabIndex={0}><p className="table-scroll-hint">Scroll horizontally to see all course columns.</p><table className="course-table"><caption className="sr-only">Courses</caption><thead><tr><th scope="col">Course</th><th scope="col">Owner</th><th scope="col">Visibility</th><th scope="col">Status</th><th scope="col">Updated</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead><tbody>
      {courses.map((course) => {
        const busyAction = busyActions[course.id];
        return <tr key={course.id}>
        <th scope="row"><div className="table-course"><span className="table-thumb"><ImageWithFallback src={course.coverUrl} className="table-cover-image" alt="" loading="lazy" decoding="async" fallback={<BookOpen size={20} aria-hidden="true" />} /></span><div><Link to={`/manage/courses/${course.id}/edit`}>{course.title}</Link><small>{course.category}</small></div></div></th>
        <td><span className="owner-cell"><UserInitial username={course.owner || ''} />{course.owner}</span></td>
        <td><VisibilityLabel visibility={course.visibility} /></td>
        <td><div className="course-list-status"><CourseStatus status={course.status} />{course.hasUnpublishedChanges && <><CourseRevisionBadge status={course.reviewStatus} /><span className="sr-only">{courseRevisionAnnouncement(course.reviewStatus)}</span></>}{busyAction && <span className="course-list-action-status" role="status" aria-live="polite" aria-atomic="true">{courseRowActionStatus(busyAction)}</span>}</div></td>
        <td><DateText value={course.updatedAt} /></td>
        <td><div className="table-actions"><Link className="text-action" to={`/manage/courses/${course.id}/edit`}>Edit</Link><Link className="text-action" to={`/manage/courses/${course.id}/analytics`}>Analytics</Link><CourseRowMenu course={course} busyAction={busyAction} onStatusChange={changeStatus} onDelete={deleteCourse} /></div></td>
        </tr>;
      })}
    </tbody></table></div> : <EmptyState title={emptyCourseState.title} detail={emptyCourseState.detail} action={emptyCourseAction} />}
    {!loading && !failedRequest && total > 0 && <LogPagination ariaLabel="Course list pages" page={page} pageSize={pageSize} total={total} loading={loading} onChange={(nextPage) => load(nextPage)} />}
    {pendingDeleteCourse && <ConfirmationDialog {...courseDeletionConfirmation(pendingDeleteCourse.title)} confirmLabel="Delete course" onCancel={() => setPendingDeleteCourse(null)} onConfirm={() => { const courseToDelete = pendingDeleteCourse; setPendingDeleteCourse(null); if (courseToDelete) void deleteCourse(courseToDelete, true); }} />}
  </div>;
}

function Percentage({ value }: { value: number | null }) {
  return <span className="analytics-percentage">{formatPercentage(value)}</span>;
}

function CourseAnalyticsLearnerActivity({ courseId, learner }: { courseId: string; learner: CourseAnalyticsLearner }) {
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<CourseAnalyticsLearnerDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retryVersion, setRetryVersion] = useState(0);

  useEffect(() => {
    if (!open || details) return;
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError('');
    api.get<CourseAnalyticsLearnerDetails>(`/api/manage/courses/${courseId}/analytics/learners/${encodeURIComponent(learner.id)}`, { signal: controller.signal })
      .then((result) => { if (active) setDetails(result); })
      .catch((cause) => { if (active) setError(cause instanceof ApiError ? cause.message : 'Learner activity could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [courseId, learner.id, open, details, retryVersion]);

  return <details className="analytics-learner-details" aria-busy={loading} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary aria-label={`View activity details for ${learner.username}`}>View activity details</summary>
    {loading ? <p className="page-loading" role="status" aria-live="polite">Loading activity details…</p>
      : error ? <div className="error-notice-actionable" role="alert"><span>{error}</span><Button variant="secondary" onClick={() => setRetryVersion((version) => version + 1)}>Retry activity details</Button></div>
        : details && <div className="analytics-detail-grid">
          <section>
            <h3 id={`learner-${learner.id}-lesson-progress`}>Lesson progress</h3>
            <ul tabIndex={0} aria-labelledby={`learner-${learner.id}-lesson-progress`}>
              {details.lessonProgress.map((lesson) => <li key={lesson.id}>
                <span className={lesson.completed ? 'analytics-item-complete' : ''}>{lesson.completed ? 'Complete' : 'Not complete'}</span>
                <strong>{lesson.moduleTitle}: {lesson.title}</strong>
                {lesson.completedAt && <small><DateText value={lesson.completedAt} /></small>}
              </li>)}
            </ul>
          </section>
          <section>
            <h3 id={`learner-${learner.id}-quiz-attempts`}>Quiz attempts</h3>
            {details.quizProgress.length ? <ul tabIndex={0} aria-labelledby={`learner-${learner.id}-quiz-attempts`}>
              {details.quizProgress.map((quiz) => <li key={quiz.id}>
                <span className={quiz.passed ? 'analytics-item-complete' : ''}>{quiz.attempts ? `${quiz.attempts} attempt${quiz.attempts === 1 ? '' : 's'}` : 'Not attempted'}</span>
                <strong>{quiz.moduleTitle}: {quiz.title}</strong>
                {/* Keep expanded learner details aligned with the bounded summary metrics. */}
                <small>{quiz.attempts ? `Latest ${formatPercentage(quiz.latestScore)} · Best ${formatPercentage(quiz.highestScore)} · Pass mark ${formatPercentage(quiz.passMark)}` : `Pass mark ${formatPercentage(quiz.passMark)}`}</small>
              </li>)}
            </ul> : <p>This course has no quizzes.</p>}
          </section>
        </div>}
  </details>;
}

export function CourseAnalyticsPage() {
  const { courseId = '' } = useParams();
  const [data, setData] = useState<CourseAnalytics | null>(null);
  const [page, setPage] = useState(1);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [learnerPageLoading, setLearnerPageLoading] = useState(false);
  const [learnerPageError, setLearnerPageError] = useState('');
  const [learnerPageRetryVersion, setLearnerPageRetryVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setData(null); setPage(1); setError(''); setLearnerPageError(''); setLearnerPageLoading(false); setLoading(true);
    api.get<CourseAnalytics>(`/api/manage/courses/${courseId}/analytics?page=1`, { signal: controller.signal })
      .then((result) => { if (active) { setData(result); setPage(result.page); } })
      .catch((cause) => { if (active) setError(cause instanceof ApiError ? cause.message : 'Course analytics could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [courseId, refreshVersion]);

  useEffect(() => {
    if (!data || data.course.id !== courseId || page === data.page) return;
    const controller = new AbortController();
    let active = true;
    setLearnerPageLoading(true);
    setLearnerPageError('');
    api.get<CourseAnalyticsLearnerPage>(`/api/manage/courses/${courseId}/analytics?page=${page}&learnersOnly=1`, { signal: controller.signal })
      .then((result) => {
        if (!active) return;
        setData((current) => current && current.course.id === courseId ? {
          ...current,
          summary: { ...current.summary, learnerCount: result.learnerCount, disabledLearnerCount: result.disabledLearnerCount },
          learners: result.learners,
          page: result.page,
          pageSize: result.pageSize,
        } : current);
        setPage(result.page);
      })
      .catch((cause) => { if (active) setLearnerPageError(cause instanceof ApiError ? cause.message : 'Learner progress could not be loaded.'); })
      .finally(() => { if (active) setLearnerPageLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [courseId, page, learnerPageRetryVersion, data?.course.id, data?.page]);

  if (data && data.course.id !== courseId) return <div className="management-page page-loading" role="status" aria-live="polite">Loading course analytics…</div>;

  return <div className="management-page analytics-page">
    <div className="breadcrumbs"><Link to="/manage/courses">Courses</Link><span>/</span><span>Course dashboard</span></div>
    <PageHeading title={data?.course.title || 'Course dashboard'} subtitle="Learner progress and assessment performance across this course." action={<div className="analytics-heading-actions"><Link className="button button-secondary" to={`/manage/courses/${courseId}/access`}>Assign learners</Link><Link className="button button-secondary" to={`/manage/courses/${courseId}/edit`}>Edit course</Link></div>} />
    {error && <><Notice>{error}</Notice><Button variant="secondary" onClick={() => setRefreshVersion((version) => version + 1)}>Try again</Button></>}
    {loading ? <div className="page-loading" role="status" aria-live="polite">Loading course analytics…</div> : data && <>
      <div className="analytics-course-context"><CourseStatus status={data.course.status} /><VisibilityLabel visibility={data.course.visibility} /><span>{data.course.category}</span><span>{formatCountLabel(data.summary.learnerCount, 'learner', 'learners')} enrolled or assigned{data.summary.disabledLearnerCount ? ` · ${formatCountLabel(data.summary.disabledLearnerCount, 'learner', 'learners')} disabled` : ''}</span></div>
      <section className="analytics-kpi-grid" aria-label="Course summary metrics">
        <article className="analytics-kpi"><span>Completion rate</span><strong>{data.summary.completionRate === null ? '—' : <Percentage value={data.summary.completionRate} />}</strong><small>{data.summary.completedLearnerCount} of {formatCountLabel(data.summary.learnerCount, 'learner', 'learners')} completed</small></article>
        <article className="analytics-kpi"><span>Average progress</span><strong>{data.summary.averageProgress === null ? '—' : <Percentage value={data.summary.averageProgress} />}</strong><small>Across enrolled and assigned learners</small></article>
        <article className="analytics-kpi"><span>Started learning</span><strong>{data.summary.startedLearnerCount}</strong><small>At least one lesson or quiz activity</small></article>
        <article className="analytics-kpi"><span>Learning activity</span><strong>{data.summary.lessonCompletions + data.summary.quizAttempts}</strong><small>{formatCountLabel(data.summary.lessonCompletions, 'lesson completion', 'lesson completions')} · {formatCountLabel(data.summary.quizAttempts, 'quiz attempt', 'quiz attempts')}</small></article>
      </section>

      <section className="analytics-section">
        <div className="analytics-section-heading"><div><h2>Lesson completion</h2><p>Completion is measured against all enrolled and assigned learners.</p></div><span>{formatCountLabel(data.summary.lessonCount, 'lesson', 'lessons')}</span></div>
        {data.lessonMetrics.length ? <div className="analytics-table-wrap" role="region" aria-label="Scrollable lesson completion metrics" tabIndex={0}><p className="table-scroll-hint">Scroll horizontally to see all lesson metrics.</p><table className="analytics-table"><caption className="sr-only">Lesson completion metrics</caption><thead><tr><th scope="col">Module</th><th scope="col">Lesson</th><th scope="col">Completed</th><th scope="col">Rate</th></tr></thead><tbody>{data.lessonMetrics.map((lesson) => <tr key={lesson.id}><td>{lesson.moduleTitle}</td><th scope="row"><strong>{lesson.title}</strong></th><td>{lesson.completedCount} / {data.summary.learnerCount}</td><td>{lesson.completionRate === null ? '—' : <div className="analytics-rate-cell"><ProgressBar value={lesson.completionRate} label={`Completion rate for ${lesson.title}`} /><Percentage value={lesson.completionRate} /></div>}</td></tr>)}</tbody></table></div> : <EmptyState headingLevel={3} title="No lessons yet" detail="Add lessons to the course curriculum to see completion metrics." />}
      </section>

      <section className="analytics-section">
        <div className="analytics-section-heading"><div><h2>Quiz performance</h2><p>Pass rates use learners who attempted each quiz; average scores use all attempts.</p></div><span>{formatCountLabel(data.summary.quizCount, 'quiz', 'quizzes')}</span></div>
        {data.quizMetrics.length ? <div className="analytics-table-wrap" role="region" aria-label="Scrollable quiz performance metrics" tabIndex={0}><p className="table-scroll-hint">Scroll horizontally to see all quiz metrics.</p><table className="analytics-table"><caption className="sr-only">Quiz performance metrics</caption><thead><tr><th scope="col">Module</th><th scope="col">Quiz</th><th scope="col">Participation</th><th scope="col">Passed</th><th scope="col">Pass rate</th><th scope="col">Average score</th><th scope="col">Attempts</th></tr></thead><tbody>{data.quizMetrics.map((quiz) => <tr key={quiz.id}><td>{quiz.moduleTitle}</td><th scope="row"><strong>{quiz.title}</strong><small>Pass mark {formatPercentage(quiz.passMark)}</small></th><td>{formatCountLabel(quiz.learnersAttempted, 'learner', 'learners')} · {quiz.participationRate === null ? '—' : <Percentage value={quiz.participationRate} />}</td><td>{quiz.learnersPassed} / {quiz.learnersAttempted}</td><td>{quiz.passRate === null ? '—' : <Percentage value={quiz.passRate} />}</td><td>{quiz.averageScore === null ? '—' : <Percentage value={quiz.averageScore} />}</td><td>{quiz.attempts}</td></tr>)}</tbody></table></div> : <EmptyState headingLevel={3} title="No quizzes yet" detail="Add module quizzes to see participation and score metrics." />}
      </section>

      <section className="analytics-section analytics-learners-section" aria-busy={learnerPageLoading}>
        <div className="analytics-section-heading"><div><h2>Learner progress</h2><p>Per-person lesson completion, quiz attempts, and course completion.</p></div><span>{formatCountLabel(data.summary.learnerCount, 'learner', 'learners')}</span></div>
        {learnerPageLoading ? <p className="page-loading" role="status" aria-live="polite">Loading learner progress page {page}…</p>
          : learnerPageError ? <div className="error-notice-actionable" role="alert"><span>{learnerPageError}</span><Button variant="secondary" onClick={() => setLearnerPageRetryVersion((version) => version + 1)}>Retry learner page</Button></div>
            : data.learners.length ? <div className="analytics-table-wrap analytics-learners-table-wrap" role="region" aria-label="Scrollable learner progress" tabIndex={0}><p className="table-scroll-hint">Scroll horizontally to see all learner progress columns.</p><table className="analytics-table analytics-learners-table"><caption className="sr-only">Learner-level course progress</caption><thead><tr><th scope="col">Learner</th><th scope="col">Progress</th><th scope="col">Lessons</th><th scope="col">Quizzes passed</th><th scope="col">Last activity</th><th scope="col">Status</th></tr></thead><tbody>{data.learners.map((learner) => <tr key={learner.id}>
          <th scope="row">
            <strong>{learner.username}</strong>
            {learner.disabled && <small className="analytics-disabled-label">Disabled account</small>}
            {/* Scope the disclosure cache to the course when route params change in place. */}
            <CourseAnalyticsLearnerActivity key={`${courseId}:${learner.id}`} courseId={courseId} learner={learner} />
          </th>
          <td><div className="analytics-rate-cell"><ProgressBar value={learner.progress} label={`Course progress for ${learner.username}`} /><Percentage value={learner.progress} /></div></td>
          <td>{learner.completedLessonCount} / {learner.lessonCount}</td>
          <td>{learner.passedQuizCount} / {learner.quizCount}</td>
          <td>{learner.lastActivityAt ? <DateText value={learner.lastActivityAt} /> : '—'}</td>
          <td><span className={`analytics-learner-state ${learner.completed ? 'is-complete' : learner.started ? 'is-started' : ''}`}>{learner.completed ? 'Completed' : learner.started ? 'In progress' : 'Not started'}</span></td>
        </tr>)}</tbody></table></div> : <EmptyState headingLevel={3} title="No learners assigned or enrolled" detail="Assign learners to this course or wait for learners to open it." action={<Link className="button button-primary" to={`/manage/courses/${courseId}/access`}>Assign learners</Link>} />}
        {data.summary.learnerCount > 0 && <LogPagination ariaLabel="Learner progress pages" page={page} pageSize={data.pageSize} total={data.summary.learnerCount} loading={learnerPageLoading} onChange={(nextPage) => { setLearnerPageError(''); setPage(nextPage); }} />}
      </section>
    </>}
  </div>;
}

function QuizEditor({ module, onSaved, onError, titleInputRef }: { module: CourseModule; onSaved: (action: 'saved' | 'removed') => void | Promise<void>; onError: (message: string) => void; titleInputRef?: (node: HTMLInputElement | null) => void }) {
  const existing = module.quiz;
  const [title, setTitle] = useState(existing?.title || `${module.title} quiz`);
  const [titleError, setTitleError] = useState('');
  const [passMark, setPassMark] = useState(existing?.passMark ?? 70);
  const [questions, setQuestions] = useState<EditableQuizQuestion[]>(existing?.questions || []);
  const [busyAction, setBusyAction] = useState<'save' | 'remove' | null>(null);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [focusTarget, setFocusTarget] = useState<{ questionIndex: number; choiceIndex?: number } | null>(null);
  const [showTextValidation, setShowTextValidation] = useState(false);
  const editorKeySequenceRef = useRef(0);
  const quizTitleInputRef = useRef<HTMLInputElement>(null);
  const questionInputRefs = useRef<Array<HTMLTextAreaElement | null>>([]);
  const choiceInputRefs = useRef<Array<Array<HTMLInputElement | null>>>([]);
  const addQuestionButtonRef = useRef<HTMLButtonElement | null>(null);
  const setQuizTitleInputRef = useCallback((node: HTMLInputElement | null) => {
    quizTitleInputRef.current = node;
    titleInputRef?.(node);
  }, [titleInputRef]);
  const quizContext = `${module.title} quiz (module ${module.position + 1})`;

  function nextEditorKey(kind: 'question' | 'choice') {
    editorKeySequenceRef.current += 1;
    return `quiz-editor-${kind}-${editorKeySequenceRef.current}`;
  }

  useEffect(() => {
    setTitle(existing?.title || `${module.title} quiz`);
    setTitleError('');
    setPassMark(existing?.passMark ?? 70);
    setQuestions(existing?.questions || []);
    setConfirmingRemoval(false);
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
    const titleValidation = validateQuizTitle(title);
    const normalizedTitle = titleValidation.value;
    if (normalizedTitle === null) {
      setTitleError(titleValidation.error ?? QUIZ_TITLE_REQUIRED_ERROR);
      window.requestAnimationFrame(() => quizTitleInputRef.current?.focus());
      return;
    }
    setTitleError('');
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
      await api.put(`/api/manage/modules/${module.id}/quiz`, { title: normalizedTitle, passMark: Number(passMark), questions: savedQuestions });
      setTitle(normalizedTitle);
      await onSaved('saved');
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'validation_error'
        && [QUIZ_TITLE_REQUIRED_ERROR, QUIZ_TITLE_TOO_LONG_ERROR].includes(cause.message)) {
        setTitleError(cause.message);
        window.requestAnimationFrame(() => quizTitleInputRef.current?.focus());
      } else onError(cause instanceof ApiError ? cause.message : 'Quiz could not be saved.');
    }
    finally { setBusyAction(null); }
  }
  async function remove(confirmed = false) {
    if (!existing || busyAction) return;
    if (!confirmed) { setConfirmingRemoval(true); return; }
    setBusyAction('remove');
    try { await api.delete(`/api/manage/modules/${module.id}/quiz`); await onSaved('removed'); }
    catch (cause) { onError(cause instanceof ApiError ? cause.message : 'Quiz could not be removed.'); }
    finally { setBusyAction(null); }
  }

  return <div className="quiz-editor" aria-busy={busyAction !== null}>
    {/* The quiz labels carry the meaning; these action and type glyphs are decorative. */}
    <div className="quiz-editor-head"><div><span className="editor-type"><CircleHelp size={15} aria-hidden="true" />Module quiz</span><h4>{existing ? 'Edit quiz' : 'Add a quiz'}</h4></div>{existing && <button type="button" className="icon-button danger-icon" aria-label={busyAction === 'remove' ? `Removing ${quizContext}` : `Remove ${quizContext}`} disabled={busyAction !== null} onClick={() => void remove()}><Trash2 size={16} aria-hidden="true" /></button>}</div>
    {textValidationIssue && <Notice>Enter text for every quiz question and answer choice before saving.</Notice>}
    <fieldset className="quiz-editor-fields" aria-label={`Fields for ${quizContext}`} disabled={busyAction !== null}>
    <div className="quiz-settings-row"><label><span className="form-label-row"><span>Quiz title</span><small className="form-required-indicator" aria-hidden="true">Required</small></span><input ref={setQuizTitleInputRef} required aria-label={`Quiz title for ${quizContext}`} value={title} maxLength={quizTitleLimit} aria-invalid={titleError ? true : undefined} aria-describedby={titleError ? `quiz-title-error-${module.id}` : undefined} onChange={(event) => { setTitle(event.target.value); setTitleError(''); }} />{titleError && <small id={`quiz-title-error-${module.id}`} className="quiz-title-error" role="alert">{titleError}</small>}</label><div className="app-select-field"><span>Pass mark</span><AppSelect<number> ariaLabel={`Pass mark for ${quizContext}`} value={passMark} onChange={setPassMark} options={QUIZ_PASS_MARK_OPTIONS} /></div></div>
    {questions.map((question, questionIndex) => <div className="question-editor" key={question.id || question.editorKey || questionIndex}>
      <div className="question-editor-head"><span>Question {questionIndex + 1}</span><button type="button" className="text-action danger-text" aria-label={`Remove question ${questionIndex + 1} from ${quizContext}`} onClick={() => removeQuestion(questionIndex)}>Remove</button></div>
      <label className="sr-only" htmlFor={`question-${module.id}-${questionIndex}`}>Question {questionIndex + 1} text for {quizContext}</label><textarea ref={(node) => { questionInputRefs.current[questionIndex] = node; }} id={`question-${module.id}-${questionIndex}`} rows={2} maxLength={1000} placeholder="Write a question" value={question.prompt} onChange={(event) => updateQuestion(questionIndex, { prompt: event.target.value })} aria-invalid={textValidationIssue?.questionIndex === questionIndex && textValidationIssue.choiceIndex === undefined || undefined} aria-describedby={textValidationIssue?.questionIndex === questionIndex && textValidationIssue.choiceIndex === undefined ? `quiz-question-error-${module.id}-${questionIndex}` : undefined} />
      {textValidationIssue?.questionIndex === questionIndex && textValidationIssue.choiceIndex === undefined && <span className="sr-only" id={`quiz-question-error-${module.id}-${questionIndex}`}>Enter text for question {questionIndex + 1}.</span>}
      <fieldset className="quiz-answer-fieldset" aria-describedby={`correct-answer-hint-${module.id}-${questionIndex}`}>
        <legend className="sr-only">Correct answer for question {questionIndex + 1} in {quizContext}</legend>
        <p className="form-hint" id={`correct-answer-hint-${module.id}-${questionIndex}`}>Select one correct answer. Each question needs two to six answer choices.</p>
        {question.choices.map((choice, choiceIndex) => <div className="choice-editor-row" key={choice.id || choice.editorKey || choiceIndex}><input type="radio" name={`correct-${module.id}-${questionIndex}`} checked={Boolean(choice.isCorrect)} onChange={() => updateChoice(questionIndex, choiceIndex, { isCorrect: true })} aria-label={`Mark answer choice ${choiceIndex + 1} correct for question ${questionIndex + 1} in ${quizContext}`} /><input ref={(node) => { choiceInputRefs.current[questionIndex] ??= []; choiceInputRefs.current[questionIndex][choiceIndex] = node; }} value={choice.text} maxLength={500} onChange={(event) => updateChoice(questionIndex, choiceIndex, { text: event.target.value })} aria-label={`Answer choice ${choiceIndex + 1} for question ${questionIndex + 1} in ${quizContext}`} placeholder={`Answer ${choiceIndex + 1}`} aria-invalid={textValidationIssue?.questionIndex === questionIndex && textValidationIssue.choiceIndex === choiceIndex || undefined} aria-describedby={textValidationIssue?.questionIndex === questionIndex && textValidationIssue.choiceIndex === choiceIndex ? `quiz-choice-error-${module.id}-${questionIndex}-${choiceIndex}` : undefined} /><button type="button" className="icon-button danger-icon" aria-label={`Remove answer choice ${choiceIndex + 1} from question ${questionIndex + 1} in ${quizContext}`} disabled={question.choices.length <= 2} onClick={() => removeChoice(questionIndex, choiceIndex)}><Trash2 size={15} aria-hidden="true" /></button>{textValidationIssue?.questionIndex === questionIndex && textValidationIssue.choiceIndex === choiceIndex && <span className="sr-only" id={`quiz-choice-error-${module.id}-${questionIndex}-${choiceIndex}`}>Enter text for answer choice {choiceIndex + 1}.</span>}</div>)}
      </fieldset>
      {question.choices.length < 6 && <button className="text-action add-choice" type="button" aria-label={`Add answer choice to question ${questionIndex + 1} in ${quizContext}`} onClick={() => addChoice(questionIndex)}><Plus size={15} aria-hidden="true" />Add answer choice</button>}
      <label className="explanation-label">Explanation (optional)<input aria-label={`Explanation (optional) for question ${questionIndex + 1} in ${quizContext}`} value={question.explanation || ''} maxLength={1000} onChange={(event) => updateQuestion(questionIndex, { explanation: event.target.value })} /></label>
    </div>)}
    <div className="quiz-editor-actions">
      <button ref={addQuestionButtonRef} className="text-action" type="button" aria-label={questions.length >= 50 ? `Question limit reached for ${quizContext}` : `Add question to ${quizContext}`} disabled={busyAction !== null || questions.length >= 50} onClick={addQuestion}><Plus size={16} aria-hidden="true" />{questions.length >= 50 ? 'Question limit reached' : 'Add question'}</button>
      <Button variant="secondary" type="button" aria-label={busyAction === 'save' ? `Saving quiz ${quizContext}` : hasChanges ? `Save quiz ${quizContext}` : `No changes to ${quizContext}`} disabled={busyAction !== null || !hasChanges} onClick={save}>{busyAction === 'save' ? 'Saving quiz…' : hasChanges ? 'Save quiz' : 'No changes'}</Button>
    </div>
    </fieldset>
    {confirmingRemoval && existing && <ConfirmationDialog title="Remove this quiz?" description={`All saved learner attempts for ${quizContext} will also be removed. This action cannot be undone.`} confirmLabel="Remove quiz" onCancel={() => setConfirmingRemoval(false)} onConfirm={() => { setConfirmingRemoval(false); void remove(true); }} />}
  </div>;
}

type FinalExamChoiceEditor = { id?: string; editorKey: string; text: string; isCorrect: boolean };
type FinalExamQuestionEditor = { id?: string; editorKey: string; prompt: string; explanation: string; position: number; choices: FinalExamChoiceEditor[] };
type FinalExamQuestionResponse = Omit<FinalExamQuestionEditor, 'editorKey' | 'choices' | 'id'> & {
  id: string;
  choices: Array<Omit<FinalExamChoiceEditor, 'editorKey'>>;
};
type FinalExamQuestionBankResponse = { questions: FinalExamQuestionResponse[]; total: number; page: number; pageSize: number; hasMore: boolean };

function makeFinalExamQuestion(editorKey: string, position: number): FinalExamQuestionEditor {
  return {
    editorKey,
    prompt: '',
    explanation: '',
    position,
    choices: [
      { editorKey: `${editorKey}-choice-1`, text: '', isCorrect: true },
      { editorKey: `${editorKey}-choice-2`, text: '', isCorrect: false },
    ],
  };
}

function hydrateFinalExamQuestion(question: FinalExamQuestionResponse, fallbackPosition: number): FinalExamQuestionEditor {
  return {
    ...question,
    editorKey: question.id || `saved-${fallbackPosition}`,
    explanation: question.explanation ?? '',
    position: Number.isInteger(question.position) ? question.position : fallbackPosition,
    choices: question.choices.map((choice, index) => ({
      ...choice,
      isCorrect: Boolean(choice.isCorrect),
      editorKey: choice.id || `saved-choice-${fallbackPosition}-${index}`,
    })),
  };
}

function finalExamQuestionKey(question: FinalExamQuestionEditor) {
  return question.id || question.editorKey;
}

function CourseFinalExamEditor({ courseId, exam, onChanged, onError, onNotice }: {
  courseId: string;
  exam: Course['finalExam'];
  onChanged: () => Promise<boolean>;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const [title, setTitle] = useState(exam?.title ?? 'Final exam');
  const [passMark, setPassMark] = useState(exam?.passMark ?? 70);
  const [questionsPerAttempt, setQuestionsPerAttempt] = useState(exam?.questionsPerAttempt ?? 0);
  const [requiredForCompletion, setRequiredForCompletion] = useState(exam?.requiredForCompletion ?? true);
  const [questions, setQuestions] = useState<FinalExamQuestionEditor[]>([]);
  const [questionCache, setQuestionCache] = useState<Record<string, FinalExamQuestionEditor>>({});
  const [questionDrafts, setQuestionDrafts] = useState<Record<string, FinalExamQuestionEditor>>({});
  const [questionCount, setQuestionCount] = useState(exam?.questionCount ?? 0);
  const [resultCount, setResultCount] = useState(exam?.questionCount ?? 0);
  const [searchText, setSearchText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selectedQuestionKey, setSelectedQuestionKey] = useState<string | null>(null);
  const [mobileEditorOpen, setMobileEditorOpen] = useState(false);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [busyAction, setBusyAction] = useState<'create' | 'settings' | 'delete-exam' | string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);
  const [confirmExamRemoval, setConfirmExamRemoval] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [importPreview, setImportPreview] = useState<FinalExamImportPreview | null>(null);
  const [importFileName, setImportFileName] = useState('');
  const [importError, setImportError] = useState('');
  const [importStatus, setImportStatus] = useState('');
  const [readingImportFile, setReadingImportFile] = useState(false);
  const [importing, setImporting] = useState(false);
  const editorKeySequenceRef = useRef(0);
  const questionSearchInputId = useId();
  const importFileInputId = useId();
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(resultCount / pageSize));
  const activeQuestion = selectedQuestionKey
    ? questionDrafts[selectedQuestionKey] ?? questionCache[selectedQuestionKey] ?? null
    : null;
  const activeQuestionIsDirty = Boolean(selectedQuestionKey && questionDrafts[selectedQuestionKey]);
  const unsavedNewQuestions = Object.values(questionDrafts).filter((question) => !question.id);

  async function finishExamChange(successMessage: string) {
    if (await onChanged()) onNotice(successMessage);
    else onError(`${successMessage} The course editor could not be refreshed. Reload before making another change.`);
  }
  useEffect(() => {
    setTitle(exam?.title ?? 'Final exam');
    setPassMark(exam?.passMark ?? 70);
    setQuestionsPerAttempt(exam?.questionsPerAttempt ?? 0);
    setRequiredForCompletion(exam?.requiredForCompletion ?? true);
    setQuestionCount(exam?.questionCount ?? 0);
    setResultCount(exam?.questionCount ?? 0);
    setQuestions([]);
    setQuestionCache({});
    setQuestionDrafts({});
    setSelectedQuestionKey(null);
    setSearchText('');
    setSearchQuery('');
    setPage(1);
    setMobileEditorOpen(false);
    setImportOpen(false);
    setImportPreview(null);
    setImportFileName('');
    setImportError('');
    setImportStatus('');
  }, [courseId, exam?.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextQuery = searchText.trim();
      if (nextQuery !== searchQuery) {
        setSearchQuery(nextQuery);
        setPage(1);
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [searchText, searchQuery]);

  useEffect(() => {
    if (!exam?.id) { setQuestions([]); return; }
    const controller = new AbortController();
    setLoadingQuestions(true);
    const params = new URLSearchParams({ page: String(page) });
    if (searchQuery) params.set('q', searchQuery);
    api.get<FinalExamQuestionBankResponse>(
      `/api/manage/courses/${courseId}/final-exam/questions?${params}`,
      { signal: controller.signal },
    ).then((response) => {
      const loadedQuestions = response.questions.map((question, index) => hydrateFinalExamQuestion(question, (response.page - 1) * response.pageSize + index));
      setQuestions(loadedQuestions);
      setQuestionCache((current) => ({
        ...current,
        ...Object.fromEntries(loadedQuestions.map((question) => [finalExamQuestionKey(question), question])),
      }));
      setResultCount(response.total);
      if (!searchQuery) setQuestionCount(response.total);
      setPage(response.page);
      setSelectedQuestionKey((current) => current ?? loadedQuestions[0]?.id ?? null);
    }).catch((cause) => {
      if (!controller.signal.aborted) onErrorRef.current(cause instanceof ApiError ? cause.message : 'Final exam questions could not be loaded.');
    }).finally(() => { if (!controller.signal.aborted) setLoadingQuestions(false); });
    return () => controller.abort();
  }, [courseId, exam?.id, page, searchQuery, refreshVersion]);

  async function createExam() {
    if (busyAction) return;
    setBusyAction('create'); onError('');
    try {
      await api.put(`/api/manage/courses/${courseId}/final-exam`, {
        title: 'Final exam', passMark: 70, questionsPerAttempt: 0, requiredForCompletion: true,
      });
      await finishExamChange('Final exam added.');
    } catch (cause) { onError(cause instanceof ApiError ? cause.message : 'Final exam could not be created.'); }
    finally { setBusyAction(null); }
  }

  async function saveSettings(event: React.FormEvent) {
    event.preventDefault();
    if (!exam || busyAction) return;
    const titleValidation = validateQuizTitle(title);
    if (titleValidation.value === null) { onError(titleValidation.error ?? QUIZ_TITLE_REQUIRED_ERROR); return; }
    if (!Number.isInteger(questionsPerAttempt) || questionsPerAttempt < 0) { onError('Questions per attempt must be zero (all questions) or a positive whole number.'); return; }
    setBusyAction('settings'); onError('');
    try {
      await api.put(`/api/manage/courses/${courseId}/final-exam`, {
        title: titleValidation.value, passMark: Number(passMark), questionsPerAttempt, requiredForCompletion,
      });
      await finishExamChange('Final exam settings saved.');
    } catch (cause) { onError(cause instanceof ApiError ? cause.message : 'Final exam settings could not be saved.'); }
    finally { setBusyAction(null); }
  }

  function updateActiveQuestion(patch: Partial<FinalExamQuestionEditor>) {
    if (!activeQuestion || !selectedQuestionKey) return;
    // Clear the previous success message once a question has unsaved edits.
    onNotice('');
    setQuestionDrafts((current) => ({
      ...current,
      [selectedQuestionKey]: { ...(current[selectedQuestionKey] ?? activeQuestion), ...patch },
    }));
  }

  function updateActiveChoice(choiceIndex: number, patch: Partial<FinalExamChoiceEditor>) {
    if (!activeQuestion) return;
    updateActiveQuestion({ choices: activeQuestion.choices.map((choice, index) => ({
      ...choice,
      ...(index === choiceIndex ? patch : {}),
      ...(patch.isCorrect === true && index !== choiceIndex ? { isCorrect: false } : {}),
    })) });
  }

  async function saveQuestion(addAnother = false) {
    if (!exam || !activeQuestion || !selectedQuestionKey || busyAction) return;
    const question = activeQuestion;
    if (!question.prompt.trim() || question.choices.some((choice) => !choice.text.trim())) { onError('Enter text for the question and every answer choice before saving.'); return; }
    if (question.choices.length < 2 || question.choices.length > 6 || question.choices.filter((choice) => choice.isCorrect).length !== 1) { onError('Each final exam question needs two to six choices and exactly one correct answer.'); return; }
    setBusyAction(question.id || question.editorKey); onError('');
    const payload = {
      prompt: question.prompt,
      explanation: question.explanation,
      choices: question.choices.map(({ text, isCorrect }) => ({ text, isCorrect })),
    };
    try {
      const response = question.id
        ? await api.put<{ question: FinalExamQuestionResponse }>(`/api/manage/courses/${courseId}/final-exam/questions/${question.id}`, payload)
        : await api.post<{ question: FinalExamQuestionResponse }>(`/api/manage/courses/${courseId}/final-exam/questions`, payload);
      const newQuestionCount = question.id ? questionCount : questionCount + 1;
      const savedQuestion = hydrateFinalExamQuestion(response.question, question.position);
      const newDraft = addAnother ? makeFinalExamQuestion(`new-question-${++editorKeySequenceRef.current}`, newQuestionCount) : null;
      setQuestionCount(newQuestionCount);
      if (!question.id && !searchQuery) setResultCount(newQuestionCount);
      setQuestionCache((current) => ({ ...current, [response.question.id]: savedQuestion }));
      setQuestionDrafts((current) => {
        const next = { ...current };
        delete next[selectedQuestionKey];
        if (newDraft) next[finalExamQuestionKey(newDraft)] = newDraft;
        return next;
      });
      if (!question.id) {
        setSearchText('');
        setSearchQuery('');
        setPage(Math.max(1, Math.ceil(newQuestionCount / pageSize)));
      }
      setSelectedQuestionKey(newDraft ? finalExamQuestionKey(newDraft) : response.question.id);
      setRefreshVersion((version) => version + 1);
      await finishExamChange(addAnother ? 'Question added. Start the next question.' : question.id ? 'Final exam question saved.' : 'Question added to the final exam bank.');
    } catch (cause) { onError(cause instanceof ApiError ? cause.message : 'Final exam question could not be saved.'); }
    finally { setBusyAction(null); }
  }

  async function readImportFile(file: File, input: HTMLInputElement) {
    setImportError('');
    setImportStatus('');
    setImportPreview(null);
    setImportFileName(file.name);
    const extension = file.name.toLowerCase().split('.').pop();
    if (!['xlsx', 'csv', 'tsv'].includes(extension ?? '')) {
      setImportError('Choose an .xlsx, .csv, or .tsv file. Legacy .xls files should be saved as .xlsx first.');
      input.value = '';
      return;
    }
    if (file.size === 0 || file.size > 10 * 1024 * 1024) {
      setImportError('Choose a non-empty spreadsheet that is 10 MB or smaller.');
      input.value = '';
      return;
    }
    setReadingImportFile(true);
    try {
      const rows = extension === 'xlsx'
        ? await import('read-excel-file/universal').then(({ readSheet }) => readSheet(file))
        : parseDelimitedFinalExamFile(await file.text(), extension === 'tsv' ? '\t' : ',');
      setImportPreview(parseFinalExamImportRows(rows as readonly (readonly unknown[])[]));
    } catch {
      setImportError('This spreadsheet could not be read. Check that the file is valid and try again.');
    } finally {
      setReadingImportFile(false);
      input.value = '';
    }
  }

  async function importQuestions() {
    if (!exam || !importPreview || importPreview.errors.length || !importPreview.questions.length || importing || busyAction !== null) return;
    const payload = { questions: importPreview.questions };
    if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > 900_000) {
      setImportError('The question text is too large for one import. Split the spreadsheet into smaller files and try again.');
      return;
    }
    setImporting(true);
    setBusyAction('import');
    setImportError('');
    onError('');
    try {
      const response = await api.post<{ importedCount: number }>(`/api/manage/courses/${courseId}/final-exam/questions/import`, payload);
      const newCount = questionCount + response.importedCount;
      setQuestionCount(newCount);
      setResultCount(newCount);
      setSearchText('');
      setSearchQuery('');
      setPage(Math.max(1, Math.ceil(newCount / pageSize)));
      setRefreshVersion((version) => version + 1);
      setImportPreview(null);
      setImportFileName('');
      setImportStatus(`${response.importedCount} ${response.importedCount === 1 ? 'question' : 'questions'} added to the exam bank.`);
      await finishExamChange(`${response.importedCount} ${response.importedCount === 1 ? 'question' : 'questions'} imported.`);
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : 'The questions could not be imported.';
      setImportError(message);
      onError(message);
    } finally {
      setImporting(false);
      setBusyAction(null);
    }
  }

  function addQuestion() {
    onNotice('');
    const newDraft = makeFinalExamQuestion(`new-question-${++editorKeySequenceRef.current}`, questionCount);
    const key = finalExamQuestionKey(newDraft);
    setQuestionDrafts((current) => ({ ...current, [key]: newDraft }));
    setSelectedQuestionKey(key);
    setMobileEditorOpen(true);
  }

  async function removeQuestion(questionId: string) {
    if (!exam || busyAction) return;
    setBusyAction(questionId); onError('');
    try {
      await api.delete(`/api/manage/courses/${courseId}/final-exam/questions/${questionId}`);
      setPendingDelete(null);
      setQuestionCount((count) => Math.max(0, count - 1));
      setQuestionDrafts((current) => { const next = { ...current }; delete next[questionId]; return next; });
      setQuestionCache((current) => { const next = { ...current }; delete next[questionId]; return next; });
      setSelectedQuestionKey((current) => current === questionId ? (unsavedNewQuestions[0] ? finalExamQuestionKey(unsavedNewQuestions[0]) : null) : current);
      if (!searchQuery || questions.some((question) => question.id === questionId)) setResultCount((count) => Math.max(0, count - 1));
      const remainingResults = Math.max(0, resultCount - (searchQuery && !questions.some((question) => question.id === questionId) ? 0 : 1));
      const lastPage = Math.max(1, Math.ceil(remainingResults / pageSize));
      setPage((current) => Math.min(current, lastPage));
      setMobileEditorOpen(false);
      setRefreshVersion((version) => version + 1);
      await finishExamChange('Final exam question removed.');
    } catch (cause) { onError(cause instanceof ApiError ? cause.message : 'Final exam question could not be removed.'); }
    finally { setBusyAction(null); }
  }

  async function removeExam() {
    if (busyAction) return;
    setBusyAction('delete-exam'); onError('');
    try { await api.delete(`/api/manage/courses/${courseId}/final-exam`); setConfirmExamRemoval(false); await finishExamChange('Final exam removed.'); }
    catch (cause) { onError(cause instanceof ApiError ? cause.message : 'Final exam could not be removed.'); }
    finally { setBusyAction(null); }
  }

  return <section className="course-final-exam-editor" aria-busy={busyAction !== null || loadingQuestions}>
    <div className="course-final-exam-heading"><div><span className="editor-type"><CircleHelp size={15} aria-hidden="true" />Course-wide exam</span><h3>Final exam</h3><p>Add a large bank of questions and choose a random sample for each attempt.</p></div>
      {exam && <button type="button" className="icon-button danger-icon" aria-label="Remove final exam" disabled={busyAction !== null} onClick={() => setConfirmExamRemoval(true)}><Trash2 size={16} aria-hidden="true" /></button>}
    </div>
    {!exam ? <Button type="button" variant="secondary" disabled={busyAction !== null} onClick={() => void createExam()}><Plus size={16} aria-hidden="true" />{busyAction === 'create' ? 'Adding final exam…' : 'Add final exam'}</Button> : <>
      <form className="final-exam-settings" onSubmit={(event) => void saveSettings(event)}>
        <label><span className="form-label-row"><span>Exam title</span><small className="form-required-indicator" aria-hidden="true">Required</small></span><input required maxLength={quizTitleLimit} value={title} onChange={(event) => { onNotice(''); setTitle(event.target.value); }} /></label>
        <div className="app-select-field"><span>Pass mark</span><AppSelect<number> ariaLabel="Final exam pass mark" value={passMark} onChange={(value) => { onNotice(''); setPassMark(value); }} options={QUIZ_PASS_MARK_OPTIONS} /></div>
        <label><span>Questions per attempt</span><input type="number" min={0} step={1} value={questionsPerAttempt} onChange={(event) => { onNotice(''); setQuestionsPerAttempt(event.target.value === '' ? 0 : Number(event.target.value)); }} /><small>Enter 0 to draw all {formatCountLabel(questionCount, 'bank question', 'bank questions')} on each attempt.</small></label>
        <label className="final-exam-required-toggle"><input type="checkbox" checked={requiredForCompletion} onChange={(event) => { onNotice(''); setRequiredForCompletion(event.target.checked); }} /><span>Passing this exam is required to complete the course</span></label>
        {!requiredForCompletion && <p className="form-hint final-exam-practice-note">Practice exam attempts do not affect course completion or certificates. An exam-only course must make its exam required.</p>}
        {questionsPerAttempt > questionCount && <p className="form-hint final-exam-count-warning" role="status">Add at least {questionsPerAttempt - questionCount} more {questionsPerAttempt - questionCount === 1 ? 'question' : 'questions'} before publishing.</p>}
        <Button type="submit" variant="secondary" disabled={busyAction !== null}>{busyAction === 'settings' ? 'Saving settings…' : 'Save exam settings'}</Button>
      </form>
      <div className="final-exam-question-heading"><div><h4>Question bank</h4><p>{formatCountLabel(questionCount, 'question', 'questions')} · {formatCountLabel(questionsPerAttempt || questionCount, 'question per attempt', 'questions per attempt')}{questionsPerAttempt === 0 ? ' (all)' : ''}</p></div></div>
      <div className="final-exam-question-workspace" data-mobile-view={mobileEditorOpen ? 'editor' : 'bank'}>
        <section className="final-exam-bank-pane" aria-label="Final exam question bank">
          <div className="final-exam-bank-toolbar">
            <div className="final-exam-question-search"><Search size={17} aria-hidden="true" /><label className="sr-only" htmlFor={questionSearchInputId}>Search questions</label><input id={questionSearchInputId} type="search" value={searchText} maxLength={120} placeholder="Search questions" aria-label="Search questions" onChange={(event) => setSearchText(event.target.value)} />{searchText && <button type="button" className="text-action" onClick={() => setSearchText('')}>Clear</button>}</div>
            <Button type="button" variant="secondary" disabled={busyAction !== null} onClick={() => setImportOpen((open) => !open)}><Upload size={16} aria-hidden="true" />Import questions</Button>
            <Button type="button" variant="secondary" disabled={busyAction !== null} onClick={addQuestion}><Plus size={16} aria-hidden="true" />Add question</Button>
          </div>
          {importOpen && <section className="final-exam-import-panel" aria-label="Import questions from spreadsheet">
            <div className="final-exam-import-heading"><div><strong>Import from a spreadsheet</strong><p>Put the headers in row 1 of the first worksheet. Import up to 100 questions at a time.</p></div><button type="button" className="text-action" disabled={importing} onClick={() => setImportOpen(false)}>Close</button></div>
            <p className="final-exam-import-format">Required columns: <strong>Question</strong>, at least two answer columns, and <strong>Correct Answer</strong>. You can also include <strong>Explanation</strong>.</p>
            <div className="final-exam-import-actions">
              <Button type="button" variant="secondary" onClick={downloadFinalExamImportTemplate}><Download size={15} aria-hidden="true" />Download template</Button>
              <label className="button button-secondary file-button"><FileText size={15} aria-hidden="true" />{readingImportFile ? 'Reading spreadsheet…' : 'Choose spreadsheet'}<input id={importFileInputId} type="file" accept=".xlsx,.csv,.tsv" disabled={readingImportFile || importing} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void readImportFile(file, event.currentTarget); }} /></label>
            </div>
            <p className="final-exam-import-hint">Accepts .xlsx, .csv, and .tsv files up to 10 MB. Answer columns can be named Answer 1–6, Choice 1–6, or A–F. Correct Answer accepts a number, letter, or exact answer text.</p>
            {importFileName && <p className="final-exam-import-filename">Selected: {importFileName}</p>}
            {importError && <p className="final-exam-import-error" role="alert">{importError}</p>}
            {importStatus && <p className="final-exam-import-success" role="status">{importStatus}</p>}
            {importPreview && <div className="final-exam-import-preview">
              <p className="final-exam-import-summary" role="status">{formatCountLabel(importPreview.questions.length, 'question ready', 'questions ready')} to import{importPreview.skippedRows ? ` · ${importPreview.skippedRows} blank ${importPreview.skippedRows === 1 ? 'row' : 'rows'} skipped` : ''}.</p>
              {importPreview.errors.length > 0 && <div className="final-exam-import-issues"><strong>Fix these spreadsheet issues before importing:</strong><ul>{importPreview.errors.slice(0, 8).map((error) => <li key={error}>{error}</li>)}</ul>{importPreview.errors.length > 8 && <small>And {importPreview.errors.length - 8} more issue(s).</small>}</div>}
              {importPreview.questions.length > 0 && <ol className="final-exam-import-question-preview">{importPreview.questions.slice(0, 4).map((question, index) => <li key={`${index}-${question.prompt}`}><strong>{question.prompt}</strong><small>Correct answer: {question.choices.find((choice) => choice.isCorrect)?.text}</small></li>)}</ol>}
              {importPreview.questions.length > 4 && <p className="final-exam-import-hint">Showing 4 of {importPreview.questions.length} questions.</p>}
              <div className="final-exam-import-footer"><Button type="button" variant="secondary" disabled={busyAction !== null || readingImportFile || importPreview.errors.length > 0 || importPreview.questions.length === 0} onClick={() => void importQuestions()}>{importing ? 'Adding questions…' : `Add ${importPreview.questions.length} questions to bank`}</Button></div>
            </div>}
          </section>}
          <div className="final-exam-bank-pagination" aria-live="polite">
            <span>{searchQuery ? `${resultCount} matching ${resultCount === 1 ? 'question' : 'questions'}` : `${formatCountLabel(questionCount, 'question', 'questions')}`}</span>
            {totalPages > 1 && <div><Button type="button" variant="secondary" disabled={page <= 1 || loadingQuestions} onClick={() => setPage((current) => current - 1)}>Previous questions</Button><span>Page {page} of {totalPages}</span><Button type="button" variant="secondary" disabled={page >= totalPages || loadingQuestions} onClick={() => setPage((current) => current + 1)}>More questions</Button></div>}
          </div>
          {unsavedNewQuestions.length > 0 && <div className="final-exam-draft-list"><strong>Unsaved drafts</strong>{unsavedNewQuestions.map((draft) => <button key={finalExamQuestionKey(draft)} type="button" className={`final-exam-question-row${selectedQuestionKey === finalExamQuestionKey(draft) ? ' is-selected' : ''}`} aria-pressed={selectedQuestionKey === finalExamQuestionKey(draft)} onClick={() => { setSelectedQuestionKey(finalExamQuestionKey(draft)); setMobileEditorOpen(true); }}><span className="final-exam-question-number">Draft</span><span className="final-exam-question-summary"><strong>{draft.prompt.trim() || 'New question'}</strong><small>{formatCountLabel(draft.choices.length, 'choice', 'choices')} · Unsaved</small></span></button>)}</div>}
          {loadingQuestions ? <p className="final-exam-bank-status" role="status">Loading question bank…</p> : questions.length ? <ol className="final-exam-question-list" aria-label="Questions on this page">{questions.map((question, questionIndex) => {
            const key = finalExamQuestionKey(question);
            const displayQuestion = questionDrafts[key] ?? question;
            const questionNumber = (page - 1) * pageSize + questionIndex + 1;
            return <li key={key}><button type="button" className={`final-exam-question-row${selectedQuestionKey === key ? ' is-selected' : ''}`} aria-pressed={selectedQuestionKey === key} aria-label={`Edit question ${questionNumber}: ${displayQuestion.prompt || 'Untitled question'}`} onClick={() => { setSelectedQuestionKey(key); setMobileEditorOpen(true); }}><span className="final-exam-question-number">{questionNumber}</span><span className="final-exam-question-summary"><strong>{displayQuestion.prompt.trim() || 'Untitled question'}</strong><small>{formatCountLabel(displayQuestion.choices.length, 'choice', 'choices')}{questionDrafts[key] ? ' · Unsaved changes' : ''}</small></span><span className="final-exam-question-chevron" aria-hidden="true">›</span></button></li>;
          })}</ol> : searchQuery ? <p className="final-exam-bank-status">No questions match “{searchQuery}”. Try another search.</p> : <p className="final-exam-bank-status">No questions yet. Add the first question to build the exam bank.</p>}
          {totalPages > 1 && <div className="final-exam-bank-pagination final-exam-bank-pagination-bottom"><span>{Math.min((page - 1) * pageSize + 1, resultCount)}–{Math.min(page * pageSize, resultCount)} of {resultCount}</span><div><Button type="button" variant="secondary" disabled={page <= 1 || loadingQuestions} onClick={() => setPage((current) => current - 1)}>Previous questions</Button><Button type="button" variant="secondary" disabled={page >= totalPages || loadingQuestions} onClick={() => setPage((current) => current + 1)}>More questions</Button></div></div>}
        </section>
        <section className="final-exam-question-editor-pane" aria-label="Selected final exam question" aria-busy={busyAction !== null}>
          {activeQuestion && selectedQuestionKey ? <>
            <div className="final-exam-active-question-heading">
              <button type="button" className="final-exam-back-to-bank" onClick={() => setMobileEditorOpen(false)}><ArrowLeft size={16} aria-hidden="true" />Questions</button>
              <div><span className="editor-type">{activeQuestion.id ? 'Question bank' : 'New question'}</span><h5>{activeQuestion.id ? `Question ${activeQuestion.position + 1}` : 'Add question'}</h5></div>
              {activeQuestion.id
                ? <button type="button" className="icon-button danger-icon" aria-label={`Remove question ${activeQuestion.position + 1}`} disabled={busyAction !== null} onClick={() => setPendingDelete({ id: activeQuestion.id!, title: activeQuestion.prompt || `Question ${activeQuestion.position + 1}` })}><Trash2 size={16} aria-hidden="true" /></button>
                : <button type="button" className="text-action danger-text" disabled={busyAction !== null} onClick={() => { setQuestionDrafts((current) => { const next = { ...current }; delete next[selectedQuestionKey]; return next; }); setSelectedQuestionKey(questions[0]?.id ?? null); setMobileEditorOpen(false); }}>Discard draft</button>}
            </div>
            <div className="final-exam-question-editor">
              <label className="final-exam-question-prompt">Question prompt<textarea rows={3} maxLength={1000} placeholder="Write a question" aria-label={`Final exam question ${activeQuestion.position + 1}`} value={activeQuestion.prompt} disabled={busyAction !== null} onChange={(event) => updateActiveQuestion({ prompt: event.target.value })} /></label>
              <fieldset className="quiz-answer-fieldset final-exam-answer-fieldset" disabled={busyAction !== null}><legend>Answer choices</legend><p className="form-hint">Select one correct answer. Each question needs two to six answer choices.</p>
                {activeQuestion.choices.map((choice, choiceIndex) => <div className="choice-editor-row" key={choice.id || choice.editorKey}><input type="radio" name={`final-exam-correct-${selectedQuestionKey}`} checked={choice.isCorrect} onChange={() => updateActiveChoice(choiceIndex, { isCorrect: true })} aria-label={`Mark answer choice ${choiceIndex + 1} correct`} /><input value={choice.text} maxLength={500} onChange={(event) => updateActiveChoice(choiceIndex, { text: event.target.value })} aria-label={`Answer choice ${choiceIndex + 1}`} placeholder={`Answer ${choiceIndex + 1}`} /><button type="button" className="icon-button danger-icon" aria-label={`Remove answer choice ${choiceIndex + 1}`} disabled={busyAction !== null || activeQuestion.choices.length <= 2} onClick={() => updateActiveQuestion({ choices: activeQuestion.choices.filter((_, index) => index !== choiceIndex) })}><Trash2 size={15} aria-hidden="true" /></button></div>)}
                {activeQuestion.choices.length < 6 && <button type="button" className="text-action add-choice" disabled={busyAction !== null} onClick={() => updateActiveQuestion({ choices: [...activeQuestion.choices, { editorKey: `${selectedQuestionKey}-choice-${activeQuestion.choices.length + 1}`, text: '', isCorrect: false }] })}><Plus size={15} aria-hidden="true" />Add answer choice</button>}
              </fieldset>
              <label className="explanation-label final-exam-explanation">Explanation (optional)<textarea rows={3} maxLength={1000} value={activeQuestion.explanation} disabled={busyAction !== null} onChange={(event) => updateActiveQuestion({ explanation: event.target.value })} /></label>
              <div className="final-exam-question-actions">
                {!activeQuestion.id && <Button type="button" variant="secondary" disabled={busyAction !== null || !activeQuestionIsDirty} onClick={() => void saveQuestion(true)}>Save &amp; add another</Button>}
                <Button type="button" variant="secondary" disabled={busyAction !== null || !activeQuestionIsDirty} onClick={() => void saveQuestion()}>{busyAction === selectedQuestionKey ? 'Saving question…' : activeQuestion.id ? activeQuestionIsDirty ? 'Save question' : 'No changes' : 'Add question to bank'}</Button>
              </div>
            </div>
          </> : <div className="final-exam-question-empty"><h5>Choose a question</h5><p>Select a question from the bank or add a new one.</p></div>}
        </section>
      </div>
    </>}
    {confirmExamRemoval && exam && <ConfirmationDialog title="Remove the final exam?" description="This removes its entire question bank and all saved exam attempts. This action cannot be undone." confirmLabel="Remove final exam" onCancel={() => setConfirmExamRemoval(false)} onConfirm={() => void removeExam()} />}
    {pendingDelete && <ConfirmationDialog title={`Remove “${pendingDelete.title}”?`} description="This removes the question from the final exam bank. Saved past attempt snapshots remain available." confirmLabel="Remove question" onCancel={() => setPendingDelete(null)} onConfirm={() => void removeQuestion(pendingDelete.id)} />}
  </section>;
}

function LessonDetailsEditor({ lesson, courseId, beforeChange, onChanged, onClose, onError, onNotice }: {
  lesson: Lesson;
  courseId: string;
  beforeChange: () => Promise<void>;
  onChanged: () => Promise<boolean>;
  onClose: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const { maxUploadBytes } = useAuth();
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
  const [pendingRemoval, setPendingRemoval] = useState<
    | { kind: 'resource'; courseId: string; lessonId: string; id: string; title: string; resourceKind: LessonResource['kind'] }
    | { kind: 'caption'; courseId: string; lessonId: string; id: string; label: string; language: string }
    | null
  >(null);
  const removalRequestRef = useRef(false);
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
    setPendingRemoval(null);
  }, [courseId, lesson.id, lesson.title, lesson.description, lesson.transcript, lesson.resources, lesson.captions]);
  useEffect(() => () => { uploadControllerRef.current?.controller.abort(); }, [lesson.id]);

  async function persistLessonDetails() {
    const cleanTitle = title.trim();
    if (!cleanTitle) throw new ApiError(400, 'Lesson title is required.');
    await beforeChange();
    await api.patch(`/api/manage/lessons/${lesson.id}`, { title: cleanTitle, description, transcript });
    setTitle(cleanTitle);
  }

  // Lesson mutations commit before the course refresh; keep feedback truthful if that follow-up read fails.
  async function completeLessonChange(successMessage: string) {
    if (await onChanged()) {
      onNotice(successMessage);
      return;
    }
    onError(`${successMessage} The course editor could not be refreshed. Reload before making another change.`);
  }

  async function saveDetails(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); onError('');
    try {
      await persistLessonDetails();
      await completeLessonChange('Lesson details saved.');
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
      setLinkTitle(''); setLinkUrl('');
      await completeLessonChange('Lesson link added.');
    } catch (cause) { onError(cause instanceof ApiError ? cause.message : 'Lesson link could not be added.'); }
    finally { setBusy(false); }
  }

  async function uploadDocument(file: File, input: HTMLInputElement) {
    const fileSizeError = uploadSizeError(file.size, maxUploadBytes);
    if (fileSizeError) {
      onError(fileSizeError);
      input.focus();
      return;
    }
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
      if (!upload.controller.signal.aborted) await completeLessonChange(`${file.name} attached to this lesson.`);
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
      setCaptionFile(null);
      setCaptionLanguage('');
      setCaptionLabel('');
      if (input) input.value = '';
      if (!upload.controller.signal.aborted) await completeLessonChange(`${caption.label} captions uploaded.`);
    } catch (cause) {
      if (!upload.controller.signal.aborted) onError(cause instanceof ApiError ? cause.message : 'Captions could not be uploaded.');
    } finally {
      if (uploadControllerRef.current === upload) uploadControllerRef.current = null;
      setBusy(false); setUploadKind(null); setUploadProgress(null);
      if (upload.cancelledByUser) requestAnimationFrame(() => { if (upload.input.isConnected) upload.input.focus(); });
    }
  }

  function requestResourceRemoval(resource: LessonResource) {
    if (busy || removalRequestRef.current) return;
    setPendingRemoval({ kind: 'resource', courseId, lessonId: lesson.id, id: resource.id, title: resource.title, resourceKind: resource.kind });
  }

  async function removeResource(resource: LessonResource) {
    if (busy || removalRequestRef.current) return;
    removalRequestRef.current = true;
    setBusy(true); onError('');
    try {
      await persistLessonDetails();
      await api.delete(`/api/manage/lessons/${lesson.id}/resources/${resource.id}`);
      setResources((current) => current.filter((item) => item.id !== resource.id));
      await completeLessonChange('Lesson resource removed.');
    } catch (cause) { onError(cause instanceof ApiError ? cause.message : 'Lesson resource could not be removed.'); }
    finally { removalRequestRef.current = false; setBusy(false); }
  }

  function requestCaptionRemoval(caption: LessonCaption) {
    if (busy || removalRequestRef.current) return;
    setPendingRemoval({ kind: 'caption', courseId, lessonId: lesson.id, id: caption.id, label: caption.label, language: caption.language });
  }

  async function removeCaption(caption: LessonCaption) {
    if (busy || removalRequestRef.current) return;
    removalRequestRef.current = true;
    setBusy(true); onError('');
    try {
      await persistLessonDetails();
      await api.delete(`/api/manage/lessons/${lesson.id}/captions/${caption.id}`);
      setCaptions((current) => current.filter((item) => item.id !== caption.id));
      await completeLessonChange('Caption track removed.');
    } catch (cause) { onError(cause instanceof ApiError ? cause.message : 'Caption track could not be removed.'); }
    finally { removalRequestRef.current = false; setBusy(false); }
  }

  function confirmPendingRemoval() {
    const pending = pendingRemoval;
    setPendingRemoval(null);
    if (!pending || pending.courseId !== courseId || pending.lessonId !== lesson.id) return;
    if (pending.kind === 'resource') {
      const resource = resources.find((item) => item.id === pending.id);
      if (resource) void removeResource(resource);
      return;
    }
    const caption = captions.find((item) => item.id === pending.id);
    if (caption) void removeCaption(caption);
  }

  return <section id={`lesson-details-${lesson.id}`} className="lesson-details-editor" aria-labelledby={`lesson-details-heading-${lesson.id}`} aria-busy={busy}>
    <div className="lesson-details-heading"><div><h3 id={`lesson-details-heading-${lesson.id}`}>Lesson details</h3><span>Set what learners will see for this lesson.</span></div><button type="button" className="text-action" onClick={onClose} disabled={busy}>Close</button></div>
    <form className="lesson-details-form" onSubmit={saveDetails}>
      <div className="lesson-details-grid">
        {/* Keep required cues decorative so native validation remains the accessible source of truth. */}
        <label><span className="form-label-row"><span>Lesson title</span><small className="form-required-indicator" aria-hidden="true">Required</small></span><input value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} required disabled={busy} /></label>
        <label>Lesson description
          <textarea id={`lesson-description-${lesson.id}`} aria-describedby={`lesson-description-count-${lesson.id}`} value={description} maxLength={2000} rows={3} onChange={(event) => setDescription(event.target.value)} placeholder="Add context, learning goals, or notes for this lesson." disabled={busy} />
          <small id={`lesson-description-count-${lesson.id}`} className="field-character-count">{description.length} / 2,000 characters</small>
        </label>
        <label className="lesson-transcript-field">Lesson transcript<textarea value={transcript} maxLength={50000} rows={7} aria-describedby={`lesson-transcript-help-${lesson.id}`} onChange={(event) => setTranscript(event.target.value)} placeholder="Paste the spoken words and meaningful audio cues from this lesson." disabled={busy} /><small id={`lesson-transcript-help-${lesson.id}`}>Optional plain text that learners can expand in the lesson player. {transcript.length}/50,000 characters.</small></label>
      </div>
      <div className="lesson-details-save"><Button type="submit" variant="secondary" disabled={busy}>{busy ? 'Saving…' : 'Save lesson details'}</Button></div>
    </form>

    <section className="lesson-resource-editor" aria-labelledby={`lesson-resource-heading-${lesson.id}`}>
      <div className="lesson-resource-heading"><div><h4 id={`lesson-resource-heading-${lesson.id}`}>Links and documents</h4><span>These resources will be available to learners alongside the lesson.</span></div></div>
      {resources.length ? <ul className="lesson-resource-list">{resources.map((resource) => <li className="lesson-resource-row" key={resource.id}>
        {resource.kind === 'link' ? <Link2 size={16} aria-hidden="true" /> : <FileText size={16} aria-hidden="true" />}
        <div><strong>{resource.title}</strong><small>{resource.kind === 'document' ? resource.fileName : resource.url}</small></div>
        <button type="button" className="icon-button danger-icon" title={`Remove ${resource.title}`} aria-label={`Remove ${resource.title}`} disabled={busy} onClick={() => requestResourceRemoval(resource)}><Trash2 size={15} aria-hidden="true" /></button>
      </li>)}</ul> : <p className="lesson-resource-empty">No resources added yet.</p>}
      <form className="lesson-link-form" onSubmit={addLink}>
        <label><span className="form-label-row"><span>Link title</span><small className="form-required-indicator" aria-hidden="true">Required</small></span><input value={linkTitle} maxLength={160} onChange={(event) => setLinkTitle(event.target.value)} placeholder="e.g. Reference guide" required disabled={busy} /></label>
        <label><span className="form-label-row"><span>Link URL</span><small className="form-required-indicator" aria-hidden="true">Required</small></span><input ref={linkUrlInputRef} type="url" value={linkUrl} maxLength={2048} aria-invalid={linkUrlError ? true : undefined} aria-describedby={linkUrlError ? `lesson-link-url-help-${lesson.id} lesson-link-url-error-${lesson.id}` : `lesson-link-url-help-${lesson.id}`} onChange={(event) => { setLinkUrl(event.target.value); setLinkUrlError(''); }} placeholder="https://example.com/resource" required disabled={busy} /></label>
        <Button type="submit" variant="secondary" disabled={busy || !linkTitle.trim() || !linkUrl.trim()}><Link2 size={15} aria-hidden="true" />Add link</Button>
      </form>
      <small id={`lesson-link-url-help-${lesson.id}`} className="caption-language-help lesson-link-help">Use HTTP or HTTPS without a username or password.</small>
      {linkUrlError && <div id={`lesson-link-url-error-${lesson.id}`} className="inline-notice caption-form-error" role="alert">{linkUrlError}</div>}
      <div className="lesson-document-upload">
        <div><strong>Attach a document</strong><span id={documentFormatHelpId}>PDF, TXT, Markdown, RTF, Word, PowerPoint, Excel, CSV/TSV, or OpenDocument.</span></div>
        <label className="button button-secondary file-button"><Upload size={15} aria-hidden="true" />Choose document<input type="file" accept=".pdf,.txt,.md,.rtf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.tsv,.odt,.odp,.ods" aria-describedby={documentFormatHelpId} disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadDocument(file, event.currentTarget); event.currentTarget.value = ''; }} /></label>
        {uploadKind === 'document' && uploadProgress !== null && (uploadProgress >= 100 ? <div className="upload-progress upload-progress-saving lesson-document-progress" role="status">Saving document…</div> : <div className="upload-progress lesson-document-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploadProgress} aria-label="Lesson document upload progress"><span style={{ width: `${uploadProgress}%` }} /><small>{uploadProgress}%</small></div>)}
        {uploadKind === 'document' && uploadProgress !== null && uploadProgress < 100 && <button type="button" className="text-action upload-cancel-action" aria-label="Cancel document upload" onClick={cancelUpload}>Cancel upload</button>}
      </div>
      <section className="lesson-caption-editor" aria-labelledby={`lesson-caption-heading-${lesson.id}`}>
        <div className="lesson-resource-heading"><div><h4 id={`lesson-caption-heading-${lesson.id}`}>Video captions</h4><span>Upload WebVTT subtitle tracks. Learners can choose a language in the video controls.</span></div></div>
        {captions.length ? <ul className="lesson-resource-list">{captions.map((caption) => <li className="lesson-resource-row" key={caption.id}>
          <FileText size={16} aria-hidden="true" />
          <div><strong>{caption.label} <span className="caption-language">({caption.language})</span></strong><small>{caption.fileName}</small></div>
          <button type="button" className="icon-button danger-icon" title={`Remove ${caption.label} captions`} aria-label={`Remove ${caption.label} captions (${caption.language})`} disabled={busy} onClick={() => requestCaptionRemoval(caption)}><Trash2 size={15} aria-hidden="true" /></button>
        </li>)}</ul> : <p className="lesson-resource-empty">No caption tracks added yet.</p>}
        <form className="lesson-caption-form" onSubmit={uploadCaptions}>
          <label><span className="form-label-row"><span>Language tag</span><small className="form-required-indicator" aria-hidden="true">Required</small></span><input ref={captionLanguageInputRef} type="text" value={captionLanguage} maxLength={35} aria-invalid={captionLanguageError ? true : undefined} aria-describedby={captionLanguageError ? `caption-language-help-${lesson.id} caption-language-error-${lesson.id}` : `caption-language-help-${lesson.id}`} onChange={(event) => { setCaptionLanguage(event.target.value); setCaptionLanguageError(''); }} placeholder="en or en-GB" autoCapitalize="off" spellCheck={false} required disabled={busy} /></label>
          <label><span className="form-label-row"><span>Track label</span><small className="form-required-indicator" aria-hidden="true">Required</small></span><input type="text" value={captionLabel} maxLength={80} onChange={(event) => setCaptionLabel(event.target.value)} placeholder="English" required disabled={busy} /></label>
          <label className="caption-file-label"><span className="form-label-row"><span>WebVTT file</span><small className="form-required-indicator" aria-hidden="true">Required</small></span><span className="caption-file-control"><span className="caption-file-button"><Upload size={14} aria-hidden="true" />Choose file</span><span className="caption-file-name" title={captionFile?.name || 'No file selected'}>{captionFile?.name || 'No file selected'}</span><input ref={captionInputRef} type="file" accept=".vtt,text/vtt" aria-invalid={captionFileError ? true : undefined} aria-describedby={captionFileError ? `caption-file-help-${lesson.id} caption-file-error-${lesson.id}` : `caption-file-help-${lesson.id}`} onChange={(event) => {
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
          <Button type="submit" variant="secondary" disabled={busy || !captionFile || !captionLanguage.trim() || !captionLabel.trim()}><Upload size={15} aria-hidden="true" />Upload captions</Button>
        </form>
        <small id={`caption-language-help-${lesson.id}`} className="caption-language-help lesson-caption-language-help">Use a tag such as en or en-GB.</small>
        <p id={`caption-file-help-${lesson.id}`} className="caption-upload-hint">One track per language; uploading that language again replaces the existing file. Maximum size: 5 MB.</p>
        {captionLanguageError && <div id={`caption-language-error-${lesson.id}`} className="inline-notice caption-form-error" role="alert">{captionLanguageError}</div>}
        {captionFileError && <div id={`caption-file-error-${lesson.id}`} className="inline-notice caption-form-error" role="alert">{captionFileError}</div>}
        {uploadKind === 'captions' && uploadProgress !== null && (uploadProgress >= 100 ? <div className="upload-progress upload-progress-saving lesson-caption-progress" role="status">Saving captions…</div> : <div className="upload-progress lesson-caption-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploadProgress} aria-label="Caption upload progress"><span style={{ width: `${uploadProgress}%` }} /><small>{uploadProgress}%</small></div>)}
        {uploadKind === 'captions' && uploadProgress !== null && uploadProgress < 100 && <button type="button" className="text-action upload-cancel-action" aria-label="Cancel captions upload" onClick={cancelUpload}>Cancel upload</button>}
      </section>
    </section>
    {pendingRemoval?.courseId === courseId && pendingRemoval.lessonId === lesson.id && <ConfirmationDialog
      title={pendingRemoval.kind === 'resource' ? `Remove “${pendingRemoval.title}”?` : `Remove “${pendingRemoval.label}” captions?`}
      description={pendingRemoval.kind === 'resource'
        ? pendingRemoval.resourceKind === 'document'
          ? 'This removes the document from the lesson and deletes its uploaded file. This action cannot be undone.'
          : 'This removes the link from the lesson. This action cannot be undone.'
        : `This removes the ${pendingRemoval.language} caption track and its uploaded file. This action cannot be undone.`}
      confirmLabel={pendingRemoval.kind === 'resource' ? pendingRemoval.resourceKind === 'document' ? 'Remove document' : 'Remove link' : 'Remove captions'}
      onCancel={() => setPendingRemoval(null)}
      onConfirm={confirmPendingRemoval}
    />}
  </section>;
}

export function CourseEditorPage() {
  const route = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user: editorUser, maxUploadBytes } = useAuth();
  const coverHelpId = useId();
  const courseTitleInputRef = useRef<HTMLInputElement>(null);
  const courseCategoryInputRef = useRef<HTMLInputElement>(null);
  const completionWindowInputRef = useRef<HTMLInputElement>(null);
  const createCourseRequestRef = useRef<Promise<{ course: Course }> | null>(null);
  const courseLoadSequenceRef = useRef(0);
  const governanceLoadSequenceRef = useRef(0);
  const courseLoadControllerRef = useRef<AbortController | null>(null);
  const governanceLoadControllerRef = useRef<AbortController | null>(null);
  const versionHistoryLoadControllerRef = useRef<AbortController | null>(null);
  const routeCourseIdRef = useRef(route.courseId || '');
  routeCourseIdRef.current = route.courseId || '';
  const isNewCourseDraft = isCourseCreationEditorState(location.state, route.courseId);
  const [courseId, setCourseId] = useState(route.courseId || '');
  const [course, setCourse] = useState<Course | null>(null);
  const [title, setTitle] = useState('Untitled course');
  const [courseTitleError, setCourseTitleError] = useState('');
  const [courseCategoryError, setCourseCategoryError] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('General');
  const [visibility, setVisibility] = useState<Course['visibility']>('public');
  const [completionWindowDays, setCompletionWindowDays] = useState('');
  const completionWindow = validateCompletionWindowDays(completionWindowDays);
  const [requiresRecompletion, setRequiresRecompletion] = useState(false);
  const [changeNote, setChangeNote] = useState('');
  const [versions, setVersions] = useState<CourseVersion[]>([]);
  const [currentVersion, setCurrentVersion] = useState<CourseVersion | null>(null);
  const [pendingRestoreVersion, setPendingRestoreVersion] = useState<{ courseId: string; versionId: string; versionNumber: number } | null>(null);
  const [versionPage, setVersionPage] = useState(1);
  const [versionPageSize, setVersionPageSize] = useState(20);
  const [versionTotal, setVersionTotal] = useState(0);
  const [versionHistoryLoading, setVersionHistoryLoading] = useState(false);
  const [versionHistoryError, setVersionHistoryError] = useState('');
  const [review, setReview] = useState<{ status: string; author: string | null; submittedBy: string | null; submittedByName: string | null; submittedAt: string | null; reviewedBy: string | null; reviewNote: string } | null>(null);
  const [showChangeRequestForm, setShowChangeRequestForm] = useState(false);
  const [changeRequestNote, setChangeRequestNote] = useState('');
  const [changeRequestNoteError, setChangeRequestNoteError] = useState('');
  const [savingReviewDecision, setSavingReviewDecision] = useState(false);
  const reviewDecisionRequestRef = useRef(false);
  const changeRequestNoteInputRef = useRef<HTMLTextAreaElement>(null);
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
  const [pendingDeleteCourseId, setPendingDeleteCourseId] = useState<string | null>(null);
  const [pendingDeleteModule, setPendingDeleteModule] = useState<{ courseId: string; module: CourseModule } | null>(null);
  const [pendingDeleteLesson, setPendingDeleteLesson] = useState<{ courseId: string; moduleId: string; lessonId: string; title: string } | null>(null);
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
  const [editingModuleTitle, setEditingModuleTitle] = useState<{ courseId: string; moduleId: string; title: string } | null>(null);
  const [savingModuleTitleId, setSavingModuleTitleId] = useState('');
  const moduleTitleSaveRequestRef = useRef(false);
  const moduleTitleButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingModuleTitleFocusRef = useRef('');
  const [addingLessonModuleIds, setAddingLessonModuleIds] = useState<Set<string>>(() => new Set());
  const addingLessonModuleIdsRef = useRef(addingLessonModuleIds);
  const [addingQuizModuleIds, setAddingQuizModuleIds] = useState<Set<string>>(() => new Set());
  const addingQuizModuleIdsRef = useRef(addingQuizModuleIds);
  const quizTitleInputRefs = useRef(new Map<string, HTMLInputElement>());
  const quizAddButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingQuizTitleFocusRef = useRef('');
  const pendingQuizTriggerFocusRef = useRef('');
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
  const skipCourseNavigationPromptRef = useRef(false);
  const shouldBlockCourseNavigation = useCallback<BlockerFunction>(({ currentLocation, nextLocation }) => {
    const locationChanged = currentLocation.pathname !== nextLocation.pathname
      || currentLocation.search !== nextLocation.search
      || currentLocation.hash !== nextLocation.hash;
    return locationChanged && !skipCourseNavigationPromptRef.current && (courseDetailsChanged || saving);
  }, [courseDetailsChanged, saving]);
  const navigationBlocker = useBlocker(shouldBlockCourseNavigation);

  const preventUnsavedCourseExit = useCallback((event: BeforeUnloadEvent) => {
    if (!courseDetailsChanged && !saving) return;
    event.preventDefault();
    event.returnValue = '';
  }, [courseDetailsChanged, saving]);
  useBeforeUnload(preventUnsavedCourseExit);

  useEffect(() => {
    // A save can finish while navigation is waiting; follow that route once no edits remain.
    if (navigationBlocker.state === 'blocked' && !courseDetailsChanged && !saving) navigationBlocker.proceed();
  }, [navigationBlocker, courseDetailsChanged, saving]);

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

  async function load(id = courseId): Promise<boolean> {
    if (!id || routeCourseIdRef.current !== id) return false;
    const previousCourse = course?.id === id ? course : null;
    const requestSequence = ++courseLoadSequenceRef.current;
    courseLoadControllerRef.current?.abort();
    const controller = new AbortController();
    courseLoadControllerRef.current = controller;
    const isCurrentRequest = () => requestSequence === courseLoadSequenceRef.current && routeCourseIdRef.current === id;
    abortGovernanceLoad();
    setGovernanceCourseId(''); setGovernanceError(''); setCompetencyMappingError(''); setCompetencyMappingNotice(''); setGovernanceLoading(true);
    try {
      const response = await fetchCourse(id, true, { signal: controller.signal });
      if (!isCurrentRequest()) return false;
      setCourse(response.course);
      void loadGovernance(id, isCurrentRequest).catch((cause) => {
        if (isCurrentRequest()) setError(cause instanceof ApiError ? cause.message : 'Course settings could not be loaded.');
      });
      if (!previousCourse) {
        setCompletionWindowDays(response.course.completionWindowDays ? String(response.course.completionWindowDays) : '');
        setTitle(response.course.title); setDescription(response.course.description); setCategory(response.course.category); setVisibility(response.course.visibility);
      } else {
        setCompletionWindowDays((current) => current === String(previousCourse.completionWindowDays ?? '') ? String(response.course.completionWindowDays ?? '') : current);
        setTitle((current) => current === previousCourse.title ? response.course.title : current);
        setDescription((current) => current === previousCourse.description ? response.course.description : current);
        setCategory((current) => current === previousCourse.category ? response.course.category : current);
        setVisibility((current) => current === previousCourse.visibility ? response.course.visibility : current);
      }
      return true;
    } catch (cause) {
      if (isCurrentRequest()) {
        setError(cause instanceof ApiError ? cause.message : 'Course could not be loaded.');
        setGovernanceLoading(false);
      }
      return false;
    } finally {
      if (isCurrentRequest()) {
        courseLoadControllerRef.current = null;
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    let active = true;
    setModuleTitle(''); setAddingModule(false); addModuleInvokerRef.current = null;
    pendingQuizTitleFocusRef.current = '';
    pendingQuizTriggerFocusRef.current = '';
    addingQuizModuleIdsRef.current = new Set(); setAddingQuizModuleIds(new Set());
    setPendingDeleteCourseId(null);
    setPendingDeleteModule(null);
    setPendingDeleteLesson(null);
    setPendingRestoreVersion(null);
    setEditingModuleTitle(null); setSavingModuleTitleId(''); pendingModuleTitleFocusRef.current = '';
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
      setShowChangeRequestForm(false); setChangeRequestNote(''); setChangeRequestNoteError('');
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
        // Keep the create-flow context when replacing /new with the saved draft's editor route.
        navigate(`/manage/courses/${response.course.id}/edit`, { replace: true, state: { createdCourseId: response.course.id } });
        setCourse(response.course); setTitle(response.course.title); setDescription(response.course.description); setCategory(response.course.category); setVisibility(response.course.visibility); setCompletionWindowDays(response.course.completionWindowDays ? String(response.course.completionWindowDays) : '');
      }).catch((cause) => {
        if (active) setError(cause instanceof ApiError ? cause.message : 'Course could not be created.');
      }).finally(() => {
        if (createCourseRequestRef.current === createRequest) createCourseRequestRef.current = null;
        if (active) setLoading(false);
      });
    return () => { active = false; courseLoadSequenceRef.current += 1; abortGovernanceLoad(); courseLoadControllerRef.current?.abort(); abortActiveUploads(); };
  }, [route.courseId]);

  // Preserve the rename trigger as a focus target while the successful save reloads the course.
  useEffect(() => {
    if (editingModuleTitle || !pendingModuleTitleFocusRef.current) return;
    const button = moduleTitleButtonRefs.current.get(pendingModuleTitleFocusRef.current);
    if (!button) return;
    pendingModuleTitleFocusRef.current = '';
    button.focus();
  }, [editingModuleTitle, course, loading]);

  useEffect(() => {
    const moduleId = pendingQuizTitleFocusRef.current;
    if (!moduleId) return;
    if (!course?.modules?.some((module) => module.id === moduleId && module.quiz)) {
      if (!loading) pendingQuizTitleFocusRef.current = '';
      return;
    }
    const titleInput = quizTitleInputRefs.current.get(moduleId);
    if (!titleInput) return;
    pendingQuizTitleFocusRef.current = '';
    titleInput.focus();
  }, [course, loading]);

  useEffect(() => {
    const moduleId = pendingQuizTriggerFocusRef.current;
    if (!moduleId || addingQuizModuleIds.has(moduleId)) return;
    const trigger = quizAddButtonRefs.current.get(moduleId);
    if (!trigger || trigger.disabled) return;
    pendingQuizTriggerFocusRef.current = '';
    trigger.focus();
  }, [addingQuizModuleIds]);

  function validatedCourseTitleForSave() {
    // Course details save from toolbar and curriculum actions, so these paths cannot rely on native form validation.
    const validation = validateCourseTitle(title);
    if (validation.error) {
      setCourseTitleError(validation.error);
      window.requestAnimationFrame(() => courseTitleInputRef.current?.focus());
      throw new ApiError(400, validation.error, 'validation_error');
    }
    setCourseTitleError('');
    return validation.value;
  }

  function validatedCourseCategoryForSave() {
    // Category is required on the server even though the editor saves outside a native form submission.
    const validation = validateCourseCategory(category);
    if (validation.error) {
      setCourseCategoryError(validation.error);
      window.requestAnimationFrame(() => courseCategoryInputRef.current?.focus());
      throw new ApiError(400, validation.error, 'validation_error');
    }
    setCourseCategoryError('');
    return validation.value;
  }

  function syncCourseDetailsAfterSave(savedCourse: Course, submitted: {
    title: string;
    description: string;
    category: string;
    visibility: Course['visibility'];
    completionWindowDays: string;
  }) {
    setCourse(savedCourse);
    // Apply server-normalized values only when the author has not changed that field during the request.
    setTitle((current) => current === submitted.title ? savedCourse.title : current);
    setDescription((current) => current === submitted.description ? savedCourse.description : current);
    setCategory((current) => current === submitted.category ? savedCourse.category : current);
    setVisibility((current) => current === submitted.visibility ? savedCourse.visibility : current);
    const savedCompletionWindowDays = savedCourse.completionWindowDays ? String(savedCourse.completionWindowDays) : '';
    setCompletionWindowDays((current) => current === submitted.completionWindowDays ? savedCompletionWindowDays : current);
  }

  function showCourseTitleApiError(cause: unknown) {
    if (!(cause instanceof ApiError) || cause.code !== 'validation_error'
      || ![COURSE_TITLE_REQUIRED_ERROR, COURSE_TITLE_TOO_LONG_ERROR].includes(cause.message)) return;
    setCourseTitleError(cause.message);
    window.requestAnimationFrame(() => courseTitleInputRef.current?.focus());
  }

  function showCourseCategoryApiError(cause: unknown) {
    if (!(cause instanceof ApiError) || cause.code !== 'validation_error'
      || ![COURSE_CATEGORY_REQUIRED_ERROR, COURSE_CATEGORY_TOO_LONG_ERROR].includes(cause.message)) return;
    setCourseCategoryError(cause.message);
    window.requestAnimationFrame(() => courseCategoryInputRef.current?.focus());
  }

  async function saveCourse(status: 'draft' | 'published') {
    if (!courseId) return;
    const requestedCourseId = courseId;
    const requestSequence = ++courseLoadSequenceRef.current;
    courseLoadControllerRef.current?.abort();
    setSavingStatus(status); setError(''); setNotice('');
    let courseSaved = false;
    try {
      const validatedTitle = validatedCourseTitleForSave();
      const validatedCategory = validatedCourseCategoryForSave();
      if (completionWindow.error) {
        completionWindowInputRef.current?.focus();
        throw new ApiError(400, completionWindow.error, 'validation_error');
      }
      const submittedDetails = { title, description, category, visibility, completionWindowDays };
      const response = await api.patch<{ course: Course }>(`/api/manage/courses/${requestedCourseId}`, {
        title: validatedTitle, description, category: validatedCategory, visibility,
        completionWindowDays: completionWindow.value,
        ...(status ? { status } : {}),
      ...(status === 'published' ? { requiresRecompletion, changeNote } : {}),
      });
      if (routeCourseIdRef.current !== requestedCourseId || requestSequence !== courseLoadSequenceRef.current) return;
      courseSaved = true;
      syncCourseDetailsAfterSave(response.course, submittedDetails);
      setNotice(status === 'published' ? coursePublishedNotice(response.course.visibility) : status === 'draft' ? 'Draft saved.' : 'Course details saved.');
      if (status === 'published') { setRequiresRecompletion(false); setChangeNote(''); await loadGovernance(requestedCourseId); }
    } catch (cause) {
      showCourseTitleApiError(cause);
      showCourseCategoryApiError(cause);
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
    const validatedTitle = validatedCourseTitleForSave();
    const validatedCategory = validatedCourseCategoryForSave();
    if (completionWindow.error) {
      completionWindowInputRef.current?.focus();
      throw new ApiError(400, completionWindow.error, 'validation_error');
    }
    const submittedDetails = { title, description, category, visibility, completionWindowDays };
    if (validatedTitle === course.title && description === course.description && validatedCategory === course.category && visibility === course.visibility
      && (completionWindowDays ? Number(completionWindowDays) : null) === (course.completionWindowDays ?? null)) {
      syncCourseDetailsAfterSave(course, submittedDetails);
      return;
    }
    try {
      const response = await api.patch<{ course: Course }>(`/api/manage/courses/${courseId}`, {
        title: validatedTitle, description, category: validatedCategory, visibility,
        completionWindowDays: completionWindow.value,
      });
      syncCourseDetailsAfterSave(response.course, submittedDetails);
    } catch (cause) {
      showCourseTitleApiError(cause);
      showCourseCategoryApiError(cause);
      throw cause;
    }
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
      // Native required validation accepts whitespace, so connect this error to the note field.
      setChangeRequestNoteError('Describe the changes the editor should make.');
      setError('');
      changeRequestNoteInputRef.current?.focus();
      return;
    }
    setChangeRequestNoteError('');
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
      if (decision === 'changes_requested') { setShowChangeRequestForm(false); setChangeRequestNote(''); setChangeRequestNoteError(''); }
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

  function requestRestoreVersion(version: CourseVersion) {
    const requestedCourseId = courseId;
    if (!requestedCourseId) return;
    const requestKey = `${requestedCourseId}:${version.id}`;
    if (restoreVersionRequestsRef.current.has(requestKey)) return;
    setPendingRestoreVersion({ courseId: requestedCourseId, versionId: version.id, versionNumber: version.version_number });
  }

  function confirmPendingVersionRestore() {
    const pending = pendingRestoreVersion;
    setPendingRestoreVersion(null);
    if (!pending || pending.courseId !== courseId || pending.courseId !== routeCourseIdRef.current) return;
    const version = versions.find((current) => current.id === pending.versionId);
    if (!version) {
      setError('This course version is no longer available. Reload the version history before restoring it.');
      return;
    }
    void restoreVersion(version, pending.courseId);
  }

  async function restoreVersion(version: CourseVersion, requestedCourseId: string) {
    if (!requestedCourseId || routeCourseIdRef.current !== requestedCourseId) return;
    const requestKey = `${requestedCourseId}:${version.id}`;
    if (restoreVersionRequestsRef.current.has(requestKey)) return;
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

  async function deleteArchivedCourse(confirmed = false) {
    if (deleteCourseRequestRef.current || deleteCurriculumItemRef.current || saving || !course || course.status !== 'archived') return;
    if (!confirmed) { setPendingDeleteCourseId(course.id); return; }
    const requestedCourseId = course.id;
    deleteCourseRequestRef.current = true;
    setDeletingCourse(true);
    setError('');
    try {
      await api.delete(`/api/manage/courses/${requestedCourseId}`);
      if (routeCourseIdRef.current === requestedCourseId) {
        skipCourseNavigationPromptRef.current = true;
        navigate('/manage/courses');
      }
    } catch (cause) {
      if (routeCourseIdRef.current === requestedCourseId) setError(cause instanceof ApiError ? cause.message : 'Course could not be deleted.');
    } finally {
      deleteCourseRequestRef.current = false;
      setDeletingCourse(false);
    }
  }

  async function addModule(event: React.FormEvent) {
    event.preventDefault();
    if (addingModuleRequestRef.current || !moduleTitle.trim() || !courseId) return;
    const requestedCourseId = courseId;
    addingModuleRequestRef.current = true; setAddingModuleBusy(true);
    setError('');
    try {
      await saveCourseDetailsIfChanged();
      if (routeCourseIdRef.current !== requestedCourseId) return;
      await api.post(`/api/manage/courses/${requestedCourseId}/modules`, { title: moduleTitle.trim() });
      if (routeCourseIdRef.current !== requestedCourseId) return;
      setModuleTitle(''); setAddingModule(false); addModuleButtonRef.current?.focus(); await load(requestedCourseId);
    } catch (cause) {
      if (routeCourseIdRef.current === requestedCourseId) setError(cause instanceof ApiError ? cause.message : 'Module could not be added.');
    }
    finally { addingModuleRequestRef.current = false; setAddingModuleBusy(false); }
  }

  async function addLesson(moduleId: string) {
    const requestedCourseId = courseId;
    if (!requestedCourseId || addingLessonModuleIdsRef.current.has(moduleId)) return;
    const pending = new Set(addingLessonModuleIdsRef.current);
    pending.add(moduleId); addingLessonModuleIdsRef.current = pending; setAddingLessonModuleIds(pending);
    setError('');
    try {
      await saveCourseDetailsIfChanged();
      if (routeCourseIdRef.current !== requestedCourseId) return;
      await api.post(`/api/manage/modules/${moduleId}/lessons`, { title: 'New lesson' });
      if (routeCourseIdRef.current === requestedCourseId) await load(requestedCourseId);
    } catch (cause) {
      if (routeCourseIdRef.current === requestedCourseId) setError(cause instanceof ApiError ? cause.message : 'Lesson could not be added.');
    }
    finally {
      const nextPending = new Set(addingLessonModuleIdsRef.current);
      nextPending.delete(moduleId); addingLessonModuleIdsRef.current = nextPending; setAddingLessonModuleIds(nextPending);
    }
  }

  async function addModuleQuiz(module: CourseModule) {
    if (module.quiz || addingQuizModuleIdsRef.current.has(module.id)) return;
    const pending = new Set(addingQuizModuleIdsRef.current);
    pending.add(module.id); addingQuizModuleIdsRef.current = pending; setAddingQuizModuleIds(pending);
    setError('');
    const requestedCourseId = courseId;
    try {
      await saveCourseDetailsIfChanged();
      if (routeCourseIdRef.current !== requestedCourseId) return;
      await api.put(`/api/manage/modules/${module.id}/quiz`, { title: defaultQuizTitle(module.title), passMark: 70, questions: [] });
      if (routeCourseIdRef.current !== requestedCourseId) return;
      pendingQuizTitleFocusRef.current = module.id;
      await load(requestedCourseId);
    } catch (cause) {
      if (routeCourseIdRef.current === requestedCourseId) {
        pendingQuizTriggerFocusRef.current = module.id;
        setError(cause instanceof ApiError ? cause.message : 'Quiz could not be added.');
      }
    }
    finally {
      const nextPending = new Set(addingQuizModuleIdsRef.current);
      nextPending.delete(module.id); addingQuizModuleIdsRef.current = nextPending; setAddingQuizModuleIds(nextPending);
    }
  }

  function startModuleTitleEdit(module: CourseModule) {
    if (!course || loading || saving || deletingCourse || addingModule || addingModuleBusy || isMovingCurriculum
      || deleteCurriculumItemRef.current || moduleTitleSaveRequestRef.current) return;
    pendingModuleTitleFocusRef.current = module.id;
    setEditingModuleTitle({ courseId: course.id, moduleId: module.id, title: module.title });
  }

  function cancelModuleTitleEdit() {
    if (!editingModuleTitle) return;
    pendingModuleTitleFocusRef.current = editingModuleTitle.moduleId;
    setEditingModuleTitle(null);
  }

  async function saveModuleTitle(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const pending = editingModuleTitle;
    if (!pending || !course || moduleTitleSaveRequestRef.current || saving || deletingCourse
      || pending.courseId !== course.id || routeCourseIdRef.current !== pending.courseId) return;
    const module = course.modules?.find((item) => item.id === pending.moduleId);
    if (!module) { setEditingModuleTitle(null); return; }
    const normalizedTitle = pending.title.trim();
    if (!normalizedTitle) { setError('Enter a module title.'); return; }
    if (normalizedTitle.length > 160) { setError('Module title must be 160 characters or fewer.'); return; }
    if (normalizedTitle === module.title) { cancelModuleTitleEdit(); return; }

    moduleTitleSaveRequestRef.current = true;
    setSavingModuleTitleId(module.id); setError('');
    try {
      await saveCourseDetailsIfChanged();
      if (routeCourseIdRef.current !== pending.courseId) return;
      await api.patch(`/api/manage/modules/${module.id}`, { title: normalizedTitle });
      if (routeCourseIdRef.current !== pending.courseId) return;
      setCourse((current) => current?.id === pending.courseId ? {
        ...current,
        modules: current.modules?.map((item) => item.id === module.id ? { ...item, title: normalizedTitle } : item),
      } : current);
      pendingModuleTitleFocusRef.current = module.id;
      setEditingModuleTitle(null);
      await load();
    } catch (cause) {
      if (routeCourseIdRef.current === pending.courseId) setError(cause instanceof ApiError ? cause.message : 'Module could not be updated.');
    } finally {
      moduleTitleSaveRequestRef.current = false;
      setSavingModuleTitleId('');
    }
  }

  async function deleteModule(module: CourseModule, confirmed = false) {
    if (deleteCurriculumItemRef.current || deleteCourseRequestRef.current || saving || !course) return;
    if (!confirmed) { setPendingDeleteModule({ courseId: course.id, module }); return; }
    const requestedCourseId = course.id;
    const target = `module:${module.id}`;
    deleteCurriculumItemRef.current = target; setDeletingCurriculumItem(target); setError('');
    try {
      await saveCourseDetailsIfChanged();
      if (routeCourseIdRef.current !== requestedCourseId) return;
      await api.delete(`/api/manage/modules/${module.id}`);
      if (routeCourseIdRef.current === requestedCourseId) await load(requestedCourseId);
    } catch (cause) {
      if (routeCourseIdRef.current === requestedCourseId) setError(cause instanceof ApiError ? cause.message : 'Module could not be removed.');
    }
    finally { deleteCurriculumItemRef.current = ''; setDeletingCurriculumItem(''); }
  }

  function confirmPendingModuleDeletion() {
    const pending = pendingDeleteModule;
    setPendingDeleteModule(null);
    if (!course || !pending || pending.courseId !== course.id || routeCourseIdRef.current !== pending.courseId) return;
    const currentModule = course.modules?.find((module) => module.id === pending.module.id);
    if (currentModule) void deleteModule(currentModule, true);
  }

  async function deleteLesson(lessonId: string, currentTitle: string, confirmed = false) {
    if (deleteCurriculumItemRef.current || deleteCourseRequestRef.current || saving || !course) return;
    if (!confirmed) {
      const module = course.modules?.find((item) => item.lessons.some((lesson) => lesson.id === lessonId));
      if (module) setPendingDeleteLesson({ courseId: course.id, moduleId: module.id, lessonId, title: currentTitle });
      return;
    }
    const requestedCourseId = course.id;
    const target = `lesson:${lessonId}`;
    deleteCurriculumItemRef.current = target; setDeletingCurriculumItem(target); setError('');
    try {
      await saveCourseDetailsIfChanged();
      if (routeCourseIdRef.current !== requestedCourseId) return;
      await api.delete(`/api/manage/lessons/${lessonId}`);
      if (routeCourseIdRef.current !== requestedCourseId) return;
      setEditingLessonId(''); await load(requestedCourseId);
    } catch (cause) {
      if (routeCourseIdRef.current === requestedCourseId) setError(cause instanceof ApiError ? cause.message : 'Lesson could not be removed.');
    }
    finally { deleteCurriculumItemRef.current = ''; setDeletingCurriculumItem(''); }
  }

  function confirmPendingLessonDeletion() {
    const pending = pendingDeleteLesson;
    setPendingDeleteLesson(null);
    if (!course || !pending || pending.courseId !== course.id || routeCourseIdRef.current !== pending.courseId) return;
    const currentLesson = course.modules?.find((module) => module.id === pending.moduleId)?.lessons.find((lesson) => lesson.id === pending.lessonId);
    if (currentLesson) void deleteLesson(currentLesson.id, currentLesson.title, true);
  }

  function markCurriculumItemMoving(itemKey: string, moving: boolean) {
    const next = new Set(movingCurriculumItemsRef.current);
    if (moving) next.add(itemKey);
    else next.delete(itemKey);
    movingCurriculumItemsRef.current = next;
    setMovingCurriculumItems(next);
  }

  async function moveItem(path: string, direction: 'up' | 'down', itemKey: string) {
    const requestedCourseId = courseId;
    if (!requestedCourseId || movingCurriculumItemsRef.current.size > 0) return;
    markCurriculumItemMoving(itemKey, true);
    setError('');
    try {
      await saveCourseDetailsIfChanged();
      if (routeCourseIdRef.current !== requestedCourseId) return;
      await api.post(path, { direction });
      if (routeCourseIdRef.current === requestedCourseId) await load(requestedCourseId);
    } catch (cause) {
      if (routeCourseIdRef.current === requestedCourseId) setError(cause instanceof ApiError ? cause.message : 'Order could not be updated.');
    }
    finally { markCurriculumItemMoving(itemKey, false); }
  }

  async function uploadVideo(lessonId: string, file: File, input: HTMLInputElement) {
    const fileSizeError = uploadSizeError(file.size, maxUploadBytes);
    if (fileSizeError) {
      setError(fileSizeError);
      input.focus();
      return;
    }
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
    const fileSizeError = uploadSizeError(file.size, maxUploadBytes);
    if (fileSizeError) {
      setError(fileSizeError);
      input.focus();
      return;
    }
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
  if (!course) return <div className="management-page">{error && <Notice>{error}</Notice>}<Link className="back-link" to="/manage/courses"><ArrowLeft size={17} aria-hidden="true" />Back to courses</Link></div>;

  return <div className="editor-page">
    <div className="editor-topbar"><div><div className="breadcrumbs"><Link to="/manage/courses">Courses</Link><span>/</span><span>{isNewCourseDraft ? 'Create course' : 'Edit course'}</span></div><h1>{course.title || 'Edit course'}</h1></div><div className="editor-actions"><CourseStatus status={course.status} /><Link className="button button-secondary" to="/manage/course-groups"><UsersRound size={16} aria-hidden="true" />Groups</Link><Button type="button" variant="secondary" onClick={() => saveCourse('draft')} disabled={saving || (course.status === 'draft' && !courseDetailsChanged)} aria-busy={savingStatus === 'draft'}>{savingStatus === 'draft' ? 'Saving draft…' : course.status === 'draft' && !courseDetailsChanged ? 'Draft saved' : 'Save draft'}</Button><Button type="button" onClick={() => saveCourse('published')} disabled={saving || (review?.status === 'in_review' && review.submittedBy === editorUser?.id)} aria-busy={savingStatus === 'published'}>{savingStatus === 'published' ? 'Publishing…' : 'Publish course'}<span className="sr-only">{course.status === 'published' && !courseDetailsChanged ? ' (recheck course readiness)' : ''}</span></Button>{savingStatus && <span className="sr-only" role="status" aria-live="polite">{savingStatus === 'published' ? 'Publishing course…' : 'Saving draft…'}</span>}</div></div>
    {error && error !== COMPLETION_WINDOW_ERROR && error !== courseTitleError && error !== courseCategoryError && <Notice>{error}</Notice>}{notice && <Notice kind="success">{notice}</Notice>}
    {navigationBlocker.state === 'blocked' && <ConfirmationDialog
      title={saving ? 'Course save in progress' : 'Discard unsaved course details?'}
      description={saving ? 'Wait for the current save to finish before leaving this page.' : 'Your unsaved course details will be lost if you leave this page.'}
      cancelLabel={saving ? 'Stay on page' : 'Keep editing'}
      confirmLabel={saving ? 'Saving…' : 'Discard changes'}
      confirmVariant={saving ? 'secondary' : 'danger'}
      confirmDisabled={saving}
      onCancel={navigationBlocker.reset}
      onConfirm={navigationBlocker.proceed}
    />}
    {/* Keep the live region mounted only while a reorder is in flight so settled editors expose no empty status. */}
    {movingCurriculumItems.size > 0 && <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">Updating course content order…</p>}
    <p className="course-editing-note">{courseEditingNote(course.status, course.visibility)}</p>
    <section className="editor-section course-details-form" aria-label="Course details">
      {/* Keep the visual cue decorative so native required semantics remain the accessible source of truth. */}
      {/* A prior save or publication notice no longer describes the course after a detail edit. */}
      <div className="editor-field-grid"><label className="field-wide"><span className="form-label-row"><span>Course title</span><small className="form-required-indicator" aria-hidden="true">Required</small></span><input ref={courseTitleInputRef} required value={title} maxLength={MAX_COURSE_TITLE_LENGTH} aria-invalid={courseTitleError ? true : undefined} aria-describedby={courseTitleError ? 'course-title-error' : undefined} onChange={(event) => { setNotice(''); setTitle(event.target.value); setCourseTitleError(''); setError((currentError) => currentError === courseTitleError ? '' : currentError); }} placeholder="Give your course a clear title" disabled={saving} />{courseTitleError && <small id="course-title-error" className="course-detail-field-error" role="alert">{courseTitleError}</small>}</label>
        <label><span className="form-label-row"><span>Category</span><small className="form-required-indicator" aria-hidden="true">Required</small></span><input ref={courseCategoryInputRef} required value={category} maxLength={MAX_COURSE_CATEGORY_LENGTH} aria-invalid={courseCategoryError ? true : undefined} aria-describedby={courseCategoryError ? 'course-category-error' : undefined} onChange={(event) => { setNotice(''); setCategory(event.target.value); setCourseCategoryError(''); setError((currentError) => currentError === courseCategoryError ? '' : currentError); }} placeholder="e.g. Professional development" disabled={saving} />{courseCategoryError && <small id="course-category-error" className="course-detail-field-error" role="alert">{courseCategoryError}</small>}</label>
        <fieldset className="visibility-field" disabled={saving}><legend>Visibility</legend><label><input type="radio" name="visibility" checked={visibility === 'public'} onChange={() => { setNotice(''); setVisibility('public'); }} />Public</label><label><input type="radio" name="visibility" checked={visibility === 'private'} onChange={() => { setNotice(''); setVisibility('private'); }} />Private</label></fieldset>
        <label className="completion-window-field">Completion window (optional)<input ref={completionWindowInputRef} type="number" min="1" max="3650" step="1" inputMode="numeric" value={completionWindowDays} aria-invalid={completionWindow.error ? true : undefined} aria-describedby={completionWindow.error ? 'completion-window-help completion-window-error' : 'completion-window-help'} onChange={(event) => { setNotice(''); setCompletionWindowDays(event.target.value); setError((currentError) => currentError === COMPLETION_WINDOW_ERROR ? '' : currentError); }} placeholder="No deadline" disabled={saving} /><small id="completion-window-help">Days are 24-hour periods. Deadlines do not block course access.</small>{completionWindow.error && <small id="completion-window-error" className="completion-window-error" role="alert">{completionWindow.error}</small>}</label>
        <label className="field-wide">Description
          <textarea id="course-description" aria-describedby="course-description-count" rows={3} maxLength={6000} value={description} onChange={(event) => { setNotice(''); setDescription(event.target.value); }} placeholder="What will learners understand or be able to do after this course?" disabled={saving} />
          <small id="course-description-count" className="field-character-count">{description.length} / 6,000 characters</small>
        </label>
      </div>
      <div className="cover-upload-row" aria-busy={coverValidating || coverProgress !== null || undefined}>
        <div>
          <ImageWithFallback src={course.coverUrl} className="course-cover-image" alt="Course cover preview" fallback={<span className="cover-preview-empty"><BookOpen size={22} aria-hidden="true" /></span>} />
          <div><strong>Course cover</strong><small id={coverHelpId}>JPG, PNG, or WebP · max {MAX_COURSE_COVER_DIMENSION} × {MAX_COURSE_COVER_DIMENSION} px</small></div>
        </div>
        <label className={`button button-secondary file-button ${coverValidating || coverProgress !== null || saving ? 'file-button-busy' : ''}`} aria-disabled={coverValidating || coverProgress !== null || saving}>
          <Upload size={16} aria-hidden="true" />{coverValidating ? 'Checking cover…' : coverProgress === null ? course.coverUrl ? 'Replace cover' : 'Upload cover' : coverProgress >= 100 ? 'Saving cover…' : 'Uploading cover…'}
          <input type="file" accept="image/jpeg,image/png,image/webp" aria-describedby={coverHelpId} disabled={coverValidating || coverProgress !== null || saving} onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadCover(file, event.currentTarget); event.currentTarget.value = ''; }} />
        </label>
        {coverValidating && <span className="upload-percent" role="status">Checking cover dimensions…</span>}
        {coverProgress !== null && (coverProgress >= 100 ? <span className="upload-percent upload-progress-saving-compact" role="status">Saving cover…</span> : <span className="upload-percent" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={coverProgress} aria-label="Course cover upload progress">{coverProgress}%</span>)}
        {coverProgress !== null && coverProgress < 100 && <button type="button" className="text-action upload-cancel-action" aria-label="Cancel cover upload" onClick={() => cancelUpload('cover')}>Cancel upload</button>}
      </div>
    </section>
    <section className="editor-section course-governance-section" aria-label="Course publication and learning settings" aria-busy={governanceLoading}>
      <div className="curriculum-editor-title"><div><h2>Publication and learning settings</h2><p>Choose how a new publication affects learners and manage its review history.</p></div></div>
      <label className="program-toggle version-reset-option"><input type="checkbox" checked={requiresRecompletion} onChange={(event) => setRequiresRecompletion(event.target.checked)} disabled={savingReviewDecision} /><span><strong>Require learners to complete the next published version</strong><small>Previous completions, quiz attempts, and certificates remain in history. The default keeps existing completions valid.</small></span></label>
      <label className="version-change-note">Publication note (up to 500 characters)<input value={changeNote} onChange={(event) => setChangeNote(event.target.value)} maxLength={500} placeholder="Optional note for the version history" disabled={savingReviewDecision} /><small>Saved with this version in its history.</small></label>
      {governanceLoading && <p className="course-governance-load-status" role="status">Loading version history and competency settings…</p>}
      {governanceError && <div className="course-governance-load-error"><Button type="button" variant="secondary" onClick={retryGovernanceLoad}>Retry loading course settings</Button></div>}
      {course.status === 'published' && governanceReady && <div className="revision-actions">
        {review?.status === 'in_review' && <div className="review-state"><span className="program-status draft">Awaiting review</span><p>Submitted by {review.submittedByName || 'a staff member'}{review.submittedAt ? ` · ${formatApiTimestamp(review.submittedAt, logTimestampFormatter)}` : ''}</p>{review.submittedBy === editorUser?.id && <>
          {/* Explain why the submitter does not have review-decision controls. */}
          <small>A different administrator or moderator must review this revision before it can be published.</small>
        </>}{review.reviewNote && <small>{review.reviewNote}</small>}</div>}
        {review?.status !== 'in_review' && <div className="review-submit-actions">{review?.status === 'changes_requested' && <div className="review-state"><span className="program-status draft">Changes requested</span>{review.reviewNote && <small>{review.reviewNote}</small>}</div>}<Button type="button" variant="secondary" onClick={() => void submitForReview()} disabled={saving || submittingReview || savingReviewDecision} aria-busy={submittingReview}>{submittingReview ? 'Submitting revision…' : 'Submit revision for review'}</Button></div>}
        {review?.status === 'in_review' && review.submittedBy !== editorUser?.id && <>
          <div className="review-decision-actions">
            <Button ref={requestChangesButtonRef} type="button" variant="secondary" aria-expanded={showChangeRequestForm} aria-controls={showChangeRequestForm ? `review-change-request-${courseId}` : undefined} onClick={() => { setChangeRequestNoteError(''); setShowChangeRequestForm(true); }} disabled={savingReviewDecision}>Request changes</Button>
            <Button type="button" onClick={() => void decideReview('approve')} disabled={saving || savingReviewDecision} aria-busy={savingReviewDecision}>{savingReviewDecision ? 'Saving review…' : 'Approve and publish'}</Button>
          </div>
          {showChangeRequestForm && <form id={`review-change-request-${courseId}`} className="review-request-form" onSubmit={(event) => { event.preventDefault(); void decideReview('changes_requested', changeRequestNote); }} aria-busy={savingReviewDecision}>
            {/* The cue is decorative; the native required state remains the accessible source of truth. */}
            <label htmlFor={`review-change-note-${courseId}`}><span className="form-label-row"><span>Changes requested (up to 1,000 characters)</span><small className="form-required-indicator" aria-hidden="true">Required</small></span>
              <textarea ref={changeRequestNoteInputRef} id={`review-change-note-${courseId}`} value={changeRequestNote} onChange={(event) => { setChangeRequestNote(event.target.value); if (event.target.value.trim()) setChangeRequestNoteError(''); }} maxLength={1000} rows={4} required autoFocus disabled={savingReviewDecision} aria-invalid={changeRequestNoteError ? true : undefined} aria-describedby={changeRequestNoteError ? `review-change-note-help-${courseId} review-change-note-error-${courseId}` : `review-change-note-help-${courseId}`} placeholder="Describe what the editor should update before this revision can be published." />
            </label>
            {changeRequestNoteError && <p id={`review-change-note-error-${courseId}`} className="form-error" role="alert">{changeRequestNoteError}</p>}
            <div className="review-request-form-footer"><small id={`review-change-note-help-${courseId}`}>The course editor will see this feedback. {changeRequestNote.length}/1,000 characters.</small><div className="review-request-form-actions">
              <Button type="button" variant="secondary" disabled={savingReviewDecision} onClick={() => { setShowChangeRequestForm(false); setChangeRequestNote(''); setChangeRequestNoteError(''); setError(''); requestChangesButtonRef.current?.focus(); }}>Cancel</Button>
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
          <div><strong>Version {currentVersion.version_number}<span className="current-version-label">Current</span></strong><small>{currentVersion.title} · Published {formatApiTimestamp(currentVersion.published_at, logTimestampFormatter)}{currentVersion.publisher ? ` by ${currentVersion.publisher}` : ''}</small>{currentVersion.change_note && <p>{currentVersion.change_note}</p>}</div>
        </li></ol>}
        {versionTotal > 0 && <details className="course-version-history-disclosure">
          <summary>Previous versions <span>{versionTotal}</span></summary>
          <ol>{versions.map((version) => {
          const restoring = restoringVersionRequests.has(`${courseId}:${version.id}`);
          return <li key={version.id}>
        <div><strong>Version {version.version_number}</strong><small>{version.title} · Published {formatApiTimestamp(version.published_at, logTimestampFormatter)}{version.publisher ? ` by ${version.publisher}` : ''}</small>{version.change_note && <p>{version.change_note}</p>}</div>
        <Button type="button" variant="secondary" aria-label={`Restore version ${version.version_number} as a new course version`} disabled={restoring} aria-busy={restoring} onClick={() => requestRestoreVersion(version)}>{restoring ? 'Restoring version…' : 'Restore as new version'}</Button>
      </li>;
          })}</ol>
          <CourseVersionPagination page={versionPage} pageSize={versionPageSize} total={versionTotal} versions={versions} loading={versionHistoryLoading} onChange={(nextPage) => void loadVersionHistory(nextPage)} />
        </details>}
      </div>}
    </section>
    <section className="editor-section curriculum-editor-section">
      {/* Curriculum labels and control names carry the meaning; these glyphs stay decorative. */}
      <div className="curriculum-editor-title"><div><h2>Course curriculum</h2><p>Organize lessons into modules and add a quiz when you are ready.</p></div><div className="curriculum-editor-actions"><Button ref={addModuleButtonRef} variant="secondary" aria-expanded={addingModule} aria-controls={addingModule ? 'add-module-form' : undefined} disabled={Boolean(editingModuleTitle) || saving || deletingCourse || addingModuleBusy} onClick={(event) => { if (addingModule) setAddingModule(false); else { addModuleInvokerRef.current = event.currentTarget; setAddingModule(true); } }}><Plus size={17} aria-hidden="true" />Add module</Button></div></div>
      {addingModule && <form id="add-module-form" className="inline-add-form" onSubmit={addModule}><input autoFocus value={moduleTitle} onChange={(event) => setModuleTitle(event.target.value)} placeholder="Module title" aria-label="Module title" maxLength={160} disabled={addingModuleBusy} /><Button type="submit" disabled={!moduleTitle.trim() || addingModuleBusy}>{addingModuleBusy ? 'Adding module…' : 'Add module'}</Button><button type="button" className="text-action" disabled={addingModuleBusy} onClick={() => { setAddingModule(false); addModuleInvokerRef.current?.focus(); }}>Cancel</button></form>}
      <div className="module-editor-list">
        {course.modules?.map((module, moduleIndex) => <div className="module-editor" key={module.id}>
          <div className={`module-editor-heading${editingModuleTitle?.courseId === course.id && editingModuleTitle.moduleId === module.id ? ' module-editor-heading-editing' : ''}`}>
            <button type="button" className="module-disclosure" disabled={Boolean(editingModuleTitle)} onClick={() => setExpanded({ ...expanded, [module.id]: !(expanded[module.id] ?? true) })} aria-label={`${expanded[module.id] ?? true ? 'Collapse' : 'Expand'} ${module.title}`} aria-expanded={expanded[module.id] ?? true}><ChevronDown className={(expanded[module.id] ?? true) ? '' : 'chevron-collapsed'} size={18} aria-hidden="true" /></button>
            <BookOpen size={18} aria-hidden="true" />
            {editingModuleTitle?.courseId === course.id && editingModuleTitle.moduleId === module.id
              ? <form className="module-title-edit-form" aria-busy={savingModuleTitleId === module.id} aria-label={`Rename module ${module.title}`} onSubmit={saveModuleTitle} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); cancelModuleTitleEdit(); } }}>
                <input type="text" autoFocus required maxLength={160} aria-label={`Module title for ${module.title}`} value={editingModuleTitle.title} disabled={savingModuleTitleId === module.id} onChange={(event) => setEditingModuleTitle((current) => current?.moduleId === module.id ? { ...current, title: event.target.value } : current)} />
                <Button type="submit" variant="secondary" disabled={savingModuleTitleId === module.id}>{savingModuleTitleId === module.id ? 'Saving…' : 'Save title'}</Button>
                <Button type="button" variant="quiet" disabled={savingModuleTitleId === module.id} onClick={cancelModuleTitleEdit}>Cancel</Button>
              </form>
              : <h3 className="module-name-heading"><button ref={(button) => { if (button) moduleTitleButtonRefs.current.set(module.id, button); else moduleTitleButtonRefs.current.delete(module.id); }} type="button" className="module-name-button" aria-label={`Rename module ${module.title}`} disabled={Boolean(editingModuleTitle) || saving || deletingCourse || isMovingCurriculum || Boolean(deletingCurriculumItem)} onClick={() => startModuleTitleEdit(module)}>{module.title}</button></h3>}
            <span className="module-item-count">{formatCountLabel(module.lessons.length + (module.quiz ? 1 : 0), 'item', 'items')}</span>
            <div className="module-tools"><button type="button" title={movingCurriculumItems.has(`module:${module.id}`) ? 'Moving module…' : 'Move module up'} aria-label={movingCurriculumItems.has(`module:${module.id}`) ? `Moving ${module.title}` : `Move ${module.title} up`} aria-busy={movingCurriculumItems.has(`module:${module.id}`)} disabled={moduleIndex === 0 || isMovingCurriculum || Boolean(editingModuleTitle)} onClick={() => moveItem(`/api/manage/modules/${module.id}/move`, 'up', `module:${module.id}`)}><ArrowUp size={16} aria-hidden="true" /></button><button type="button" title={movingCurriculumItems.has(`module:${module.id}`) ? 'Moving module…' : 'Move module down'} aria-label={movingCurriculumItems.has(`module:${module.id}`) ? `Moving ${module.title}` : `Move ${module.title} down`} aria-busy={movingCurriculumItems.has(`module:${module.id}`)} disabled={moduleIndex === (course.modules?.length || 0) - 1 || isMovingCurriculum || Boolean(editingModuleTitle)} onClick={() => moveItem(`/api/manage/modules/${module.id}/move`, 'down', `module:${module.id}`)}><ArrowDown size={16} aria-hidden="true" /></button><button type="button" title={deletingCurriculumItem === `module:${module.id}` ? 'Removing module…' : 'Remove module'} aria-label={deletingCurriculumItem === `module:${module.id}` ? `Removing module ${module.title}` : `Remove module ${module.title}`} aria-busy={deletingCurriculumItem === `module:${module.id}`} disabled={saving || deletingCourse || Boolean(deletingCurriculumItem) || Boolean(editingModuleTitle)} className="danger-icon" onClick={() => deleteModule(module)}><Trash2 size={16} aria-hidden="true" /></button></div>
          </div>
          {(expanded[module.id] ?? true) && <div className="module-editor-content">
            {module.lessons.map((lesson, lessonIndex) => <div className="lesson-editor-item" key={lesson.id}>
              <div className="lesson-editor-row">
                <span className="lesson-grip"><FileText size={17} aria-hidden="true" /></span><button type="button" className="lesson-name-button" aria-expanded={editingLessonId === lesson.id} aria-controls={editingLessonId === lesson.id ? `lesson-details-${lesson.id}` : undefined} onClick={() => setEditingLessonId(editingLessonId === lesson.id ? '' : lesson.id)}>{lesson.title}</button>
                {lesson.hasVideo ? <span className="video-file-label"><Check size={15} aria-hidden="true" />{lesson.videoName}</span> : <><label className={`button button-upload-small file-button ${uploading[lesson.id] !== undefined ? 'file-button-busy' : ''}`} aria-disabled={uploading[lesson.id] !== undefined}><Upload size={15} aria-hidden="true" />{uploading[lesson.id] === undefined ? 'Upload video' : uploading[lesson.id] >= 100 ? 'Saving video…' : 'Uploading video…'}<input type="file" accept="video/mp4,.mp4" aria-describedby={`lesson-video-format-help-${lesson.id}`} disabled={uploading[lesson.id] !== undefined} onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadVideo(lesson.id, file, event.currentTarget); event.currentTarget.value = ''; }} /></label><span id={`lesson-video-format-help-${lesson.id}`} className="sr-only">Choose an MP4 video file.</span></>}
                {uploading[lesson.id] !== undefined && (uploading[lesson.id] >= 100 ? <div className="upload-progress upload-progress-saving" role="status">Saving video…</div> : <div className="upload-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploading[lesson.id]} aria-label={`Video upload progress for ${lesson.title}`}><span style={{ width: `${uploading[lesson.id]}%` }} /><small>{uploading[lesson.id]}%</small></div>)}
                {uploading[lesson.id] !== undefined && uploading[lesson.id] < 100 && <button type="button" className="text-action upload-cancel-action" aria-label={`Cancel video upload for ${lesson.title}`} onClick={() => cancelUpload(`video:${lesson.id}`)}>Cancel upload</button>}
                <div className="lesson-tools"><button type="button" className="lesson-edit-action" title="Edit lesson details" aria-label={`Edit details for ${lesson.title}`} aria-expanded={editingLessonId === lesson.id} aria-controls={editingLessonId === lesson.id ? `lesson-details-${lesson.id}` : undefined} onClick={() => setEditingLessonId(editingLessonId === lesson.id ? '' : lesson.id)}><Pencil size={14} aria-hidden="true" /><span>Details</span></button><button type="button" title={movingCurriculumItems.has(`lesson:${lesson.id}`) ? 'Moving lesson…' : 'Move lesson up'} aria-label={movingCurriculumItems.has(`lesson:${lesson.id}`) ? `Moving ${lesson.title}` : `Move ${lesson.title} up`} aria-busy={movingCurriculumItems.has(`lesson:${lesson.id}`)} disabled={lessonIndex === 0 || isMovingCurriculum} onClick={() => moveItem(`/api/manage/lessons/${lesson.id}/move`, 'up', `lesson:${lesson.id}`)}><ArrowUp size={15} aria-hidden="true" /></button><button type="button" title={movingCurriculumItems.has(`lesson:${lesson.id}`) ? 'Moving lesson…' : 'Move lesson down'} aria-label={movingCurriculumItems.has(`lesson:${lesson.id}`) ? `Moving ${lesson.title}` : `Move ${lesson.title} down`} aria-busy={movingCurriculumItems.has(`lesson:${lesson.id}`)} disabled={lessonIndex === module.lessons.length - 1 || isMovingCurriculum} onClick={() => moveItem(`/api/manage/lessons/${lesson.id}/move`, 'down', `lesson:${lesson.id}`)}><ArrowDown size={15} aria-hidden="true" /></button><button type="button" title={deletingCurriculumItem === `lesson:${lesson.id}` ? 'Removing lesson…' : 'Remove lesson'} aria-label={deletingCurriculumItem === `lesson:${lesson.id}` ? `Removing lesson ${lesson.title}` : `Remove lesson ${lesson.title}`} aria-busy={deletingCurriculumItem === `lesson:${lesson.id}`} disabled={saving || deletingCourse || Boolean(deletingCurriculumItem)} className="danger-icon" onClick={() => deleteLesson(lesson.id, lesson.title)}><Trash2 size={15} aria-hidden="true" /></button></div>
              </div>
              {editingLessonId === lesson.id && <LessonDetailsEditor lesson={lesson} courseId={courseId} beforeChange={saveCourseDetailsIfChanged} onChanged={load} onClose={() => setEditingLessonId('')} onError={setError} onNotice={setNotice} />}
            </div>)}
            <div className="module-add-actions"><button type="button" className="text-action" disabled={addingLessonModuleIds.has(module.id)} onClick={() => addLesson(module.id)}><Plus size={15} aria-hidden="true" />{addingLessonModuleIds.has(module.id) ? 'Adding lesson…' : 'Add lesson'}</button><span className="add-action-divider" /><button ref={(node) => { if (node) quizAddButtonRefs.current.set(module.id, node); else quizAddButtonRefs.current.delete(module.id); }} type="button" className="text-action" onClick={() => void addModuleQuiz(module)} disabled={Boolean(module.quiz) || addingQuizModuleIds.has(module.id)} aria-busy={addingQuizModuleIds.has(module.id)}><CircleHelp size={15} aria-hidden="true" />{module.quiz ? 'Quiz added' : addingQuizModuleIds.has(module.id) ? 'Adding quiz…' : 'Add module quiz'}</button></div>
            {module.quiz && <QuizEditor module={module} onSaved={async (action) => {
              const requestedCourseId = course.id;
              if (routeCourseIdRef.current !== requestedCourseId) return;
              try {
                await saveCourseDetailsIfChanged();
                if (routeCourseIdRef.current !== requestedCourseId) return;
                await load(requestedCourseId);
                if (routeCourseIdRef.current === requestedCourseId) setNotice(action === 'removed' ? 'Quiz removed.' : 'Quiz saved.');
              } catch (cause) {
                if (routeCourseIdRef.current === requestedCourseId) {
                  const message = cause instanceof ApiError ? cause.message : 'Course details could not be saved.';
                  setError(action === 'removed' ? `Quiz removed, but course details could not be saved: ${message}` : `Quiz saved, but course details could not be saved: ${message}`);
                }
              }
            }} onError={(message) => { if (routeCourseIdRef.current === course.id) setError(message); }} titleInputRef={(node) => { if (node) quizTitleInputRefs.current.set(module.id, node); else quizTitleInputRefs.current.delete(module.id); }} />}
          </div>}
        </div>)}
        {!course.modules?.length && !course.finalExam && <EmptyState headingLevel={3} icon={<BookOpen size={22} />} title="Start with a module" detail="Modules organize the video lessons in your course. You can also create an exam-only certification practice course." action={<Button variant="secondary" aria-expanded={addingModule} aria-controls={addingModule ? 'add-module-form' : undefined} onClick={(event) => { addModuleInvokerRef.current = event.currentTarget; setAddingModule(true); }}><Plus size={16} aria-hidden="true" />Add first module</Button>} />}
      </div>
      <CourseFinalExamEditor key={`${course.id}:${course.finalExam?.id ?? 'no-exam'}`} courseId={course.id} exam={course.finalExam} onChanged={() => load(course.id)} onError={(message) => { if (routeCourseIdRef.current === course.id) setError(message); }} onNotice={(message) => { if (routeCourseIdRef.current === course.id) setNotice(message); }} />
    </section>
    {course.status === 'archived' && <div className="delete-course-row"><div><strong>Delete this course permanently</strong><span>This also removes its uploaded media and cannot be undone.</span></div><Button variant="danger" onClick={() => void deleteArchivedCourse()} disabled={saving || deletingCourse || Boolean(deletingCurriculumItem)} aria-busy={deletingCourse}><Trash2 size={16} aria-hidden="true" />{deletingCourse ? 'Deleting course…' : 'Delete course'}</Button></div>}
    {pendingDeleteCourseId === course.id && routeCourseIdRef.current === course.id && <ConfirmationDialog {...courseDeletionConfirmation(course.title)} confirmLabel="Delete course" onCancel={() => setPendingDeleteCourseId(null)} onConfirm={() => { const requestedCourseId = pendingDeleteCourseId; setPendingDeleteCourseId(null); if (requestedCourseId === course.id && routeCourseIdRef.current === course.id) void deleteArchivedCourse(true); }} />}
    {pendingRestoreVersion?.courseId === course.id && routeCourseIdRef.current === course.id && versions.some((version) => version.id === pendingRestoreVersion.versionId) && <ConfirmationDialog
      title={`Restore version ${pendingRestoreVersion.versionNumber}?`}
      description={`This publishes version ${pendingRestoreVersion.versionNumber} as a new course version. Any current unpublished revision will be discarded. ${requiresRecompletion
        ? 'Learners will need to complete the new version again. Previous completions, quiz attempts, and certificates stay in history.'
        : 'Existing completions remain valid. Previous quiz attempts and certificates stay in history.'}`}
      confirmLabel={`Restore version ${pendingRestoreVersion.versionNumber}`}
      onCancel={() => setPendingRestoreVersion(null)}
      onConfirm={confirmPendingVersionRestore}
    />}
    {pendingDeleteModule?.courseId === course.id && routeCourseIdRef.current === course.id && course.modules?.some((module) => module.id === pendingDeleteModule.module.id) && <ConfirmationDialog title={`Remove “${pendingDeleteModule.module.title}”?`} description={`This removes all lessons in this module, its quiz and saved attempts, and their uploaded videos, documents, and captions. This action cannot be undone.`} confirmLabel="Remove module" onCancel={() => setPendingDeleteModule(null)} onConfirm={confirmPendingModuleDeletion} />}
    {pendingDeleteLesson?.courseId === course.id && routeCourseIdRef.current === course.id && course.modules?.some((module) => module.id === pendingDeleteLesson.moduleId && module.lessons.some((lesson) => lesson.id === pendingDeleteLesson.lessonId)) && <ConfirmationDialog title={`Remove “${pendingDeleteLesson.title}”?`} description="This removes the lesson, its video, attached resources, and caption tracks. This action cannot be undone." confirmLabel="Remove lesson" onCancel={() => setPendingDeleteLesson(null)} onConfirm={confirmPendingLessonDeletion} />}
  </div>;
}

export function CourseGroupsPage() {
  const [groups, setGroups] = useState<CourseGroup[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [targetGroupId, setTargetGroupId] = useState('');
  const [courseQuery, setCourseQuery] = useState('');
  const [appliedCourseQuery, setAppliedCourseQuery] = useState('');
  const [courses, setCourses] = useState<Course[]>([]);
  const [coursePage, setCoursePage] = useState(1);
  const [coursePageSize, setCoursePageSize] = useState(50);
  const [courseTotal, setCourseTotal] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [coursesLoading, setCoursesLoading] = useState(true);
  const [busyCourses, setBusyCourses] = useState<Record<string, 'add' | 'remove'>>({});
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setGroups([]);
    setError('');
    setNotice('');
    setLoading(true);
    fetchCourseGroups({ signal: controller.signal }).then(({ groups: loadedGroups }) => {
      if (!active) return;
      setGroups(loadedGroups);
      setTargetGroupId((current) => loadedGroups.some((group) => group.id === current) ? current : loadedGroups[0]?.id || '');
    }).catch((cause) => {
      if (active && !controller.signal.aborted) {
        setError(cause instanceof ApiError ? cause.message : 'Course groups could not be loaded.');
      }
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; controller.abort(); };
  }, [loadAttempt]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setCoursesLoading(true);
    const params = new URLSearchParams({ page: String(coursePage) });
    if (appliedCourseQuery) params.set('q', appliedCourseQuery);
    api.get<CourseListResponse>(`/api/manage/courses?${params}`, { signal: controller.signal }).then((response) => {
      if (!active) return;
      setCourses(response.courses);
      setCoursePage(response.page);
      setCoursePageSize(response.pageSize);
      setCourseTotal(response.total);
    }).catch((cause) => {
      if (active && !controller.signal.aborted) {
        setError(cause instanceof ApiError ? cause.message : 'Courses could not be loaded.');
      }
    }).finally(() => {
      if (active) setCoursesLoading(false);
    });
    return () => { active = false; controller.abort(); };
  }, [appliedCourseQuery, coursePage, loadAttempt]);

  async function createGroup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await createCourseGroup({ name: name.trim(), description: description.trim() });
      setGroups((current) => [...current, response.group].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })));
      setTargetGroupId(response.group.id);
      setName('');
      setDescription('');
      setNotice(`Created group “${response.group.name}”.`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The course group could not be created.');
    } finally {
      setSaving(false);
    }
  }

  function searchCourses(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCoursePage(1);
    setAppliedCourseQuery(courseQuery.trim());
    setError('');
  }

  async function addCourse(group: CourseGroup, course: Course) {
    const busyKey = `${group.id}:${course.id}`;
    if (busyCourses[busyKey] || group.courses.some((entry) => entry.id === course.id)) return;
    setBusyCourses((current) => ({ ...current, [busyKey]: 'add' }));
    setError('');
    setNotice('');
    try {
      const response = await assignCourseToGroup(group.id, course.id);
      setGroups((current) => current.map((entry) => entry.id === group.id
        ? { ...entry, courses: [...entry.courses, response.course].sort((left, right) => left.title.localeCompare(right.title, undefined, { sensitivity: 'base' })) }
        : entry));
      setNotice(`Added “${response.course.title}” to “${group.name}”.`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The course could not be added to the group.');
    } finally {
      setBusyCourses((current) => { const next = { ...current }; delete next[busyKey]; return next; });
    }
  }

  async function removeCourse(group: CourseGroup, course: CourseGroup['courses'][number]) {
    const busyKey = `${group.id}:${course.id}`;
    if (busyCourses[busyKey]) return;
    setBusyCourses((current) => ({ ...current, [busyKey]: 'remove' }));
    setError('');
    setNotice('');
    try {
      await removeCourseFromGroup(group.id, course.id);
      setGroups((current) => current.map((entry) => entry.id === group.id
        ? { ...entry, courses: entry.courses.filter((assignedCourse) => assignedCourse.id !== course.id) }
        : entry));
      setNotice(`Removed “${course.title}” from “${group.name}”.`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The course could not be removed from the group.');
    } finally {
      setBusyCourses((current) => { const next = { ...current }; delete next[busyKey]; return next; });
    }
  }

  return <div className="management-page course-groups-page">
    <div className="breadcrumbs"><Link to="/manage/courses">Courses</Link><span>/</span><span>Groups</span></div>
    <PageHeading title="Course groups" subtitle="Create reusable collections, then add or remove courses as your catalogue changes." action={<Link className="button button-secondary" to="/manage/courses"><ArrowLeft size={16} aria-hidden="true" />Back to courses</Link>} />
    {error && <div className="error-notice-actionable"><Notice>{error}</Notice><Button type="button" variant="secondary" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Retry loading</Button></div>}
    {notice && <Notice kind="success">{notice}</Notice>}
    {loading ? <div className="page-loading" role="status" aria-live="polite">Loading course groups…</div>
      : <>
        <section className="program-editor-card course-group-create" aria-labelledby="course-group-create-heading">
          <div className="program-card-heading"><div><span className="program-icon"><UsersRound size={20} aria-hidden="true" /></span><div><h2 id="course-group-create-heading">Create a group</h2><p>Give the group a name. You can add courses after creating it.</p></div></div></div>
          <form className="program-form-grid course-group-create-form" onSubmit={createGroup} aria-busy={saving}>
            {/* A prior creation confirmation should not linger while the next group is being edited. */}
            <label>Group name<input value={name} onChange={(event) => { setNotice(''); setName(event.target.value); }} maxLength={120} required disabled={saving} placeholder="e.g. Core curriculum" /></label>
            <label>Description (optional)<textarea value={description} onChange={(event) => { setNotice(''); setDescription(event.target.value); }} maxLength={1000} rows={2} disabled={saving} placeholder="What should learners know about this group?" /></label>
            <div className="program-form-actions"><Button type="submit" disabled={saving}>{saving ? 'Creating group…' : 'Create group'}</Button></div>
          </form>
        </section>
        <section className="course-group-assign" aria-labelledby="course-group-assign-heading">
          <div className="course-group-section-heading"><div><h2 id="course-group-assign-heading">Add courses to a group</h2><p>Choose a group, then find courses by name.</p></div></div>
          {groups.length > 0 ? <>
            <form id="course-group-search" className="course-group-search" role="search" aria-label="Find courses to add to a group" onSubmit={searchCourses}>
              <label>Add to group<select value={targetGroupId} onChange={(event) => setTargetGroupId(event.target.value)} aria-label="Group to add courses to">
                {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
              </select></label>
              <label>Find courses<span className="course-group-search-input"><Search size={17} aria-hidden="true" /><input type="search" value={courseQuery} onChange={(event) => setCourseQuery(event.target.value)} placeholder="Search courses" maxLength={120} /></span></label>
              <Button type="submit" variant="secondary"><Search size={16} aria-hidden="true" />Find courses</Button>
            </form>
          {coursesLoading ? <div className="page-loading" role="status" aria-live="polite">Loading courses…</div>
            : courses.length ? <div className="course-group-candidates" role="list" aria-label="Courses you can add">
              {courses.map((course) => {
                const group = groups.find((entry) => entry.id === targetGroupId);
                const alreadyAssigned = Boolean(group?.courses.some((entry) => entry.id === course.id));
                const busy = busyCourses[`${targetGroupId}:${course.id}`];
                return <div className="course-group-candidate" key={course.id} role="listitem">
                  <div><Link to={`/manage/courses/${course.id}/edit`}>{course.title}</Link><small>{course.category} · {course.status}</small></div>
                  <Button type="button" variant="secondary" onClick={() => group && void addCourse(group, course)} disabled={!group || alreadyAssigned || Boolean(busy)} aria-busy={busy === 'add'} aria-label={group ? alreadyAssigned ? `${course.title} is already in ${group.name}` : `Add ${course.title} to ${group.name}` : undefined}>{alreadyAssigned ? 'In group' : busy === 'add' ? 'Adding…' : 'Add to group'}</Button>
                </div>;
              })}
            </div> : <EmptyState headingLevel={3} title={appliedCourseQuery ? 'No matching courses' : 'No courses available'} detail={appliedCourseQuery ? 'Try another search term.' : 'Create courses before adding them to a group.'} />}
          {!coursesLoading && courseTotal > 0 && <LogPagination ariaLabel="Course search pages" page={coursePage} pageSize={coursePageSize} total={courseTotal} loading={coursesLoading} onChange={setCoursePage} />}
          </> : <p className="course-group-no-groups">Create a group above to start adding courses.</p>}
        </section>
        <section aria-labelledby="course-groups-heading">
          <div className="course-groups-heading"><h2 id="course-groups-heading">Your groups</h2><span>{formatCountLabel(groups.length, 'group', 'groups')}</span></div>
          {groups.length ? <div className="course-groups-list">{groups.map((group) => <article className="program-card course-group-card" key={group.id}>
            <div className="program-card-heading"><div><span className="program-icon"><UsersRound size={19} aria-hidden="true" /></span><div><h3>{group.name}</h3><p>{group.description || 'No description added.'}</p></div></div></div>
            <div className="course-group-created">Created <DateTimeText value={group.createdAt} /></div>
            <div className="course-group-members"><div className="course-group-members-heading"><h4>Courses</h4><span className="course-group-count">{formatCountLabel(group.courses.length, 'course', 'courses')}</span></div>
              {group.courses.length ? <ul>{group.courses.map((course) => <li key={course.id}>
                <div><Link to={`/manage/courses/${course.id}/edit`}>{course.title}</Link><small>{course.category} · {course.status}</small></div>
                <Button type="button" variant="secondary" onClick={() => void removeCourse(group, course)} disabled={Boolean(busyCourses[`${group.id}:${course.id}`])} aria-busy={busyCourses[`${group.id}:${course.id}`] === 'remove'} aria-label={`Remove ${course.title} from ${group.name}`}>{busyCourses[`${group.id}:${course.id}`] === 'remove' ? 'Removing…' : 'Remove'}</Button>
              </li>)}</ul> : <div className="course-group-empty-state"><p>No courses in this group yet.</p><a href="#course-group-search" onClick={() => setTargetGroupId(group.id)}>Add a course</a></div>}
            </div>
          </article>)}</div> : <EmptyState headingLevel={3} title="No course groups yet" detail="Create a group to organize related courses." />}
        </section>
      </>}
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
  const [notice, setNotice] = useState('');
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
    setCourse(null); setUsers([]); setQuery(''); setAppliedQuery(''); setPage(1); setTotal(0); setNotice('');
    savingIdsRef.current = new Set(); setSavingIds(savingIdsRef.current);
    load('', 1);
    return () => { loadSequenceRef.current += 1; loadControllerRef.current?.abort(); };
  }, [courseId]);

  async function toggle(user: CourseAccessUser) {
    if (savingIdsRef.current.has(user.id)) return;
    const requestedCourseId = courseId;
    markSaving(user.id, true); setError(''); setNotice('');
    try {
      if (user.granted) await api.delete(`/api/manage/courses/${requestedCourseId}/access/${user.id}`);
      else await api.put(`/api/manage/courses/${requestedCourseId}/access/${user.id}`);
      if (routeCourseIdRef.current === requestedCourseId) {
        setNotice(`Course assignment updated for ${user.username}.`);
        const currentListState = accessListStateRef.current;
        await load(currentListState.query, currentListState.page, 'Access changed, but the learner list could not be refreshed.');
      }
    } catch (cause) {
      if (routeCourseIdRef.current === requestedCourseId) setError(cause instanceof ApiError ? cause.message : 'Access could not be changed.');
    } finally {
      if (routeCourseIdRef.current === requestedCourseId) markSaving(user.id, false);
    }
  }

  function submitSearch(event: React.FormEvent) {
    event.preventDefault();
    const search = query.trim();
    // A new result set changes which learner the assignment confirmation describes.
    setNotice('');
    setAppliedQuery(search);
    setPage(1);
    load(search, 1);
  }

  if (loading || (course && course.id !== courseId)) return <div className="page-loading" role="status" aria-live="polite">Loading course access…</div>;
  const hasEmptyAccessResult = !failedRequest && users.length === 0;
  return <div className="access-page"><div className="breadcrumbs"><Link to="/manage/courses">Courses</Link><span>/</span><Link to={`/manage/courses/${courseId}/edit`}>{course?.title || 'Course'}</Link><span>/</span><span>Assign learners</span></div>
    <PageHeading title="Assign learners" subtitle={course?.visibility === 'private'
      ? `Manage direct assignments and review access through learning paths for ${course.title}.`
      : `Published public courses are available to all signed-in learners. Direct assignment adds ${course?.title || 'this course'} to My learning.`} action={<Link className="button button-secondary" to={`/manage/courses/${courseId}/edit`}><ArrowLeft size={16} aria-hidden="true" />Back to course</Link>} />
    {error && (failedRequest
      ? <div className="account-list-error"><Notice>{error}</Notice><Button type="button" variant="secondary" onClick={() => { void load(failedRequest.query, failedRequest.page); }}>Try again</Button></div>
      : <Notice>{error}</Notice>)}
    {notice && <div className="inline-notice inline-notice-success" role="status">{notice}</div>}
    <form role="search" aria-label="Search course learners" className="access-search" onSubmit={submitSearch}><Search size={18} aria-hidden="true" /><input type="search" placeholder="Search learners by username or email" aria-label="Search learners by username or email" maxLength={100} value={query} onChange={(event) => setQuery(event.target.value)} /><Button variant="secondary" type="submit">Search</Button></form>
    {/* Announce the empty result without moving focus or duplicating the visible recovery content. */}
    {hasEmptyAccessResult && <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{appliedQuery ? 'No learners match that search.' : 'No learner accounts are available.'}</p>}
    <div className="access-list">
      <div className="access-list-head"><span>Learner</span><span>Assignment / access</span><span>Action</span></div>
      {!failedRequest && users.length ? <ul className="access-rows" aria-label="Learner access">
        {users.map((learner) => {
          const assignmentAction = courseAccessAction(learner);
          const unassign = assignmentAction === 'unassign';
          const assignmentLabel = courseAccessStatusLabel(course || { visibility: 'public' }, learner);
          const actionLabel = courseAccessActionLabel(assignmentAction, learner.accessViaPath);
          return <li className="access-row" key={learner.id}>
            <div className="access-user"><UserInitial username={learner.username} /><div><strong>{learner.username}</strong>{learner.granted && learner.grantedAt && <small>Assigned <DateText value={learner.grantedAt} />{learner.grantedBy ? ` by ${learner.grantedBy}` : ''}</small>}</div></div>
            <span className={learner.hasAccess ? 'access-state access-state-granted' : 'access-state'}>{assignmentLabel}</span>
            <div className="access-row-actions">
              {learner.disabled && <span className="muted">Account disabled</span>}
              {assignmentAction && <button type="button" className={unassign ? 'text-action danger-text' : 'text-action'} aria-label={`${actionLabel} for ${learner.username} on ${course?.title || 'this course'}`} disabled={savingIds.has(learner.id)} onClick={() => toggle(learner)}>{actionLabel}</button>}
            </div>
          </li>;
        })}
      </ul> : !failedRequest && <div className="access-empty">{appliedQuery ? 'No learners match that search.' : user?.role === 'admin' ? <>No learner accounts are available. <Link className="text-action" to="/admin/users/new">Create a learner account.</Link></> : 'No learner accounts are available. Registered learners and accounts created by an administrator will appear here.'}</div>}
    </div>
    {!failedRequest && total > 0 && <LogPagination ariaLabel="Course access pages" page={page} pageSize={pageSize} total={total} loading={loading} onChange={(nextPage) => load(appliedQuery, nextPage)} />}
    <p className="access-footnote"><LockKeyhole size={15} aria-hidden="true" />Private-course access can come from a direct assignment or an unlocked learning path. Public courses are available to all signed-in learners; direct assignment also adds them to My learning. Removing an assignment does not erase learning progress.</p>
  </div>;
}

export function AdminUsersPage() {
  const { user: signedInUser, refresh } = useAuth();
  const resetPasswordHintId = useId();
  const resetPasswordErrorId = useId();
  const userListSearchInputRef = useRef<HTMLInputElement>(null);
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
  const confirmPasswordInputRef = useRef<HTMLInputElement>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [success, setSuccess] = useState('');
  const [pendingDisableUser, setPendingDisableUser] = useState<User | null>(null);

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

  // Apply the visible search draft together with either account filter.
  function applyUserListFilterChange(nextRoleFilter: UserRoleFilter, nextApprovalFilter: UserApprovalFilter) {
    const nextQuery = query.trim();
    const filtersChanged = nextRoleFilter !== roleFilter || nextApprovalFilter !== approvalFilter;
    const searchChanged = nextQuery !== appliedQuery;
    setQuery(nextQuery);
    setAppliedQuery(nextQuery);
    setRoleFilter(nextRoleFilter);
    setApprovalFilter(nextApprovalFilter);
    setPage(1);
    if (!filtersChanged && searchChanged) void load(1, nextQuery, nextRoleFilter, nextApprovalFilter);
  }

  const hasAppliedUserFilters = Boolean(appliedQuery || roleFilter !== 'all' || approvalFilter !== 'all');
  // Role and approval changes reload through the effect; search-only resets need their own request.
  // The reset control disappears on reset, so keep keyboard focus in the persistent search field.
  function clearUserListFilters() {
    const filterSelectionChanged = roleFilter !== 'all' || approvalFilter !== 'all';
    setQuery('');
    setAppliedQuery('');
    setRoleFilter('all');
    setApprovalFilter('all');
    setPage(1);
    if (!filterSelectionChanged) void load(1, '', 'all', 'all');
    userListSearchInputRef.current?.focus();
  }

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

  async function updateUser(user: User, changes: { role?: Role; disabled?: boolean }, disableConfirmed = false) {
    if (savingIdsRef.current.has(user.id)) return;
    if (changes.disabled === true && !disableConfirmed) { setPendingDisableUser(user); return; }
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
        // Preserve the committed change if only the follow-up list read fails.
        setSuccess(`${user.username}'s account was updated.`);
        await load(currentListState.page, currentListState.query, currentListState.roleFilter, currentListState.approvalFilter);
        return;
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
    if (confirmationError) { setError(confirmationError); confirmPasswordInputRef.current?.focus(); return; }
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

  async function approveRegistration(user: User, trigger: HTMLButtonElement) {
    if (savingIdsRef.current.has(user.id)) return;
    const shouldRestoreFocus = document.activeElement === trigger;
    markSaving(user.id, true); setError(''); setSuccess('');
    try {
      const response = await api.patch<{ user: User }>(`/api/admin/users/${user.id}/approval`, {});
      requestPendingRegistrationCountRefresh();
      // The approval has committed; preserve its confirmation if the follow-up list read fails.
      setSuccess(response.user.disabled
        ? `${user.username}'s registration was approved. The account is disabled, so enable it before they can sign in.`
        : `${user.username}'s registration was approved. They can now sign in.`);
      const currentListState = userListStateRef.current;
      await load(currentListState.page, currentListState.query, currentListState.roleFilter, currentListState.approvalFilter);
      if (shouldRestoreFocus) window.requestAnimationFrame(() => {
        const searchInput = userListSearchInputRef.current;
        const focusWasDropped = document.activeElement === document.body || document.activeElement === document.documentElement;
        // Approval removes its action from the pending row; return keyboard focus to a persistent list control.
        if (!trigger.isConnected && focusWasDropped && searchInput?.isConnected) searchInput.focus();
      });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Registration could not be approved.');
    } finally { markSaving(user.id, false); }
  }

  return <div className="management-page users-page"><PageHeading title="Users" subtitle="Create accounts, review learning activity, and manage roles and access." action={<Link className="button button-primary" to="/admin/users/new"><Plus size={17} aria-hidden="true" />Create account</Link>} />
    <div className="user-filter-row">
      <form role="search" aria-label="Search users" className="management-search" onSubmit={(event) => { event.preventDefault(); const search = query.trim(); setAppliedQuery(search); void load(1, search, roleFilter, approvalFilter); }}>
        <Search size={18} aria-hidden="true" />
        <input ref={userListSearchInputRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search username or email" aria-label="Search username or email" maxLength={100} />
        <button type="submit">Search</button>
      </form>
      <div className="select-wrap role-filter user-role-filter">
        <span className="catalog-filter-label">Role</span>
        <AppSelect className="app-select--filter" ariaLabel="Filter by role" leadingIcon={<UsersRound size={16} />} value={roleFilter} onChange={(nextRoleFilter) => applyUserListFilterChange(nextRoleFilter, approvalFilter)} options={USER_ROLE_FILTER_OPTIONS} />
      </div>
      <div className="select-wrap role-filter user-approval-filter">
        <span className="catalog-filter-label">Registration</span>
        <AppSelect className="app-select--filter" ariaLabel="Filter by registration approval" value={approvalFilter} onChange={(nextApprovalFilter) => applyUserListFilterChange(roleFilter, nextApprovalFilter)} options={USER_APPROVAL_FILTER_OPTIONS} />
      </div>
      {hasAppliedUserFilters && <Button type="button" variant="secondary" onClick={clearUserListFilters}>Clear filters</Button>}
    </div>
    {error && !resetUser && (failedRequest
      ? <div className="account-list-error"><Notice>{error}</Notice><Button type="button" variant="secondary" onClick={() => { void load(failedRequest.page, failedRequest.query, failedRequest.roleFilter, failedRequest.approvalFilter); }}>Try again</Button></div>
      : <Notice>{error}</Notice>)}
    {success && <Notice kind="success">{success}</Notice>}
    {/* Announce empty results while focus stays in the search and filter controls. */}
    {!loading && !failedRequest && !users.length && <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{userListEmptyMessage(appliedQuery, roleFilter, approvalFilter)}</p>}
    {loading ? <div className="page-loading" role="status" aria-live="polite">Loading accounts…</div> : failedRequest ? null : <div className="user-table-wrap" role="region" aria-label="Scrollable account list" tabIndex={0}><p className="table-scroll-hint">Scroll horizontally to see all account columns.</p><table className="user-table"><caption className="sr-only">Accounts</caption><thead><tr><th scope="col">User</th><th scope="col">Role</th><th scope="col">Account</th><th scope="col">Created</th><th scope="col">Actions</th></tr></thead><tbody>{users.map((user) => {
      const lastAdminHelpId = `last-active-admin-${user.id}`;
      return <tr key={user.id}>
        <th scope="row"><Link className="owner-cell user-detail-link" to={`/admin/users/${user.id}`}><UserInitial username={user.username} /><span className="user-detail-link-copy"><strong>{user.username}</strong>{user.email && <small>{user.email}</small>}</span></Link></th>
        <td><AppSelect<Role> className="app-select--compact" ariaLabel={`Role for ${user.username}`} describedBy={user.isLastActiveAdmin ? lastAdminHelpId : undefined} value={user.role} disabled={savingIds.has(user.id) || user.isLastActiveAdmin} busy={savingIds.has(user.id)} onChange={(role) => updateUser(user, { role })} options={ADMIN_USER_ROLE_OPTIONS} /></td>
        <td><span className={`account-state ${user.registrationStatus === 'pending' ? 'account-pending' : user.disabled ? 'account-disabled' : 'account-active'}`}><span />{user.registrationStatus === 'pending' ? 'Pending approval' : user.disabled ? 'Disabled' : 'Active'}</span>{user.isLastActiveAdmin && <small className="last-active-admin-note" id={lastAdminHelpId}>This is the only active administrator. Add another administrator before changing this account’s role or status.</small>}</td>
        <td>{user.createdAt ? <DateText value={user.createdAt} /> : '—'}</td>
        <td><div className="user-row-actions">{user.registrationStatus === 'pending' && <button type="button" className="text-action" aria-label={`Approve registration for ${user.username}`} aria-busy={savingIds.has(user.id) || undefined} disabled={savingIds.has(user.id)} onClick={(event) => approveRegistration(user, event.currentTarget)}>{savingIds.has(user.id) ? 'Approving…' : 'Approve'}</button>}<Link className="text-action" to={`/admin/users/${user.id}`} aria-label={`Details for ${user.username}`}>Details</Link><button type="button" className="text-action" aria-label={`Reset password for ${user.username}`} aria-busy={savingIds.has(user.id) || undefined} disabled={savingIds.has(user.id)} onClick={(event) => openPasswordReset(user, event.currentTarget)}>{savingIds.has(user.id) ? 'Resetting…' : 'Reset password'}</button><button type="button" className={user.disabled ? 'text-action' : 'text-action danger-text'} aria-label={savingIds.has(user.id) ? `Saving account changes for ${user.username}` : `${user.disabled ? 'Enable' : 'Disable'} account for ${user.username}`} aria-busy={savingIds.has(user.id) || undefined} aria-describedby={user.isLastActiveAdmin ? lastAdminHelpId : undefined} disabled={savingIds.has(user.id) || user.isLastActiveAdmin} onClick={() => updateUser(user, { disabled: !user.disabled })}>{savingIds.has(user.id) ? 'Saving…' : user.disabled ? 'Enable' : 'Disable'}</button></div></td>
      </tr>;
    })}</tbody></table>{!users.length && <div className="access-empty user-list-empty"><p>{userListEmptyMessage(appliedQuery, roleFilter, approvalFilter)}</p></div>}</div>}
    {!loading && !failedRequest && total > 0 && <LogPagination ariaLabel="User accounts pages" page={page} pageSize={pageSize} total={total} loading={loading} onChange={(nextPage) => load(nextPage)} />}
    {pendingDisableUser && <ConfirmationDialog {...accountDisableConfirmation(pendingDisableUser.username)} confirmLabel="Disable account" onCancel={() => setPendingDisableUser(null)} onConfirm={() => { const user = pendingDisableUser; setPendingDisableUser(null); if (user) void updateUser(user, { disabled: true }, true); }} />}
    {resetUser && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closePasswordReset(); }}><section ref={resetDialogRef} className="modal-card" role="dialog" aria-modal="true" aria-labelledby="reset-title" aria-describedby="reset-description" tabIndex={-1}><button className="modal-close" type="button" onClick={() => closePasswordReset()} aria-label="Close" disabled={savingIds.has(resetUser.id)}>×</button><h2 id="reset-title">Reset password</h2><p id="reset-description">Set a temporary password for <strong>{resetUser.username}</strong>. Their active sessions will be signed out.</p><form className="form-stack" onSubmit={resetPassword} aria-busy={savingIds.has(resetUser.id)}><PasswordField label="New password" name="newPassword" autoFocus required minLength={12} maxLength={256} autoComplete="new-password" value={newPassword} hint="Use at least 12 characters." hintId={resetPasswordHintId} onChange={(event) => { setNewPassword(event.target.value); setError((currentError) => clearPasswordConfirmationError(currentError)); }} disabled={savingIds.has(resetUser.id)} /><PasswordField label="Confirm password" name="confirmPassword" inputRef={confirmPasswordInputRef} {...passwordConfirmationFieldProps(error, resetPasswordErrorId)} required minLength={12} maxLength={256} autoComplete="new-password" value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setError((currentError) => clearPasswordConfirmationError(currentError)); }} disabled={savingIds.has(resetUser.id)} />{error && <Notice id={resetPasswordErrorId}>{error}</Notice>}<Button type="submit" disabled={savingIds.has(resetUser.id)}>{savingIds.has(resetUser.id) ? 'Saving…' : 'Reset password'}</Button></form></section></div>}
  </div>;
}

export function AdminUserCreatePage() {
  const navigate = useNavigate();
  const roleHelpId = useId();
  const passwordConfirmationErrorId = useId();
  const accountNameErrorId = useId();
  const accountEmailErrorId = useId();
  const accountUsernameErrorId = useId();
  const emailInputRef = useRef<HTMLInputElement>(null);
  const usernameInputRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [nameError, setNameError] = useState('');
  const [invalidNameField, setInvalidNameField] = useState<'firstName' | 'lastName' | null>(null);
  const firstNameInputRef = useRef<HTMLInputElement>(null);
  const lastNameInputRef = useRef<HTMLInputElement>(null);
  const confirmPasswordInputRef = useRef<HTMLInputElement>(null);
  const [username, setUsername] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [role, setRole] = useState<Role>('learner');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function createAccount(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setError(''); setEmailError(''); setUsernameError(''); setNameError(''); setInvalidNameField(null);
    const currentEmailError = validateEmail(email);
    if (currentEmailError) {
      setEmailError(currentEmailError);
      window.requestAnimationFrame(() => emailInputRef.current?.focus());
      return;
    }
    const firstNameError = accountNameError(firstName, 'First name');
    if (firstNameError) {
      setInvalidNameField('firstName');
      setNameError(firstNameError);
      window.requestAnimationFrame(() => firstNameInputRef.current?.focus());
      return;
    }
    const lastNameError = accountNameError(lastName, 'Last name');
    if (lastNameError) {
      setInvalidNameField('lastName');
      setNameError(lastNameError);
      window.requestAnimationFrame(() => lastNameInputRef.current?.focus());
      return;
    }
    const confirmationError = getPasswordConfirmationError(password, confirmPassword);
    if (confirmationError) { setError(confirmationError); confirmPasswordInputRef.current?.focus(); return; }
    setSaving(true);
    try {
      const response = await api.post<{ user: User }>('/api/admin/users', {
        email,
        firstName: normalizeAccountName(firstName),
        lastName: normalizeAccountName(lastName),
        username,
        role,
        password,
        confirmPassword,
      });
      navigate(`/admin/users/${response.user.id}`, { replace: true });
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'invalid_name') {
        // Keep server-side name validation attached to the matching creation field.
        const invalidField = cause.message.startsWith('Last name') ? 'lastName' : 'firstName';
        setInvalidNameField(invalidField);
        setNameError(cause.message);
        window.requestAnimationFrame(() => (invalidField === 'lastName' ? lastNameInputRef.current : firstNameInputRef.current)?.focus());
      } else if (cause instanceof ApiError && (cause.code === 'invalid_email' || cause.code === 'email_taken')) {
        // Keep identifier conflicts attached to the value an administrator needs to change.
        setEmailError(cause.message);
        window.requestAnimationFrame(() => emailInputRef.current?.focus());
      } else if (cause instanceof ApiError && cause.code === 'username_taken') {
        setUsernameError(cause.message);
        window.requestAnimationFrame(() => usernameInputRef.current?.focus());
      } else setError(cause instanceof ApiError ? cause.message : 'The account could not be created.');
    }
    finally { setSaving(false); }
  }

  return <div className="management-page account-form-page"><div className="breadcrumbs"><Link to="/admin/users">Users</Link><span>/</span><span>Create account</span></div>
    <PageHeading title="Create account" subtitle="Set up a sign-in account and assign its platform role." action={<Link className="button button-secondary" to="/admin/users"><ArrowLeft size={16} aria-hidden="true" />Back to users</Link>} />
    <section className="account-form-card"><form className="form-stack" onSubmit={createAccount} aria-busy={saving}>
      {/* Keep required creation cues decorative so the accessible field names stay concise. */}
      <label><span className="form-label-row"><span>Email</span><small className="form-required-indicator" aria-hidden="true">Required</small></span><input ref={emailInputRef} name="email" required type="email" maxLength={254} autoComplete="email" aria-invalid={emailError ? true : undefined} aria-describedby={emailError ? accountEmailErrorId : undefined} autoFocus value={email} onChange={(event) => { setEmail(event.target.value); setEmailError(''); }} disabled={saving} /></label>
      {emailError && <p id={accountEmailErrorId} className="form-error" role="alert">{emailError}</p>}
      <div className="account-name-fields">
        <label><span className="form-label-row"><span>First name</span><small className="form-required-indicator" aria-hidden="true">Required</small></span><input ref={firstNameInputRef} name="firstName" required maxLength={MAX_ACCOUNT_NAME_LENGTH} autoComplete="given-name" aria-invalid={invalidNameField === 'firstName' || undefined} aria-describedby={invalidNameField === 'firstName' ? accountNameErrorId : undefined} value={firstName} onChange={(event) => { setFirstName(event.target.value); if (invalidNameField === 'firstName') { setInvalidNameField(null); setNameError(''); } }} disabled={saving} /></label>
        <label><span className="form-label-row"><span>Last name</span><small className="form-required-indicator" aria-hidden="true">Required</small></span><input ref={lastNameInputRef} name="lastName" required maxLength={MAX_ACCOUNT_NAME_LENGTH} autoComplete="family-name" aria-invalid={invalidNameField === 'lastName' || undefined} aria-describedby={invalidNameField === 'lastName' ? accountNameErrorId : undefined} value={lastName} onChange={(event) => { setLastName(event.target.value); if (invalidNameField === 'lastName') { setInvalidNameField(null); setNameError(''); } }} disabled={saving} /></label>
      </div>
      {nameError && <p id={accountNameErrorId} className="form-error" role="alert">{nameError}</p>}
      <label><span className="form-label-row"><span>Username</span><small className="form-required-indicator" aria-hidden="true">Required</small></span><input ref={usernameInputRef} name="username" required minLength={3} maxLength={32} pattern="[A-Za-z0-9_.-]+" autoComplete="username" autoCapitalize="none" spellCheck={false} aria-invalid={usernameError ? true : undefined} aria-describedby={usernameError ? accountUsernameErrorId : undefined} value={username} onChange={(event) => { setUsername(event.target.value); setUsernameError(''); }} disabled={saving} /><small>3–32 letters, numbers, dots, underscores, or hyphens.</small></label>
      {usernameError && <p id={accountUsernameErrorId} className="form-error" role="alert">{usernameError}</p>}
      <div className="account-form-role-field"><span>Platform role</span><AppSelect<Role> ariaLabel="Platform role" describedBy={roleHelpId} value={role} onChange={setRole} disabled={saving} options={ACCOUNT_ROLE_OPTIONS} /><small id={roleHelpId}>Choose administrator or moderator only when the person needs management access.</small></div>
      <PasswordField label="Password" name="password" required minLength={12} maxLength={256} autoComplete="new-password" value={password} onChange={(event) => { setPassword(event.target.value); setError((currentError) => clearPasswordConfirmationError(currentError)); }} disabled={saving} hint="Use at least 12 characters. You can reset it later from account details." />
      <PasswordField label="Confirm password" name="confirmPassword" inputRef={confirmPasswordInputRef} {...passwordConfirmationFieldProps(error, passwordConfirmationErrorId)} required minLength={12} maxLength={256} autoComplete="new-password" value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setError((currentError) => clearPasswordConfirmationError(currentError)); }} disabled={saving} />
      {error && <Notice id={passwordConfirmationErrorId}>{error}</Notice>}
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

export function AdminUserDetailsPage() {
  const { userId = '' } = useParams();
  const { user: signedInUser, refresh } = useAuth();
  const passwordInputId = `${useId().replaceAll(':', '')}-admin-reset-password`;
  const passwordHintId = `${passwordInputId}-hint`;
  const passwordConfirmationErrorId = `${passwordInputId}-confirmation-error`;
  const lastAdminHelpId = `${passwordInputId}-last-admin-help`;
  const accountEmailHelpId = `${passwordInputId}-account-email-help`;
  const certificateNameErrorId = `${passwordInputId}-certificate-name-error`;
  const accountEmailErrorId = `${passwordInputId}-account-email-error`;
  const routeUserIdRef = useRef(userId);
  const accountOverviewHeadingRef = useRef<HTMLHeadingElement>(null);
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
  const [accountEmail, setAccountEmail] = useState('');
  const [accountEmailUserId, setAccountEmailUserId] = useState('');
  const [accountEmailError, setAccountEmailError] = useState('');
  const [certificateNameError, setCertificateNameError] = useState('');
  const [invalidCertificateNameField, setInvalidCertificateNameField] = useState<'firstName' | 'lastName' | null>(null);
  const profileFirstNameInputRef = useRef<HTMLInputElement>(null);
  const profileLastNameInputRef = useRef<HTMLInputElement>(null);
  const accountEmailInputRef = useRef<HTMLInputElement>(null);
  const confirmPasswordInputRef = useRef<HTMLInputElement>(null);
  const [profileNamesUserId, setProfileNamesUserId] = useState('');
  const [pendingDisableAccountId, setPendingDisableAccountId] = useState<string | null>(null);

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
    setAccountEmail(account.user.email || '');
    setAccountEmailUserId(account.user.id);
    setProfileFirstName(account.user.firstName || '');
    setProfileLastName(account.user.lastName || '');
    setProfileNamesUserId(account.user.id);
  }, [account?.user.id, account?.user.email, account?.user.firstName, account?.user.lastName, userId]);
  useEffect(() => {
    setError(''); setSuccess(''); setSavingAction(null); setPassword(''); setConfirmPassword('');
    setAccountEmailError(''); setCertificateNameError(''); setInvalidCertificateNameField(null); setPendingDisableAccountId(null);
  }, [userId]);

  function clearAccountActionFeedback() {
    // The shared banner reports the previous action, so edits start a new attempt.
    setError('');
    setSuccess('');
  }

  async function updateAccount(changes: { role?: Role; disabled?: boolean; firstName?: string; lastName?: string; email?: string }, successMessage = 'Account settings were updated.', disableConfirmed = false) {
    if (!account || saving) return;
    if (changes.disabled === true && !disableConfirmed) { setPendingDisableAccountId(account.user.id); return; }
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
      if (changes.email !== undefined) setAccountEmail(response.user.email || '');
      if (signedInUser?.id === response.user.id && (signedInUser.role !== response.user.role || signedInUser.disabled !== response.user.disabled
        || signedInUser.firstName !== response.user.firstName || signedInUser.lastName !== response.user.lastName
        || signedInUser.email !== response.user.email)) {
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
        if (cause instanceof ApiError && cause.code === 'invalid_name'
          && (changes.firstName !== undefined || changes.lastName !== undefined)) {
          // Keep authoritative server validation beside the certificate-name field that needs correction.
          const invalidField = cause.message.startsWith('Last name') ? 'lastName' : 'firstName';
          setInvalidCertificateNameField(invalidField);
          setCertificateNameError(cause.message);
          window.requestAnimationFrame(() => (invalidField === 'lastName' ? profileLastNameInputRef.current : profileFirstNameInputRef.current)?.focus());
        } else if (cause instanceof ApiError && (cause.code === 'invalid_email' || cause.code === 'email_taken')
          && changes.email !== undefined) {
          setAccountEmailError(cause.message);
          window.requestAnimationFrame(() => accountEmailInputRef.current?.focus());
        } else setError(cause instanceof ApiError ? cause.message : 'Account settings could not be updated.');
      }
    }
    finally { if (isCurrentAction()) setSavingAction(null); }
  }

  async function saveAccountEmail(event: React.FormEvent) {
    event.preventDefault();
    setError(''); setSuccess(''); setAccountEmailError('');
    const emailError = validateEmail(accountEmail);
    if (emailError) {
      setAccountEmailError(emailError);
      window.requestAnimationFrame(() => accountEmailInputRef.current?.focus());
      return;
    }
    await updateAccount({ email: accountEmail.trim() }, 'Email address was updated.');
  }

  async function saveAccountName(event: React.FormEvent) {
    event.preventDefault();
    setError(''); setSuccess(''); setCertificateNameError(''); setInvalidCertificateNameField(null);
    const firstNameError = accountNameError(profileFirstName, 'First name');
    if (firstNameError) {
      setInvalidCertificateNameField('firstName');
      setCertificateNameError(firstNameError);
      window.requestAnimationFrame(() => profileFirstNameInputRef.current?.focus());
      return;
    }
    const lastNameError = accountNameError(profileLastName, 'Last name');
    if (lastNameError) {
      setInvalidCertificateNameField('lastName');
      setCertificateNameError(lastNameError);
      window.requestAnimationFrame(() => profileLastNameInputRef.current?.focus());
      return;
    }
    await updateAccount({
      firstName: normalizeAccountName(profileFirstName),
      lastName: normalizeAccountName(profileLastName),
    }, 'Certificate name was updated.');
  }

  async function approveRegistration(trigger: HTMLButtonElement) {
    if (!account || saving || account.user.registrationStatus !== 'pending') return;
    const shouldRestoreFocus = document.activeElement === trigger;
    const requestedUserId = account.user.id;
    const actionSequence = ++actionSequenceRef.current;
    const isCurrentAction = () => actionSequenceRef.current === actionSequence && routeUserIdRef.current === requestedUserId;
    setSavingAction('approval'); setError(''); setSuccess('');
    try {
      const result = await api.patch<{ user: User }>(`/api/admin/users/${requestedUserId}/approval`, {});
      if (!isCurrentAction()) return;
      requestPendingRegistrationCountRefresh();
      setAccount((current) => current && current.user.id === requestedUserId ? { ...current, user: { ...current.user, ...result.user } } : current);
      setSuccess(result.user.disabled
        ? `${result.user.username}'s registration was approved. The account is disabled, so enable it before they can sign in.`
        : `${result.user.username}'s registration was approved. They can now sign in.`);
      if (shouldRestoreFocus) window.requestAnimationFrame(() => {
        const heading = accountOverviewHeadingRef.current;
        const focusWasDropped = document.activeElement === document.body || document.activeElement === document.documentElement;
        // Approval removes its action once the status changes; return focus to the account context.
        if (!trigger.isConnected && focusWasDropped && heading?.isConnected) heading.focus();
      });
    } catch (cause) {
      if (isCurrentAction()) setError(cause instanceof ApiError ? cause.message : 'Registration could not be approved.');
    } finally { if (isCurrentAction()) setSavingAction(null); }
  }

  async function resetPassword(event: React.FormEvent) {
    event.preventDefault();
    if (!account || saving) return;
    const confirmationError = getPasswordConfirmationError(password, confirmPassword);
    if (confirmationError) { setError(confirmationError); setSuccess(''); confirmPasswordInputRef.current?.focus(); return; }
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
  if (!account) return <div className="management-page">{error && <div className="account-list-error"><Notice>{error}</Notice>{canRetryLoad && <Button type="button" variant="secondary" onClick={() => setLoadRetryVersion((version) => version + 1)}>Try again</Button>}</div>}<Link className="back-link" to="/admin/users"><ArrowLeft size={17} aria-hidden="true" />Back to users</Link></div>;
  const { user, courses, registrationFields } = account;
  const accountEmailReady = accountEmailUserId === user.id;
  const accountEmailChanged = accountEmailReady && accountEmail.trim() !== (user.email || '');
  const certificateNameReady = profileNamesUserId === user.id;
  const certificateNameChanged = certificateNameReady && (normalizeAccountName(profileFirstName) !== (user.firstName || '')
    || normalizeAccountName(profileLastName) !== (user.lastName || ''));
  return <div className="management-page account-details-page">
    <div className="breadcrumbs"><Link to="/admin/users">Users</Link><span>/</span><span>{user.username}</span></div>
    <PageHeading title={user.username} subtitle="Account controls, enrolled courses, and learning activity." action={<Link className="button button-secondary" to="/admin/users"><ArrowLeft size={16} aria-hidden="true" />Back to users</Link>} />
    {error && <Notice id={passwordConfirmationErrorId}>{error}</Notice>}{success && <Notice kind="success">{success}</Notice>}
    <section className="account-detail-grid">
      <article className="account-detail-card account-overview-card" aria-labelledby="account-overview-heading"><div className="account-detail-card-heading"><div className="access-user"><UserInitial username={user.username} /><div><strong>{user.username}</strong><h2 ref={accountOverviewHeadingRef} id="account-overview-heading" className="account-overview-title" tabIndex={-1}>Account overview</h2></div></div><span className={`account-state ${user.registrationStatus === 'pending' ? 'account-pending' : user.disabled ? 'account-disabled' : 'account-active'}`}><span />{user.registrationStatus === 'pending' ? 'Pending approval' : user.disabled ? 'Disabled' : 'Active'}</span></div>
        <form className="account-profile-form account-email-form form-stack" onSubmit={saveAccountEmail} noValidate aria-busy={savingAction === 'account'}>
          {/* Keep required account-detail cues decorative so native validation remains the accessible source of truth. */}
          <label><span className="form-label-row"><span>Email address</span><small className="form-required-indicator" aria-hidden="true">Required</small></span><input ref={accountEmailInputRef} name="email" type="email" required maxLength={254} autoComplete="email" aria-invalid={Boolean(accountEmailError) || undefined} aria-describedby={accountEmailError ? `${accountEmailHelpId} ${accountEmailErrorId}` : accountEmailHelpId} value={accountEmail} onChange={(event) => { setAccountEmail(event.target.value); setAccountEmailError(''); clearAccountActionFeedback(); }} disabled={saving} /></label>
          <small id={accountEmailHelpId}>New certificates use this address; issued certificates keep their saved email.</small>
          {accountEmailError && <p id={accountEmailErrorId} className="form-error" role="alert">{accountEmailError}</p>}
          <Button type="submit" variant="secondary" disabled={saving || !accountEmailReady || !accountEmailChanged}>{accountEmailReady ? 'Save email address' : 'Loading…'}</Button>
        </form>
        <dl className="account-meta-list"><div><dt>Registration approval</dt><dd>{user.registrationStatus === 'pending' ? 'Pending' : 'Approved'}</dd></div><div><dt>User ID</dt><dd>{user.id}</dd></div><div><dt>Created</dt><dd><DateText value={user.createdAt} /></dd></div><div><dt>Last login</dt><dd>{user.lastLoginAt ? <DateTimeText value={user.lastLoginAt} /> : 'Not recorded'}</dd></div><div><dt>Last updated</dt><dd><DateText value={user.updatedAt} /></dd></div><div><dt>Courses assigned or enrolled</dt><dd>{account.total}</dd></div></dl>
        <form className="account-profile-form form-stack" onSubmit={saveAccountName} aria-busy={savingAction === 'account'}>
          <div><h3>Certificate name</h3><p>Set the first and last name shown on this user’s certificates.</p></div>
          <div className="account-name-fields">
          <label><span className="form-label-row"><span>First name</span><small className="form-required-indicator" aria-hidden="true">Required</small></span><input ref={profileFirstNameInputRef} name="firstName" required maxLength={MAX_ACCOUNT_NAME_LENGTH} autoComplete="given-name" aria-invalid={invalidCertificateNameField === 'firstName' || undefined} aria-describedby={invalidCertificateNameField === 'firstName' ? certificateNameErrorId : undefined} value={profileFirstName} onChange={(event) => { setProfileFirstName(event.target.value); clearAccountActionFeedback(); if (invalidCertificateNameField === 'firstName') { setInvalidCertificateNameField(null); setCertificateNameError(''); } }} disabled={saving} /></label>
          <label><span className="form-label-row"><span>Last name</span><small className="form-required-indicator" aria-hidden="true">Required</small></span><input ref={profileLastNameInputRef} name="lastName" required maxLength={MAX_ACCOUNT_NAME_LENGTH} autoComplete="family-name" aria-invalid={invalidCertificateNameField === 'lastName' || undefined} aria-describedby={invalidCertificateNameField === 'lastName' ? certificateNameErrorId : undefined} value={profileLastName} onChange={(event) => { setProfileLastName(event.target.value); clearAccountActionFeedback(); if (invalidCertificateNameField === 'lastName') { setInvalidCertificateNameField(null); setCertificateNameError(''); } }} disabled={saving} /></label>
          </div>
          {certificateNameError && <p id={certificateNameErrorId} className="form-error" role="alert">{certificateNameError}</p>}
          <Button type="submit" variant="secondary" disabled={saving || !certificateNameReady || !certificateNameChanged}>{savingAction === 'account' ? 'Saving…' : !certificateNameReady ? 'Loading…' : certificateNameChanged ? 'Save certificate name' : 'No changes'}</Button>
        </form>
        {registrationFields.length > 0 && <section className="account-registration-fields"><h3>Registration details</h3><dl>{registrationFields.map((field) => <div key={field.id}><dt>{field.label}</dt><dd>{typeof field.value === 'boolean' ? field.value ? 'Yes' : 'No' : field.value || 'Not provided'}</dd></div>)}</dl></section>}
        <div className="account-control-row" aria-busy={savingAction === 'account'}>
          <div className="account-role-control"><span id="account-platform-role-label">Platform role</span><div className="account-role-select-control"><AppSelect<Role> controlId="account-platform-role" ariaLabel="Platform role" ariaLabelledBy="account-platform-role-label" describedBy={user.isLastActiveAdmin ? lastAdminHelpId : undefined} value={user.role} disabled={saving || user.isLastActiveAdmin} busy={saving} onChange={(role) => updateAccount({ role })} options={ACCOUNT_ROLE_OPTIONS} matchTriggerWidth /></div></div>
          {user.registrationStatus === 'pending' && <Button variant="secondary" onClick={(event) => approveRegistration(event.currentTarget)} disabled={saving} aria-busy={savingAction === 'approval'}>{savingAction === 'approval' ? 'Approving registration…' : 'Approve registration'}</Button>}
          <Button variant={user.disabled ? 'secondary' : 'danger'} onClick={() => updateAccount({ disabled: !user.disabled })} disabled={saving || user.isLastActiveAdmin} aria-describedby={user.isLastActiveAdmin ? lastAdminHelpId : undefined} aria-busy={savingAction === 'account'}>{savingAction === 'account' ? 'Saving account…' : user.disabled ? 'Enable account' : 'Disable account'}</Button>
          {savingAction && <span className="sr-only" role="status" aria-live="polite">{savingAction === 'approval' ? 'Approving registration…' : savingAction === 'account' ? 'Saving account settings…' : 'Resetting password…'}</span>}
        </div>
        {user.isLastActiveAdmin && <p className="account-admin-protection" id={lastAdminHelpId}>This is the only active administrator. Add another administrator before changing this account’s role or status.</p>}
      </article>
      <article className="account-detail-card"><div className="account-detail-card-heading"><div><h2>Reset password</h2><p>Set a new password and sign out existing sessions.</p></div></div><form className="form-stack account-password-form" onSubmit={resetPassword} aria-busy={savingAction === 'password'}><PasswordField label="New password" name="newPassword" id={passwordInputId} required minLength={12} maxLength={256} autoComplete="new-password" value={password} onChange={(event) => { setPassword(event.target.value); clearAccountActionFeedback(); }} disabled={saving} hint="Use at least 12 characters." hintId={passwordHintId} /><PasswordField label="Confirm password" name="confirmPassword" inputRef={confirmPasswordInputRef} {...passwordConfirmationFieldProps(error, passwordConfirmationErrorId)} required minLength={12} maxLength={256} autoComplete="new-password" value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); clearAccountActionFeedback(); }} disabled={saving} /><Button type="submit" disabled={saving} aria-busy={savingAction === 'password'}>{savingAction === 'password' ? 'Saving…' : 'Reset password'}</Button></form></article>
    </section>
    <section className="analytics-section account-courses-section"><div className="analytics-section-heading"><div><h2>Course activity</h2><p>Courses this account has enrolled in or been assigned.</p></div><span>{formatCountLabel(account.total, 'course', 'courses')}</span></div>
      {courses.length ? <div className="analytics-table-wrap" role="region" aria-label="Scrollable course activity" tabIndex={0}><p className="table-scroll-hint">Scroll horizontally to see all course activity columns.</p><table className="analytics-table"><caption className="sr-only">Account course activity</caption><thead><tr><th scope="col">Course</th><th scope="col">Assignment</th><th scope="col">Progress</th><th scope="col">Lessons</th><th scope="col">Quizzes</th><th scope="col">Completion</th><th scope="col">Dashboard</th></tr></thead><tbody>{courses.map((course) => <tr key={course.id}><th scope="row"><strong>{course.title}</strong><small><CourseStatus status={course.status} /></small></th><td>{accountCourseAssignmentLabel(course)}</td><td>{formatPercentage(course.progress)}</td><td>{course.completedLessons} / {course.lessonCount}</td><td>{course.quizCount}</td><td>{course.completed ? 'Completed' : course.progress ? 'In progress' : 'Not started'}</td><td><Link className="text-action" to={`/manage/courses/${course.id}/analytics`} aria-label={`Open dashboard for ${course.title}`}>Open dashboard</Link></td></tr>)}</tbody></table></div> : <EmptyState headingLevel={3} title="No course activity" detail="This account has not enrolled in or been assigned a course." />}
      {account.total > 0 && <LogPagination ariaLabel="Course activity pages" page={account.page} pageSize={account.pageSize} total={account.total} loading={loading} onChange={setPage} />}
    </section>
    {pendingDisableAccountId === user.id && user.id === userId && <ConfirmationDialog {...accountDisableConfirmation(user.username)} confirmLabel="Disable account" onCancel={() => setPendingDisableAccountId(null)} onConfirm={() => { const requestedUserId = pendingDisableAccountId; setPendingDisableAccountId(null); if (requestedUserId === user.id) void updateAccount({ disabled: true }, `${user.username}'s account was disabled.`, true); }} />}
  </div>;
}

export function AdminSettingsPage() {
  const [appVersion, setAppVersion] = useState('');
  const [appVersionError, setAppVersionError] = useState('');
  const { platformName, platformIcon, themePalette, connectionProtocol, registrationEnabled, registrationApprovalRequired, userLimit, setBranding, setPlatformAccessSettings } = useAuth();
  const platformNameErrorId = useId();
  const userLimitErrorId = useId();
  const platformNameInputRef = useRef<HTMLInputElement>(null);
  const userLimitInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(platformName);
  const [platformNameError, setPlatformNameError] = useState('');
  const [icon, setIcon] = useState<string | null>(platformIcon);
  const [iconEdited, setIconEdited] = useState(false);
  const [palette, setPalette] = useState<BrandingPalette>(themePalette);
  const [protocol, setProtocolState] = useState<ConnectionProtocol>(connectionProtocol);
  const [allowRegistration, setAllowRegistration] = useState(registrationEnabled);
  const [requireRegistrationApproval, setRequireRegistrationApproval] = useState(registrationApprovalRequired);
  const [userLimitValue, setUserLimitValue] = useState(String(userLimit));
  const [userLimitError, setUserLimitError] = useState('');
  const [registeredUserCount, setRegisteredUserCount] = useState<number | null>(null);
  const [registeredUserCountLoading, setRegisteredUserCountLoading] = useState(true);
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
  const [resetStatusError, setResetStatusError] = useState('');
  const [resetSuccess, setResetSuccess] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [resetStatusLoaded, setResetStatusLoaded] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetchAppVersion({ signal: controller.signal })
      .then((result) => setAppVersion(result.version))
      .catch((cause) => {
        if (!controller.signal.aborted) setAppVersionError(cause instanceof ApiError ? cause.message : 'Application version could not be loaded.');
      });
    return () => controller.abort();
  }, []);
  useEffect(() => { setName(platformName); setIcon(platformIcon); setIconEdited(false); setPalette(themePalette); setProtocolState(connectionProtocol); setAllowRegistration(registrationEnabled); setRequireRegistrationApproval(registrationApprovalRequired); setUserLimitValue(String(userLimit)); setUserLimitError(''); }, [platformName, platformIcon, themePalette, connectionProtocol, registrationEnabled, registrationApprovalRequired, userLimit]);
  function clearSettingsSuccess() {
    // A saved confirmation describes these values only until the next setting changes.
    setSuccess('');
  }
  function setProtocol(nextProtocol: ConnectionProtocol) {
    setProtocolState(nextProtocol);
    clearSettingsSuccess();
  }
  function refreshRegisteredUserCount() {
    // Reuse the existing request effect so refreshes share its abort and stale-response guards.
    setRegisteredUserCountRetryVersion((version) => version + 1);
  }
  useEffect(() => {
    let active = true;
    const revision = registeredUserCountRevisionRef.current;
    const controller = new AbortController();
    setRegisteredUserCountLoading(true);
    setRegisteredUserCountError('');
    registeredUserCountControllerRef.current = controller;
    api.get<{ registeredUserCount: number }>('/api/admin/settings', { signal: controller.signal })
      .then((result) => { if (active && revision === registeredUserCountRevisionRef.current) setRegisteredUserCount(result.registeredUserCount); })
      .catch((cause) => { if (active && revision === registeredUserCountRevisionRef.current) setRegisteredUserCountError(cause instanceof ApiError ? cause.message : 'Registered account count could not be loaded.'); })
      .finally(() => {
        if (registeredUserCountControllerRef.current === controller) {
          registeredUserCountControllerRef.current = null;
          setRegisteredUserCountLoading(false);
        }
      });
    return () => {
      active = false;
      controller.abort();
      if (registeredUserCountControllerRef.current === controller) registeredUserCountControllerRef.current = null;
    };
  }, [registeredUserCountRetryVersion]);
  // Another administrator can change reset state while this page is open; refresh it only in visible, idle pages.
  useEffect(() => {
    if (resetBusy) return;
    let active = true;
    let requestInFlight = false;
    let controller: AbortController | null = null;
    // Keep the destructive reset action disabled until this page has a fresh, trusted status.
    setResetStatusLoaded(false);
    async function refreshResetStatus() {
      // Focus and visibility events can coincide with an interval tick.
      if (!active || requestInFlight || document.visibilityState === 'hidden') return;
      requestInFlight = true;
      const requestController = new AbortController();
      controller = requestController;
      try {
        const result = await api.get<PlatformResetStatus>('/api/admin/platform-reset', { signal: requestController.signal });
        if (active) { setResetState(result); setResetStatusError(''); setResetStatusLoaded(true); }
      } catch (cause) {
        if (active && !requestController.signal.aborted) {
          setResetStatusLoaded(false);
          setResetStatusError(cause instanceof ApiError ? cause.message : 'Reset status could not be refreshed.');
        }
      } finally {
        requestInFlight = false;
        if (controller === requestController) controller = null;
      }
    }
    function refreshOnReturn() { void refreshResetStatus(); }
    refreshOnReturn();
    const intervalId = window.setInterval(refreshOnReturn, 5_000);
    window.addEventListener('focus', refreshOnReturn);
    document.addEventListener('visibilitychange', refreshOnReturn);
    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refreshOnReturn);
      document.removeEventListener('visibilitychange', refreshOnReturn);
      controller?.abort();
    };
  }, [resetBusy]);
  useEffect(() => {
    document.documentElement.dataset.palette = palette;
    return () => { document.documentElement.dataset.palette = themePalette; };
  }, [palette, themePalette]);
  function choosePalette(nextPalette: BrandingPalette) {
    setPalette(nextPalette);
    document.documentElement.dataset.palette = nextPalette;
    clearSettingsSuccess();
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(''); setSuccess(''); setPlatformNameError(''); setUserLimitError('');
    const currentPlatformNameError = platformNameValidationError(name);
    if (currentPlatformNameError) {
      setPlatformNameError(currentPlatformNameError);
      window.requestAnimationFrame(() => platformNameInputRef.current?.focus());
      return;
    }
    const normalizedName = normalizePlatformName(name);
    setSaving(true);
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
      setError(''); setRegisteredUserCountError(''); setRegisteredUserCountLoading(false); setName(result.platformName); setBranding(result.platformName, result.themePalette, result.platformIcon); setPlatformAccessSettings(result.connectionProtocol, result.registrationEnabled, result.registrationApprovalRequired, result.registrationAvailable, result.userLimit); setIconEdited(false); setRegisteredUserCount(result.registeredUserCount); setSuccess('Platform settings saved.');
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'invalid_platform_name') {
        setPlatformNameError(cause.message);
        window.requestAnimationFrame(() => platformNameInputRef.current?.focus());
      } else if (cause instanceof ApiError && cause.code === 'invalid_user_limit') {
        setUserLimitError(cause.message);
        window.requestAnimationFrame(() => userLimitInputRef.current?.focus());
      } else setError(cause instanceof ApiError ? cause.message : 'Settings could not be saved.');
    }
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
  // The server pauses settings writes during a reset, so keep these controls read-only until it clears.
  const platformSettingsDisabled = saving || resetBusy || resetState.pending;
  const parsedAccountLimit = Number(userLimitValue);
  const accountLimit = Number.isFinite(parsedAccountLimit) && parsedAccountLimit > 0 ? Math.floor(parsedAccountLimit) : 0;
  // The server blocks every new account at or above the configured cap.
  const accountLimitReached = accountLimit > 0 && registeredUserCount !== null && registeredUserCount >= accountLimit;
  const accountUsagePercent = accountLimit > 0 && registeredUserCount !== null
    ? Math.min(100, Math.round((registeredUserCount / accountLimit) * 100))
    : 0;
  return <div className="management-page settings-page"><PageHeading title="Settings" subtitle="Customize platform branding, connection security, and learner registration." /><AdminSettingsTabs />{error && <Notice>{error}</Notice>}{success && <Notice kind="success">{success}</Notice>}
    <form className="settings-card form-stack" onSubmit={submit} aria-busy={saving}>
      <fieldset className="settings-fields" aria-label="Platform settings" disabled={platformSettingsDisabled}>
      <div className="settings-card-heading"><span className="settings-icon" aria-hidden="true"><Settings2 size={19} /></span><div><h2>Platform identity</h2><p>Choose the brand learners see throughout the platform.</p></div></div>
      <label><span className="form-label-row"><span>Platform name</span><small className="form-required-indicator" aria-hidden="true">Required</small></span><input ref={platformNameInputRef} required minLength={MIN_PLATFORM_NAME_LENGTH} maxLength={MAX_PLATFORM_NAME_LENGTH} aria-invalid={platformNameError ? true : undefined} aria-describedby={platformNameError ? platformNameErrorId : undefined} value={name} onChange={(event) => { setName(event.target.value); setPlatformNameError(''); clearSettingsSuccess(); }} /></label>
      {platformNameError && <p id={platformNameErrorId} className="form-error" role="alert">{platformNameError}</p>}
      <PlatformIconPicker value={icon} onChange={(nextIcon) => { setIcon(nextIcon); setIconEdited(true); clearSettingsSuccess(); }} />
      <div className="branding-choice-field"><span className="branding-choice-label">Color palette</span><small>Preview a palette and save to apply it for everyone.</small><PalettePicker value={palette} onChange={choosePalette} /></div>
      <div className="settings-section-divider"><span>Connection and accounts</span></div>
      <div className="app-select-field"><span>Public connection protocol</span><AppSelect<ConnectionProtocol> ariaLabel="Public connection protocol" describedBy="protocol-help" value={protocol} onChange={setProtocol} options={CONNECTION_PROTOCOL_OPTIONS} /></div>
      <p id="protocol-help" className="protocol-help">Session cookies use the Secure attribute when requests reach OpenLearning over HTTPS. HTTPS requires a TLS certificate on this server or a reverse proxy. For TLS behind a proxy, set <code>TRUST_PROXY=true</code>. HTTP sessions are not encrypted in transit.{connectionProtocol === 'https' && protocol === 'http' && <span className="protocol-session-warning">If you then open the site over HTTP, browsers will not send the existing secure session cookie, so you will need to sign in again.</span>}</p>
      <label className="setup-toggle"><span><strong>Allow new registrations</strong><small>Let people create learner accounts from the sign-in page.</small></span><input type="checkbox" checked={allowRegistration} onChange={(event) => { setAllowRegistration(event.target.checked); clearSettingsSuccess(); }} /></label>
      <label className="setup-toggle"><span><strong>Require admin approval for new registrations</strong><small>New learners must be approved by an administrator before they can sign in or use the platform.</small></span><input type="checkbox" checked={requireRegistrationApproval} onChange={(event) => { setRequireRegistrationApproval(event.target.checked); clearSettingsSuccess(); }} /></label>
      <label><span className="form-label-row"><span>Maximum registered accounts</span><small className="form-required-indicator" aria-hidden="true">Required</small></span><input ref={userLimitInputRef} className="user-limit-input" type="number" min={0} max={1000000} step={1} required aria-invalid={userLimitError ? true : undefined} aria-describedby={userLimitError ? userLimitErrorId : undefined} value={userLimitValue} onChange={(event) => { setUserLimitValue(event.target.value); setUserLimitError(''); clearSettingsSuccess(); }} /><small>0 means no limit. The cap includes administrators, moderators, and learners.</small></label>
      {userLimitError && <p id={userLimitErrorId} className="form-error" role="alert">{userLimitError}</p>}
      {registeredUserCountError
        ? <div className="registered-count-recovery"><Notice>{registeredUserCountError}</Notice><Button type="button" variant="secondary" onClick={() => setRegisteredUserCountRetryVersion((version) => version + 1)}>Retry account count</Button></div>
        : <div className="registered-account-usage">
          {/* Keep the live region limited to changing status text, not the refresh control or progress bar. */}
          <div className="registered-count-status" role="status" aria-live="polite" aria-atomic="true">
            <span>{registeredUserCount === null ? 'Loading registered accounts…' : accountLimit > 0 ? `${registeredUserCount} of ${accountLimit} accounts registered` : `${registeredUserCount} registered accounts · no account cap`}</span>
            {accountLimit > 0 && registeredUserCount !== null && <strong>{accountUsagePercent}%</strong>}
          </div>
          {accountLimit > 0 && registeredUserCount !== null && <div className="account-usage-track" role="progressbar" aria-label="Registered account limit usage" aria-valuemin={0} aria-valuemax={accountLimit} aria-valuenow={Math.min(registeredUserCount, accountLimit)} aria-valuetext={`${registeredUserCount} of ${accountLimit} accounts registered`}>
            <span style={{ width: `${accountUsagePercent}%` }} />
          </div>}
          <Button type="button" variant="quiet" className="registered-count-refresh" aria-busy={registeredUserCountLoading} disabled={registeredUserCountLoading} onClick={refreshRegisteredUserCount}>{registeredUserCountLoading ? registeredUserCount === null ? 'Loading account count…' : 'Refreshing account count…' : 'Refresh account count'}</Button>
          {accountLimitReached && <p className="registered-count-limit-warning">The cap has no room for additional accounts. Increase it to create more.</p>}
        </div>}
      <div className="settings-card-footer"><span>Database and media paths remain managed through the server environment.</span><Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</Button></div>
      </fieldset>
    </form>
    <section className="settings-card app-version-card" aria-labelledby="app-version-heading">
      <div className="settings-card-heading"><span className="settings-icon" aria-hidden="true"><BookOpen size={19} /></span><div><h2 id="app-version-heading">Application version</h2><p>The version currently served by this installation.</p></div></div>
      {appVersionError ? <Notice>{appVersionError}</Notice> : <p className="app-version-value" role="status" aria-live="polite"><span>Current version</span><strong>{appVersion || 'Loading…'}</strong></p>}
      <small>Public version endpoint: <code>/api/version</code></small>
    </section>
    <section className="platform-reset-card" aria-labelledby="platform-reset-heading">
      <div className="platform-reset-heading"><span className="platform-reset-icon"><AlertTriangle size={19} aria-hidden="true" /></span><div><h2 id="platform-reset-heading">Reset platform</h2><p>Remove learning content and account data, then restore platform settings to their defaults.</p></div></div>
      <div className="platform-reset-content">
        {resetError && <Notice>{resetError}</Notice>}
        {resetStatusError && <Notice>{resetStatusError} The displayed reset status may be out of date.</Notice>}
        {resetSuccess && <Notice kind="success">{resetSuccess}</Notice>}
        {!resetState.pending && <>
          <p>This keeps your administrator account and the audit and system logs. Courses, course media, learner accounts, progress, certificates, paths, competencies, and custom registration fields will be removed.</p>
          <p>A full database and course-media backup will be created and verified before the final confirmation appears. The backup is retained under the server data directory.</p>
          <Button type="button" variant="danger" onClick={prepareReset} disabled={resetBusy || !resetStatusLoaded}>{resetBusy ? 'Preparing backup…' : 'Create backup and begin reset'}</Button>
        </>}
        {resetState.pending && resetState.phase === 'preparing' && <div className="platform-reset-pending" role="status" aria-live="polite"><strong>{resetState.confirmationId ? 'Creating and verifying your backup…' : 'Another administrator is creating and verifying a backup…'}</strong><span>Platform requests are paused until the administrator confirms or preparation ends.</span></div>}
        {resetState.pending && resetState.phase === 'ready' && resetState.confirmationId && <div className="platform-reset-confirmation">
          <div className="platform-reset-backup"><strong>Verified backup</strong><code>{resetState.backupLocation}</code><span>This backup will remain available even if you cancel the reset.</span></div>
          {/* Keep the phrase's native required state aligned with the destructive action gate. */}
          <label htmlFor="platform-reset-phrase"><span className="form-label-row"><span>Type RESET to confirm</span><small className="form-required-indicator" aria-hidden="true">Required</small></span><input id="platform-reset-phrase" required autoComplete="off" value={resetPhrase} onChange={(event) => setResetPhrase(event.target.value)} disabled={resetBusy} /></label>
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
    <NavLink to="/admin/settings/backups" className={({ isActive }) => isActive ? 'settings-tab active' : 'settings-tab'}>Backups</NavLink>
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
  const [savedFields, setSavedFields] = useState<RegistrationField[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [configurationWarning, setConfigurationWarning] = useState('');
  const [success, setSuccess] = useState('');
  const [retryVersion, setRetryVersion] = useState(0);
  const [invalidField, setInvalidField] = useState<ReturnType<typeof validateRegistrationFieldEditor>>(null);
  const hasUnsavedChanges = hasUnsavedRegistrationFieldChanges(fields, savedFields);
  const shouldBlockNavigation = useCallback<BlockerFunction>(({ currentLocation, nextLocation }) => {
    const locationChanged = currentLocation.pathname !== nextLocation.pathname
      || currentLocation.search !== nextLocation.search
      || currentLocation.hash !== nextLocation.hash;
    return locationChanged && (hasUnsavedChanges || saving);
  }, [hasUnsavedChanges, saving]);
  const navigationBlocker = useBlocker(shouldBlockNavigation);
  const preventUnsavedRegistrationFieldExit = useCallback((event: BeforeUnloadEvent) => {
    if (!hasUnsavedChanges && !saving) return;
    event.preventDefault();
    event.returnValue = '';
  }, [hasUnsavedChanges, saving]);
  useBeforeUnload(preventUnsavedRegistrationFieldExit);

  useEffect(() => {
    // If a save finishes while navigation is waiting, follow the route once the draft is persisted.
    if (navigationBlocker.state === 'blocked' && !hasUnsavedChanges && !saving) navigationBlocker.proceed();
  }, [navigationBlocker, hasUnsavedChanges, saving]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');
    api.get<{ fields: RegistrationField[]; configurationValid: boolean }>('/api/admin/registration-fields', { signal: controller.signal })
      .then((result) => { if (active) { setFields(result.fields); setSavedFields(result.fields); setConfigurationWarning(result.configurationValid ? '' : 'The saved registration form is invalid. Public signup is paused. Add replacement fields and save, or save with no fields to clear the custom questions.'); } })
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
      setSavedFields(result.fields);
      setConfigurationWarning('');
      setSuccess('Registration fields saved. New and future signups will use this form.');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Registration fields could not be saved.'); }
    finally { setSaving(false); }
  }

  return <div className="management-page settings-page"><PageHeading title="Settings" subtitle="Customize platform branding, connection security, and learner registration." /><AdminSettingsTabs />
    {navigationBlocker.state === 'blocked' && <ConfirmationDialog
      title={saving ? 'Registration save in progress' : 'Discard unsaved registration fields?'}
      description={saving ? 'Wait for the current save to finish before leaving this page.' : 'Your unsaved registration field changes will be lost if you leave this page.'}
      cancelLabel={saving ? 'Stay on page' : 'Keep editing'}
      confirmLabel={saving ? 'Saving…' : 'Discard changes'}
      confirmVariant={saving ? 'secondary' : 'danger'}
      confirmDisabled={saving}
      onCancel={() => navigationBlocker.reset()}
      onConfirm={() => navigationBlocker.proceed()}
    />}
    {loadError && !loading && <div className="registration-fields-page-notice"><Notice>{loadError}</Notice><Button type="button" variant="secondary" onClick={() => setRetryVersion((version) => version + 1)}>Try again</Button></div>}
    {success && <Notice kind="success">{success}</Notice>}
    {loading ? <div className="page-loading" role="status" aria-live="polite">Loading registration fields…</div> : !loadError && <form className="settings-card form-stack registration-fields-card" onSubmit={saveFields} aria-busy={saving}>
      <fieldset className="settings-fields" aria-label="Registration fields" disabled={saving}>
        <div className="settings-card-heading"><span className="settings-icon" aria-hidden="true"><UsersRound size={19} /></span><div><h2>Registration form</h2><p>Collect the information your organization needs when learners create an account.</p></div></div>
        {configurationWarning && <Notice>{configurationWarning}</Notice>}
        <p className="registration-fields-intro">These fields appear after email and username during public registration. Existing learner answers are kept if a field is changed or removed.</p>
        {fields.length ? <div className="registration-field-editor-list">{fields.map((field, index) => <section className="registration-field-editor" key={field.id} aria-labelledby={`registration-field-title-${field.id}`}>
          <div className="registration-field-editor-heading"><h3 id={`registration-field-title-${field.id}`}>Field {index + 1}</h3><Button type="button" variant="quiet" className="registration-field-remove" aria-label={`Remove ${field.label || `field ${index + 1}`}`} onClick={() => { setFields((current) => current.filter((item) => item.id !== field.id)); setError(''); setSuccess(''); setInvalidField(null); }}><Trash2 size={15} aria-hidden="true" />Remove</Button></div>
          <div className="registration-field-editor-grid">
            {/* These editor constraints mirror the server schema; keep their cues decorative. */}
            <label><span className="form-label-row"><span>Field label</span><small className="form-required-indicator" aria-hidden="true">Required</small></span><input id={`registration-field-editor-${field.id}-label`} required minLength={1} maxLength={80} value={field.label} aria-invalid={invalidField?.fieldId === field.id && invalidField.target === 'label' || undefined} aria-describedby={invalidField?.fieldId === field.id && invalidField.target === 'label' ? 'registration-fields-error' : undefined} onChange={(event) => updateField(field.id, { label: event.target.value })} placeholder="e.g. Department" /></label>
            <div className="app-select-field"><span>Field type</span><AppSelect<RegistrationFieldType> ariaLabel={`Field type for field ${index + 1}`} value={field.type} onChange={(type) => updateField(field.id, { type, options: type === 'select' ? (field.options.length >= 2 ? field.options : ['Option 1', 'Option 2']) : [] })} options={registrationFieldTypeOptions} /></div>
            <label className="registration-required-toggle"><input type="checkbox" checked={field.required} onChange={(event) => updateField(field.id, { required: event.target.checked })} /><span>Required for signup</span></label>
          </div>
          {field.type === 'select' && <label className="registration-options-field"><span className="form-label-row"><span>Options</span><small className="form-required-indicator" aria-hidden="true">Required</small></span><textarea id={`registration-field-editor-${field.id}-options`} required rows={4} value={field.options.join('\n')} aria-invalid={invalidField?.fieldId === field.id && invalidField.target === 'options' || undefined} aria-describedby={invalidField?.fieldId === field.id && invalidField.target === 'options' ? 'registration-fields-error' : undefined} onChange={(event) => updateField(field.id, { options: event.target.value.split('\n') })} placeholder={'One option per line\nDepartment A\nDepartment B'} /><small>Enter one choice per line, with 2–30 unique choices.</small></label>}
        </section>)}</div> : <EmptyState headingLevel={3} title="No custom fields yet" detail="Add fields such as department, date of birth, or an acknowledgement checkbox to the signup form." />}
        <div className="registration-fields-actions"><Button type="button" variant="secondary" onClick={addField} disabled={fields.length >= 30}><Plus size={16} aria-hidden="true" />Add field</Button><span>Choose from free text, date, select list, or checkbox. Up to 30 fields.</span></div>
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
  const formatted = formatApiTimestamp(value, logTimestampFormatter, value);
  const date = parseApiTimestamp(value);
  const valid = !Number.isNaN(date.getTime());
  return <time dateTime={valid ? date.toISOString() : undefined}>{formatted}</time>;
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

function LogPagination({ ariaLabel, page, pageSize, total, loading, onChange }: { ariaLabel: string; page: number; pageSize: number; total: number; loading: boolean; onChange: (page: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const first = total ? (page - 1) * pageSize + 1 : 0;
  const last = Math.min(page * pageSize, total);
  return <nav className="log-pagination" aria-label={ariaLabel}><span role="status" aria-live="polite" aria-atomic="true">Showing {first}–{last} of {total}</span><div><Button variant="secondary" disabled={loading || page <= 1} onClick={() => onChange(page - 1)}>Previous</Button><span>Page {page} of {totalPages}</span><Button variant="secondary" disabled={loading || page >= totalPages} onClick={() => onChange(page + 1)}>Next</Button></div></nav>;
}

function LogEmptyState({ message }: { message: string }) {
  return <div className="log-empty-content"><p>{message}</p></div>;
}

export function AdminAuditLogPage() {
  const requestSequenceRef = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
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
  const hasAppliedFilters = Boolean(appliedQuery || action);
  const hasEmptyResult = !loading && !failedRequest && entries.length === 0;

  function clearFilters() {
    setQuery('');
    setAppliedQuery('');
    setAction('');
    setPage(1);
    // The filter-row reset disappears after clearing, so return keyboard focus to search.
    searchInputRef.current?.focus();
  }

  // Apply the visible search draft whenever the action filter changes.
  function applyAuditFilterChange(nextAction: string) {
    const nextQuery = query.trim();
    setQuery(nextQuery);
    setAppliedQuery(nextQuery);
    setAction(nextAction);
    setPage(1);
  }
  // AppSelect revalidates its active option when the options reference changes.
  const actionFilterOptions = useMemo(() => buildAuditActionOptions(actions, action), [actions, action]);

  return <div className="management-page logs-page"><PageHeading title="Audit log" subtitle="Review account, course, and platform changes, including access and comment removals." action={<Button variant="secondary" onClick={() => setRefreshVersion((current) => current + 1)}>Refresh</Button>} />
    <div className="log-filters">
      <form role="search" aria-label="Search audit log" className="management-search" onSubmit={(event) => { event.preventDefault(); setPage(1); setAppliedQuery(query.trim()); }}>
        <Search size={18} aria-hidden="true" />
        <input ref={searchInputRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search changes" aria-label="Search audit log" maxLength={100} />
        <button type="submit">Search</button>
      </form>
      <div className="select-wrap role-filter log-role-filter">
        <span className="catalog-filter-label">Action</span>
        <AppSelect className="app-select--filter" ariaLabel="Filter by action" leadingIcon={<Filter size={16} />} value={action} onChange={applyAuditFilterChange} options={actionFilterOptions} />
      </div>
      {hasAppliedFilters && <Button type="button" variant="secondary" onClick={clearFilters}>Clear filters</Button>}
    </div>
    {error && <div className="log-list-error"><Notice>{error}</Notice><Button type="button" variant="secondary" onClick={() => setRefreshVersion((current) => current + 1)}>Try again</Button></div>}
    {hasEmptyResult && <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{emptyMessage}</p>}
    <div className="log-table-wrap" role="region" aria-label="Scrollable audit log" tabIndex={0}><p className="table-scroll-hint">Scroll horizontally to see all audit log columns.</p><table className="log-table" aria-busy={loading}><caption className="sr-only">Audit log entries</caption><thead><tr><th scope="col">When</th><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Change</th><th scope="col">Details</th></tr></thead><tbody>
      {failedRequest ? <tr><td colSpan={5} className="log-empty">Audit entries are unavailable until the request succeeds.</td></tr> : entries.map((entry) => <LogDetailsDisclosure key={entry.id} details={entry.details} label={entry.summary} columnCount={5}>{(toggle) => <tr><td><LogTimestamp value={entry.occurredAt} /></td><td>{entry.actorUsername}</td><td><span className="log-action">{entry.action.replaceAll('_', ' ')}</span></td><th scope="row"><strong>{entry.summary}</strong><small>{entry.entityType}{entry.entityId ? ` · ${entry.entityId}` : ''}</small></th><td>{toggle}</td></tr>}</LogDetailsDisclosure>)}
      {!loading && !failedRequest && !entries.length && <tr><td colSpan={5} className="log-empty"><LogEmptyState message={emptyMessage} /></td></tr>}
    </tbody></table>{loading && <div className="log-loading" role="status" aria-live="polite">Loading audit entries…</div>}</div>
    {!failedRequest && total > 0 && <LogPagination ariaLabel="Audit log pages" page={page} pageSize={pageSize} total={total} loading={loading} onChange={setPage} />}
  </div>;
}

export function AdminSystemLogPage() {
  const requestSequenceRef = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
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
  const hasAppliedFilters = Boolean(appliedQuery || level !== 'all');
  const hasEmptyResult = !loading && !failedRequest && entries.length === 0;

  function clearFilters() {
    setQuery('');
    setAppliedQuery('');
    setLevel('all');
    setPage(1);
    // The filter-row reset disappears after clearing, so return keyboard focus to search.
    searchInputRef.current?.focus();
  }

  // Apply the visible search draft whenever the severity filter changes.
  function applySystemFilterChange(nextLevel: string) {
    const nextQuery = query.trim();
    setQuery(nextQuery);
    setAppliedQuery(nextQuery);
    setLevel(nextLevel);
    setPage(1);
  }

  return <div className="management-page logs-page"><PageHeading title="System log" subtitle="Inspect server startup, runtime errors, and operational events." action={<Button variant="secondary" onClick={() => setRefreshVersion((current) => current + 1)}>Refresh</Button>} />
    <div className="log-filters">
      <form role="search" aria-label="Search system log" className="management-search" onSubmit={(event) => { event.preventDefault(); setPage(1); setAppliedQuery(query.trim()); }}>
        <Search size={18} aria-hidden="true" />
        <input ref={searchInputRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search system events" aria-label="Search system log" maxLength={100} />
        <button type="submit">Search</button>
      </form>
      <div className="select-wrap role-filter log-role-filter">
        <span className="catalog-filter-label">Severity</span>
        <AppSelect className="app-select--filter" ariaLabel="Filter by severity" leadingIcon={<Activity size={16} />} value={level} onChange={applySystemFilterChange} options={SYSTEM_LOG_LEVEL_OPTIONS} />
      </div>
      {hasAppliedFilters && <Button type="button" variant="secondary" onClick={clearFilters}>Clear filters</Button>}
    </div>
    {error && <div className="log-list-error"><Notice>{error}</Notice><Button type="button" variant="secondary" onClick={() => setRefreshVersion((current) => current + 1)}>Try again</Button></div>}
    {hasEmptyResult && <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{emptyMessage}</p>}
    <div className="log-table-wrap" role="region" aria-label="Scrollable system log" tabIndex={0}><p className="table-scroll-hint">Scroll horizontally to see all system log columns.</p><table className="log-table" aria-busy={loading}><caption className="sr-only">System log entries</caption><thead><tr><th scope="col">When</th><th scope="col">Level</th><th scope="col">Source</th><th scope="col">Event</th><th scope="col">Details</th></tr></thead><tbody>
      {failedRequest ? <tr><td colSpan={5} className="log-empty">System events are unavailable until the request succeeds.</td></tr> : entries.map((entry) => <LogDetailsDisclosure key={entry.id} details={entry.details} label={entry.message} columnCount={5}>{(toggle) => <tr><td><LogTimestamp value={entry.occurredAt} /></td><td><span className={`log-level log-level-${entry.level}`}>{entry.level}</span></td><td>{entry.source}</td><th scope="row"><strong>{entry.message}</strong></th><td>{toggle}</td></tr>}</LogDetailsDisclosure>)}
      {!loading && !failedRequest && !entries.length && <tr><td colSpan={5} className="log-empty"><LogEmptyState message={emptyMessage} /></td></tr>}
    </tbody></table>{loading && <div className="log-loading" role="status" aria-live="polite">Loading system events…</div>}</div>
    {!failedRequest && total > 0 && <LogPagination ariaLabel="System log pages" page={page} pageSize={pageSize} total={total} loading={loading} onChange={setPage} />}
  </div>;
}
