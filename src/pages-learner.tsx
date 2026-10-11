import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownUp, ArrowLeft, ArrowRight, Award, BookOpen, CalendarDays, Check, ChevronDown, CircleHelp, Clock3, Download, ExternalLink, FileText, Filter, Link2, LockKeyhole, Maximize, MessageSquare, Minimize, Pause, Play, Printer, RotateCcw, Search, Send, ThumbsDown, ThumbsUp, Trash2, Volume2, VolumeX } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, fetchCourse } from './api';
import { AppSelect, Button, ConfirmationDialog, CourseCard, CourseCover, CurriculumModule, EmptyState, ImageWithFallback, PageHeading, ProgressBar } from './components';
import { formatCountLabel } from './count-label';
import { courseCatalogCategoryOptions, courseCatalogParams, hasCourseCatalogFilters } from './course-catalog-filters';
import { formatLearningDeadlineDate, getLearningDeadlineStatus } from './learning-deadline';
import { nextCourseActivity, nextCourseActivityAfterLesson, shouldEnrollBeforeCourseActivity } from './course-navigation';
import { summarizeCourseProgress } from './course-progress';
import { shuffleQuizChoices } from './quiz-choice-order';
import { addLessonCommentToPage, getNewLessonComments } from './lesson-comments';
import { lessonCommentRemovalConfirmation } from './lesson-comment-confirmation';
import { tryToggleFullscreen } from './video-fullscreen';
import { selectVideoCaptionTrack } from './video-captions';
import { getVideoRecoveryStatusMessage, getVideoResumeTarget, getVideoWatchProgressDisplay, shouldResumeVideoPlayback, videoRecoveryMadeProgress } from './video-recovery';
import type { PendingVideoResume } from './video-recovery';
import { useAuth } from './auth-context';
import type { Course, CourseCertificate, CourseModule, LessonComment, LessonFeedback, LessonReaction, QuizAttempt, QuizAttemptPreview } from './types';

type CourseListResponse = { courses: Course[]; categories?: string[]; certificates?: CourseCertificate[]; certificatesTotal?: number; certificatesPage?: number; certificatesPageSize?: number; certificatesHasMore?: boolean; total?: number; page?: number; pageSize?: number; hasMore?: boolean };
type CertificateListResponse = { certificates: CourseCertificate[]; total: number; page: number; pageSize: number; hasMore: boolean };
type PendingCommentRemoval = { courseId: string; lessonId: string; commentId: string; username: string };

function hasQuizAttemptBreakdown(attempt: QuizAttempt | QuizAttemptPreview): attempt is QuizAttempt {
  return 'correctCount' in attempt && 'questionCount' in attempt;
}

function coursePageHasDrift(currentCourses: Course[], response: CourseListResponse, expectedTotal: number, expectedPage: number) {
  if (response.total !== undefined && response.total !== expectedTotal) return true;
  if (response.page !== undefined && response.page !== expectedPage) return true;
  const currentIds = new Set(currentCourses.map((course) => course.id));
  return response.courses.some((course) => currentIds.has(course.id));
}

const certificateHistoryDateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' });
const certificateIssueDateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeZone: 'UTC' });
const lessonCommentDateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function LearningDeadlineLink({ deadlineAt, completed }: { deadlineAt: string; completed: boolean }) {
  const status = getLearningDeadlineStatus(deadlineAt, completed);
  const label = status === 'completed' ? 'Completed' : status === 'overdue' ? 'Overdue' : 'Due';
  return <Link className={`learning-deadline ${status}`} to="/calendar"><CalendarDays size={15} /><span><strong>{label}</strong><small>{formatLearningDeadlineDate(deadlineAt)}</small></span></Link>;
}

type LessonWatchProgress = {
  lessonId: string;
  ready: boolean;
  required: boolean;
  started: boolean;
  complete: boolean;
  watchedUntilSeconds: number;
  lastPositionSeconds: number;
  durationSeconds: number;
};

function videoClock(seconds: number) {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function formatCertificateDate(value: string, formatter: Intl.DateTimeFormat) {
  const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? value : formatter.format(date);
}

function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className={`error-notice${onRetry ? ' error-notice-actionable' : ''}`} role="alert"><span>{message}</span>{onRetry && <Button variant="secondary" onClick={onRetry}>Try again</Button>}</div>;
}

export function CatalogPage() {
  const loadSequenceRef = useRef(0);
  const requestControllerRef = useRef<AbortController | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const filtersRef = useRef({ query: '', category: '', sort: 'recent' });
  const pageRef = useRef(1);
  const paginationStatusRef = useRef<HTMLParagraphElement>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState('recent');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);

  async function load(appliedFilters = { ...filtersRef.current, category, sort }) {
    const requestSequence = ++loadSequenceRef.current;
    requestControllerRef.current?.abort();
    const requestController = new AbortController();
    requestControllerRef.current = requestController;
    const filters = { ...appliedFilters };
    filtersRef.current = filters;
    pageRef.current = 1;
    setLoading(true); setError(''); setLoadMoreFailed(false);
    setLoadingMore(false); setHasMore(false); setCourses([]); setTotal(0);
    try {
      const params = courseCatalogParams(filters, 1);
      const result = await api.get<CourseListResponse>(`/api/courses?${params.toString()}`, { signal: requestController.signal });
      if (requestSequence === loadSequenceRef.current) {
        setCourses(result.courses); setCategories(result.categories || []);
        setTotal(result.total ?? result.courses.length); setHasMore(result.hasMore ?? false);
        pageRef.current = result.page ?? 1;
      }
    } catch (cause) {
      if (requestSequence === loadSequenceRef.current) setError(cause instanceof ApiError ? cause.message : 'Courses could not be loaded.');
    } finally {
      if (requestSequence === loadSequenceRef.current) { setLoading(false); requestControllerRef.current = null; }
    }
  }

  function retryLoad() {
    return load(filtersRef.current);
  }

  function clearCatalogFilters() {
    const defaults = { query: '', category: '', sort: 'recent' };
    filtersRef.current = defaults;
    setQuery('');
    searchInputRef.current?.focus();
    if (category === defaults.category && sort === defaults.sort) {
      void load(defaults);
      return;
    }
    setCategory(defaults.category);
    setSort(defaults.sort);
  }

  async function loadMore() {
    if (!hasMore || loading || loadingMore) return;
    const requestSequence = ++loadSequenceRef.current;
    requestControllerRef.current?.abort();
    const requestController = new AbortController();
    requestControllerRef.current = requestController;
    const requestedPage = pageRef.current + 1;
    setLoadingMore(true); setError(''); setLoadMoreFailed(false);
    try {
      const params = courseCatalogParams(filtersRef.current, requestedPage);
      const result = await api.get<CourseListResponse>(`/api/courses?${params.toString()}`, { signal: requestController.signal });
      if (requestSequence === loadSequenceRef.current) {
        if (coursePageHasDrift(courses, result, total, requestedPage)) {
          await load(filtersRef.current);
          return;
        }
        setCourses((current) => {
          const existingIds = new Set(current.map((course) => course.id));
          return [...current, ...result.courses.filter((course) => !existingIds.has(course.id))];
        });
        setTotal(result.total ?? total); setHasMore(result.hasMore ?? false);
        pageRef.current = result.page ?? requestedPage;
        if (!(result.hasMore ?? false)) requestAnimationFrame(() => paginationStatusRef.current?.focus());
      }
    } catch (cause) {
      if (requestSequence === loadSequenceRef.current) { setError(cause instanceof ApiError ? cause.message : 'More courses could not be loaded.'); setLoadMoreFailed(true); }
    } finally {
      if (requestSequence === loadSequenceRef.current) { setLoadingMore(false); requestControllerRef.current = null; }
    }
  }
  useEffect(() => {
    load();
    return () => {
      loadSequenceRef.current += 1;
      requestControllerRef.current?.abort();
      requestControllerRef.current = null;
    };
  }, [category, sort]);

  const hasAppliedFilters = hasCourseCatalogFilters(filtersRef.current);
  const emptyCatalogState = hasAppliedFilters
    ? { title: 'No matching courses', detail: 'Try a different search or category.' }
    : { title: 'No courses are available yet', detail: 'When courses are published for your learning space, they will appear here.' };
  const hasEmptyCatalogResult = !loading && !error && courses.length === 0;

  return <div className="catalog-page">
    <PageHeading title="Browse courses" subtitle="Find a course to build your skills." />
    <div className="catalog-tools">
      <div className="filter-controls">
        <div className="select-wrap catalog-filter-control"><span className="catalog-filter-label">Category</span><AppSelect className="app-select--filter" ariaLabel="Course category" leadingIcon={<Filter size={16} />} value={category} onChange={setCategory} options={courseCatalogCategoryOptions(categories)} /></div>
        <div className="select-wrap catalog-filter-control catalog-filter-control--sort"><span className="catalog-filter-label">Sort by</span><AppSelect className="app-select--filter" ariaLabel="Sort by" leadingIcon={<ArrowDownUp size={16} />} value={sort} onChange={setSort} options={[{ value: 'recent', label: 'Recently updated' }, { value: 'title', label: 'Course title' }]} /></div>
      </div>
      <form className="search-field" onSubmit={(event) => { event.preventDefault(); load({ query: query.trim(), category, sort }); }}>
        <Search size={19} /><input ref={searchInputRef} aria-label="Search courses" placeholder="Search courses" maxLength={120} value={query} onChange={(event) => setQuery(event.target.value)} /><button type="submit" aria-label="Submit search"><ArrowRight size={17} /></button>
      </form>
    </div>
    {error && <ErrorNotice message={error} onRetry={loadMoreFailed ? loadMore : retryLoad} />}
    {hasEmptyCatalogResult && <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{emptyCatalogState.title}. {emptyCatalogState.detail}</p>}
    {loading ? <div className="page-loading" role="status" aria-live="polite">Loading courses…</div> : courses.length ? <div className="course-grid">{courses.map((course, index) => <CourseCard key={course.id} course={course} coverLoading={index === 0 ? 'eager' : 'lazy'} />)}</div> : error ? null : <EmptyState icon={<Filter size={24} />} title={emptyCatalogState.title} detail={emptyCatalogState.detail} action={hasAppliedFilters && <Button variant="secondary" onClick={clearCatalogFilters}>Clear search and filters</Button>} />}
    {!loading && courses.length > 0 && <div className="catalog-pagination"><p ref={paginationStatusRef} tabIndex={-1} role="status" aria-live="polite">Showing {courses.length} of {formatCountLabel(total, 'course', 'courses')}</p><p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{loadingMore ? 'Loading more courses…' : ''}</p>{hasMore && <Button variant="secondary" disabled={loadingMore} onClick={loadMore}>{loadingMore ? 'Loading more courses…' : 'Load more courses'}</Button>}</div>}
  </div>;
}

export function MyLearningPage() {
  const { user } = useAuth();
  const loadSequenceRef = useRef(0);
  const certificateLoadSequenceRef = useRef(0);
  const courseRequestControllerRef = useRef<AbortController | null>(null);
  const certificateRequestControllerRef = useRef<AbortController | null>(null);
  const pageRef = useRef(1);
  const paginationStatusRef = useRef<HTMLParagraphElement>(null);
  const certificatePaginationStatusRef = useRef<HTMLParagraphElement>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [certificates, setCertificates] = useState<CourseCertificate[]>([]);
  const [certificateTotal, setCertificateTotal] = useState(0);
  const [certificatePage, setCertificatePage] = useState(1);
  const [certificatesHasMore, setCertificatesHasMore] = useState(false);
  const [loadingCertificates, setLoadingCertificates] = useState(true);
  const [loadingMoreCertificates, setLoadingMoreCertificates] = useState(false);
  const [certificateError, setCertificateError] = useState('');
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [courseLoadMoreFailed, setCourseLoadMoreFailed] = useState(false);
  async function loadCertificatesFirstPage() {
    const requestSequence = ++certificateLoadSequenceRef.current;
    certificateRequestControllerRef.current?.abort();
    const requestController = new AbortController();
    certificateRequestControllerRef.current = requestController;
    setLoadingCertificates(true); setCertificateError(''); setCertificates([]);
    setCertificateTotal(0); setCertificatePage(1); setCertificatesHasMore(false);
    try {
      const result = await api.get<CertificateListResponse>('/api/my-learning/certificates?page=1', { signal: requestController.signal });
      if (requestSequence === certificateLoadSequenceRef.current) {
        setCertificates(result.certificates);
        setCertificateTotal(result.total); setCertificatePage(result.page); setCertificatesHasMore(result.hasMore);
      }
    } catch (cause) {
      if (requestSequence === certificateLoadSequenceRef.current) setCertificateError(cause instanceof ApiError ? cause.message : 'Your certificates could not be loaded.');
    } finally {
      if (requestSequence === certificateLoadSequenceRef.current) {
        setLoadingCertificates(false);
        if (certificateRequestControllerRef.current === requestController) certificateRequestControllerRef.current = null;
      }
    }
  }
  async function load() {
    const requestSequence = ++loadSequenceRef.current;
    certificateLoadSequenceRef.current += 1;
    courseRequestControllerRef.current?.abort();
    certificateRequestControllerRef.current?.abort();
    certificateRequestControllerRef.current = null;
    const requestController = new AbortController();
    courseRequestControllerRef.current = requestController;
    pageRef.current = 1;
    setLoading(true); setError(''); setCertificateError(''); setCourseLoadMoreFailed(false);
    setCourses([]); setCertificates([]);
    setLoadingCertificates(true); setLoadingMore(false); setLoadingMoreCertificates(false); setHasMore(false); setCertificatesHasMore(false); setTotal(0); setCertificateTotal(0);
    void loadCertificatesFirstPage();
    try {
      const result = await api.get<CourseListResponse>('/api/my-learning?page=1&includeCertificates=0', { signal: requestController.signal });
      if (requestSequence === loadSequenceRef.current) {
        setCourses(result.courses);
        setTotal(result.total ?? result.courses.length); setHasMore(result.hasMore ?? false);
        pageRef.current = result.page ?? 1;
      }
    } catch (cause) {
      if (requestSequence === loadSequenceRef.current) setError(cause instanceof ApiError ? cause.message : 'Your courses could not be loaded.');
    } finally {
      if (requestSequence === loadSequenceRef.current) {
        setLoading(false);
        if (courseRequestControllerRef.current === requestController) courseRequestControllerRef.current = null;
      }
    }
  }
  async function loadMore() {
    if (!hasMore || loading || loadingMore) return;
    const requestSequence = ++loadSequenceRef.current;
    courseRequestControllerRef.current?.abort();
    const requestController = new AbortController();
    courseRequestControllerRef.current = requestController;
    const requestedPage = pageRef.current + 1;
    setLoadingMore(true); setError(''); setCourseLoadMoreFailed(false);
    try {
      const result = await api.get<CourseListResponse>(`/api/my-learning?page=${requestedPage}&includeCertificates=0`, { signal: requestController.signal });
      if (requestSequence === loadSequenceRef.current) {
        if (coursePageHasDrift(courses, result, total, requestedPage)) {
          await load();
          return;
        }
        setCourses((current) => {
          const existingIds = new Set(current.map((course) => course.id));
          return [...current, ...result.courses.filter((course) => !existingIds.has(course.id))];
        });
        setTotal(result.total ?? total); setHasMore(result.hasMore ?? false);
        pageRef.current = result.page ?? requestedPage;
        if (!(result.hasMore ?? false)) requestAnimationFrame(() => paginationStatusRef.current?.focus());
      }
    } catch (cause) {
      if (requestSequence === loadSequenceRef.current) { setError(cause instanceof ApiError ? cause.message : 'More courses could not be loaded.'); setCourseLoadMoreFailed(true); }
    } finally {
      if (requestSequence === loadSequenceRef.current) {
        setLoadingMore(false);
        if (courseRequestControllerRef.current === requestController) courseRequestControllerRef.current = null;
      }
    }
  }
  async function loadMoreCertificates() {
    if (!certificatesHasMore || loading || loadingCertificates || loadingMoreCertificates) return;
    const requestSequence = ++certificateLoadSequenceRef.current;
    certificateRequestControllerRef.current?.abort();
    const requestController = new AbortController();
    certificateRequestControllerRef.current = requestController;
    const requestedPage = certificatePage + 1;
    setLoadingMoreCertificates(true); setCertificateError('');
    try {
      const result = await api.get<CertificateListResponse>(`/api/my-learning/certificates?page=${requestedPage}`, { signal: requestController.signal });
      if (requestSequence !== certificateLoadSequenceRef.current) return;
      if (result.total !== certificateTotal || result.page !== requestedPage) {
        const refreshed = await api.get<CertificateListResponse>('/api/my-learning/certificates?page=1', { signal: requestController.signal });
        if (requestSequence === certificateLoadSequenceRef.current) {
          setCertificates(refreshed.certificates);
          setCertificateTotal(refreshed.total); setCertificatePage(refreshed.page); setCertificatesHasMore(refreshed.hasMore);
        }
        return;
      }
      setCertificates((current) => {
        const existingIds = new Set(current.map((certificate) => certificate.id));
        return [...current, ...result.certificates.filter((certificate) => !existingIds.has(certificate.id))];
      });
      setCertificateTotal(result.total); setCertificatePage(result.page); setCertificatesHasMore(result.hasMore);
      if (!result.hasMore) requestAnimationFrame(() => certificatePaginationStatusRef.current?.focus());
    } catch (cause) {
      if (requestSequence === certificateLoadSequenceRef.current) setCertificateError(cause instanceof ApiError ? cause.message : 'More certificates could not be loaded.');
    } finally {
      if (requestSequence === certificateLoadSequenceRef.current) {
        setLoadingMoreCertificates(false);
        if (certificateRequestControllerRef.current === requestController) certificateRequestControllerRef.current = null;
      }
    }
  }
  useEffect(() => {
    load();
    return () => {
      loadSequenceRef.current += 1; certificateLoadSequenceRef.current += 1;
      courseRequestControllerRef.current?.abort(); certificateRequestControllerRef.current?.abort();
      courseRequestControllerRef.current = null; certificateRequestControllerRef.current = null;
    };
  }, []);
  const learningEmptyState = { title: 'Your learning starts here', detail: 'Open a course from the catalog to add it to your learning list.' };
  const hasEmptyCourses = !loading && !error && courses.length === 0;
  const hasEmptyLearning = hasEmptyCourses && !loadingCertificates && !certificateError && certificates.length === 0;
  return <div className="catalog-page my-learning-page">
    <PageHeading title="My learning" subtitle="Pick up where you left off." />
    {error && <ErrorNotice message={error} onRetry={courseLoadMoreFailed ? loadMore : load} />}
    {hasEmptyLearning && <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{learningEmptyState.title}. {learningEmptyState.detail}</p>}
    {loading ? <div className="page-loading" role="status" aria-live="polite">Loading your courses…</div> : courses.length ? <div className="course-grid">{courses.map((course, index) => <div className="my-learning-card" key={course.id}><CourseCard course={course} continueLabel coverLoading={index === 0 ? 'eager' : 'lazy'} />{user?.role === 'learner' && course.deadlineAt && <LearningDeadlineLink deadlineAt={course.deadlineAt} completed={course.completed} />}{user?.role === 'learner' && course.completed && (user.firstName?.trim() && user.lastName?.trim() ? <Link className="certificate-card-link" to={`/my-learning/certificates/${course.id}`}><Award size={16} />View certificate</Link> : <Link className="certificate-card-link" to="/account/security"><Award size={16} />Add your name for certificate</Link>)}</div>)}</div> : hasEmptyCourses && !certificates.length && <EmptyState title={learningEmptyState.title} detail={learningEmptyState.detail} action={<Link className="button button-primary" to="/courses">Browse courses</Link>} />}
    {!loading && courses.length > 0 && <div className="catalog-pagination"><p ref={paginationStatusRef} tabIndex={-1} role="status" aria-live="polite">Showing {courses.length} of {formatCountLabel(total, 'course', 'courses')}</p><p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{loadingMore ? 'Loading more courses…' : ''}</p>{hasMore && <Button variant="secondary" disabled={loadingMore} onClick={loadMore}>{loadingMore ? 'Loading more courses…' : 'Load more courses'}</Button>}</div>}
    {(loadingCertificates || certificateError || certificates.length > 0) && <section className="certificate-history"><div className="certificate-history-heading"><h2>Your certificates</h2><p>Certificates remain available in your learning history.</p></div>
      {loadingCertificates && <p className="page-loading" role="status" aria-live="polite">Loading certificates…</p>}
      {certificates.length > 0 && <div className="certificate-history-list">{certificates.map((certificate) => <article className="certificate-history-item" key={certificate.id}><span className="certificate-history-icon"><Award size={19} /></span><div className="certificate-history-copy"><h3>{certificate.courseTitle}</h3><p>Awarded {formatCertificateDate(certificate.issuedAt, certificateHistoryDateFormatter)} · {certificate.certificateCode}</p></div><Link className="button button-secondary" to={`/my-learning/certificates/${certificate.id}`}>View certificate</Link></article>)}</div>}
      {certificateError && <ErrorNotice message={certificateError} onRetry={certificatesHasMore && certificates.length > 0 ? loadMoreCertificates : loadCertificatesFirstPage} />}
      {certificates.length > 0 && <div className="catalog-pagination"><p ref={certificatePaginationStatusRef} tabIndex={-1} role="status" aria-live="polite">Showing {certificates.length} of {formatCountLabel(certificateTotal, 'certificate', 'certificates')}</p><p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{loadingMoreCertificates ? 'Loading more certificates…' : ''}</p>{certificatesHasMore && <Button variant="secondary" disabled={loadingCertificates || loadingMoreCertificates} onClick={loadMoreCertificates}>{loadingMoreCertificates ? 'Loading more certificates…' : 'Load more certificates'}</Button>}</div>}
    </section>}
  </div>;
}

export function CourseCertificatePage() {
  const { courseId: certificateRef = '' } = useParams();
  const { platformName, platformIcon } = useAuth();
  const requestSequenceRef = useRef(0);
  const [certificate, setCertificate] = useState<CourseCertificate | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    const requestSequence = ++requestSequenceRef.current;
    const requestController = new AbortController();
    setCertificate(null); setError(''); setLoading(true);
    api.get<{ certificate: CourseCertificate }>(`/api/certificates/${certificateRef}`, { signal: requestController.signal }).then((result) => {
      if (requestSequence === requestSequenceRef.current) setCertificate(result.certificate);
    }).catch((cause) => {
      if (requestSequence === requestSequenceRef.current) setError(cause instanceof ApiError ? cause.message : 'Your certificate could not be loaded.');
    }).finally(() => {
      if (requestSequence === requestSequenceRef.current) setLoading(false);
    });
    return () => { requestSequenceRef.current += 1; requestController.abort(); };
  }, [certificateRef, refreshVersion]);

  if (loading) return <div className="page-loading" role="status" aria-live="polite">Preparing your certificate…</div>;
  if (!certificate) return <div className="certificate-page"><div className="breadcrumbs"><Link to="/my-learning">My learning</Link><span>/</span><span>Certificate</span></div>{error && <ErrorNotice message={error} onRetry={() => setRefreshVersion((version) => version + 1)} />}<Link className="back-link" to="/my-learning"><ArrowLeft size={17} />Back to my learning</Link></div>;

  const formattedDate = formatCertificateDate(certificate.issuedAt, certificateIssueDateFormatter);
  return <div className="certificate-page">
    <div className="certificate-page-heading"><div><div className="breadcrumbs"><Link to="/my-learning">My learning</Link><span>/</span><span>Certificate</span></div><h1>Your achievement</h1><p>A certificate to recognize the knowledge you have gained.</p></div><div className="certificate-actions"><Button variant="secondary" onClick={() => window.print()}><Printer size={17} />Print or save as PDF</Button></div></div>
    <article className="certificate-paper" aria-label={`Certificate awarded to ${certificate.recipientName} for ${certificate.courseTitle}`}>
      <div className="certificate-inner-border" aria-hidden="true" />
      <div className="certificate-brand"><ImageWithFallback src={platformIcon} className="certificate-brand-image" alt="" fallback={<span className="certificate-brand-mark"><Award size={22} /></span>} /><span>{certificate.platformName || platformName}</span></div>
      <div className="certificate-kicker">Certificate of completion</div>
      <p className="certificate-intro">This certificate recognizes</p>
      <h2 className="certificate-recipient">{certificate.recipientName}</h2>
      {certificate.recipientEmail && <p className="certificate-recipient-email">{certificate.recipientEmail}</p>}
      <p className="certificate-description">for successfully completing</p>
      <h3 className="certificate-course-title">{certificate.courseTitle}</h3>
      <div className="certificate-footer"><div><span className="certificate-label">Awarded on</span><strong>{formattedDate}</strong></div><div className="certificate-seal"><Award size={25} /><span>Completed</span></div><div className="certificate-code"><span className="certificate-label">Certificate ID</span><strong>{certificate.certificateCode}</strong></div></div>
    </article>
    <Link className="back-link certificate-back" to="/my-learning"><ArrowLeft size={17} />Back to my learning</Link>
  </div>;
}

export function CourseOverviewPage() {
  const { courseId = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const loadSequenceRef = useRef(0);
  const courseRequestControllerRef = useRef<AbortController | null>(null);
  const enrollmentSequenceRef = useRef(0);
  const routeCourseIdRef = useRef(courseId);
  routeCourseIdRef.current = courseId;
  const [course, setCourse] = useState<Course | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [loadRetryVersion, setLoadRetryVersion] = useState(0);
  useEffect(() => {
    const requestSequence = ++loadSequenceRef.current;
    const requestController = new AbortController();
    courseRequestControllerRef.current?.abort();
    courseRequestControllerRef.current = requestController;
    setCourse(null); setError(''); setLoading(true); setStarting(false);
    fetchCourse(courseId, false, { signal: requestController.signal }).then((result) => {
      if (requestSequence === loadSequenceRef.current && routeCourseIdRef.current === courseId) setCourse(result.course);
    }).catch((cause) => {
      if (requestSequence === loadSequenceRef.current && routeCourseIdRef.current === courseId) setError(cause instanceof ApiError ? cause.message : 'This course could not be loaded.');
    }).finally(() => {
      if (requestSequence === loadSequenceRef.current && routeCourseIdRef.current === courseId) setLoading(false);
      if (courseRequestControllerRef.current === requestController) courseRequestControllerRef.current = null;
    });
    return () => {
      loadSequenceRef.current += 1; enrollmentSequenceRef.current += 1;
      requestController.abort();
      if (courseRequestControllerRef.current === requestController) courseRequestControllerRef.current = null;
    };
  }, [courseId, loadRetryVersion]);

  async function startLearning() {
    if (!course || course.id !== courseId || starting) return;
    const requestedCourse = course;
    const requestedCourseId = courseId;
    const requestSequence = ++enrollmentSequenceRef.current;
    const isCurrentRequest = () => requestSequence === enrollmentSequenceRef.current && routeCourseIdRef.current === requestedCourseId;
    setStarting(true); setError('');
    try {
      if (shouldEnrollBeforeCourseActivity(user?.role)) await api.post(`/api/courses/${requestedCourseId}/enroll`);
      if (!isCurrentRequest()) return;
      const activity = nextCourseActivity(requestedCourse.modules);
      if (activity?.type === 'lesson') navigate(`/courses/${requestedCourseId}/learn/${activity.id}`);
      else if (activity?.type === 'quiz') navigate(`/courses/${requestedCourseId}/quiz/${activity.id}`);
      else setError('This course does not have any lessons yet.');
    } catch (cause) {
      if (isCurrentRequest()) setError(cause instanceof ApiError ? cause.message : 'Course access could not be started.');
    } finally {
      if (isCurrentRequest()) setStarting(false);
    }
  }

  async function openCurriculumActivity(href: string) {
    if (!course || course.id !== courseId || starting) return;
    const requestedCourseId = courseId;
    const requestSequence = ++enrollmentSequenceRef.current;
    const isCurrentRequest = () => requestSequence === enrollmentSequenceRef.current && routeCourseIdRef.current === requestedCourseId;
    setStarting(true); setError('');
    try {
      if (shouldEnrollBeforeCourseActivity(user?.role)) await api.post(`/api/courses/${requestedCourseId}/enroll`);
      if (isCurrentRequest()) navigate(href);
    } catch (cause) {
      if (isCurrentRequest()) setError(cause instanceof ApiError ? cause.message : 'Course access could not be started.');
    } finally {
      if (isCurrentRequest()) setStarting(false);
    }
  }

  if (loading || (course && course.id !== courseId)) return <div className="page-loading" role="status" aria-live="polite">Loading course…</div>;
  if (!course) return <div className="narrow-content">{error && <ErrorNotice message={error} onRetry={() => setLoadRetryVersion((version) => version + 1)} />}<Link className="back-link" to="/courses"><ArrowLeft size={17} />Back to courses</Link></div>;
  const nextActivity = nextCourseActivity(course.modules);
  const startButtonLabel = starting ? 'Starting…'
    : nextActivity?.type === 'quiz'
      ? course.progress > 0 ? 'Continue to quiz' : 'Start quiz'
      : course.progress > 0 ? 'Continue learning' : 'Start learning';
  return <div className="course-overview">
    <div className="breadcrumbs"><Link to="/courses">Browse courses</Link><span>/</span><span>{course.title}</span></div>
    {error && <ErrorNotice message={error} />}
    <section className="course-hero">
      <div className="course-hero-copy">
        <span className="category-label">{course.category}</span>
        <h1>{course.title}</h1>
        {course.description ? <p className="course-hero-description" aria-hidden="true">{course.description}</p> : null}
        <div className="course-hero-meta"><span><BookOpen size={17} />{formatCountLabel(course.moduleCount, 'module', 'modules')}</span><span><Play size={15} />{formatCountLabel(course.lessonCount, 'lesson', 'lessons')}</span></div>
        <div className="course-hero-actions">
          <Button onClick={startLearning} disabled={!nextActivity || starting}>{startButtonLabel}<ArrowRight size={17} /></Button>
          {user?.role === 'learner' && course.completed ? user.firstName?.trim() && user.lastName?.trim() ? <Link className="button button-secondary" to={`/my-learning/certificates/${course.id}`}><Award size={17} />View certificate</Link> : <Link className="button button-secondary" to="/account/security"><Award size={17} />Add name for certificate</Link> : course.progress > 0 && <span className="progress-caption">{course.progress}% complete</span>}
        </div>
      </div>
      <CourseCover course={course} className="course-hero-cover" />
    </section>
    <section className="course-overview-body">
      <div className="course-description-block"><h2>About this course</h2><p>{course.description || 'Explore the lessons and practical knowledge in this course.'}</p></div>
      <div className="course-curriculum-block">
        <div className="section-heading-row"><div><h2>Course content</h2><p>{formatCountLabel(course.moduleCount, 'module', 'modules')} <span>·</span> {formatCountLabel(course.lessonCount, 'lesson', 'lessons')}</p></div>{course.progress > 0 && <div className="course-progress-summary"><span>{course.completedLessons} of {formatCountLabel(course.lessonCount, 'lesson', 'lessons')} complete</span><ProgressBar value={course.progress} label={`Course progress for ${course.title}`} /></div>}</div>
        {course.modules?.map((module) => <CurriculumModule key={module.id} module={module} courseId={course.id} onOpenActivity={openCurriculumActivity} />)}
      </div>
    </section>
    <div className="course-bottom-cta"><span>{user?.username ? `Ready when you are, ${user.username}.` : 'Ready when you are.'}</span><Button onClick={startLearning} disabled={!nextActivity || starting}>{startButtonLabel}<ArrowRight size={17} /></Button></div>
  </div>;
}

function orderedLessons(modules: CourseModule[]) {
  return modules.flatMap((module) => module.lessons.map((lesson) => ({ ...lesson, moduleTitle: module.title })));
}

export function CoursePlayerPage() {
  const { courseId = '', lessonId = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isCourseManager = user?.role === 'admin' || user?.role === 'moderator';
  const canViewLessonFeedback = user?.role === 'learner' || isCourseManager;
  const loadSequenceRef = useRef(0);
  const courseRequestControllerRef = useRef<AbortController | null>(null);
  const coursePageActiveRef = useRef(false);
  const routeCourseIdRef = useRef(courseId);
  routeCourseIdRef.current = courseId;
  const routeLessonIdRef = useRef(lessonId);
  routeLessonIdRef.current = lessonId;
  const feedbackSequenceRef = useRef(0);
  const commentPageSequenceRef = useRef(0);
  const commentPageControllerRef = useRef<AbortController | null>(null);
  const completionSequenceRef = useRef(0);
  const curriculumNavigationInFlightRef = useRef(false);
  const previousLessonRouteRef = useRef(`${courseId}:${lessonId}`);
  const [course, setCourse] = useState<Course | null>(null);
  const [availableCertificate, setAvailableCertificate] = useState<CourseCertificate | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [courseLoadRetryVersion, setCourseLoadRetryVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  const [videoError, setVideoError] = useState(false);
  const [fullscreenError, setFullscreenError] = useState('');
  const [videoFullscreen, setVideoFullscreen] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [videoMuted, setVideoMuted] = useState(false);
  const [videoVolume, setVideoVolume] = useState(1);
  const [selectedCaptionId, setSelectedCaptionId] = useState('');
  const [videoPosition, setVideoPosition] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoBuffering, setVideoBuffering] = useState(false);
  const [videoRecovering, setVideoRecovering] = useState(false);
  const [videoStalled, setVideoStalled] = useState(false);
  const [watchProgress, setWatchProgress] = useState<LessonWatchProgress>({
    lessonId: '', ready: false, required: false, started: false, complete: false, watchedUntilSeconds: 0, lastPositionSeconds: 0, durationSeconds: 0,
  });
  const [rewindSaving, setRewindSaving] = useState(false);
  const [watchError, setWatchError] = useState('');
  const [feedback, setFeedback] = useState<LessonFeedback | null>(null);
  const [feedbackLoading, setFeedbackLoading] = useState(true);
  const [feedbackRefreshVersion, setFeedbackRefreshVersion] = useState(0);
  const [feedbackError, setFeedbackError] = useState<{ lessonId: string; message: string } | null>(null);
  const [commentPostedNotice, setCommentPostedNotice] = useState<{ courseId: string; lessonId: string } | null>(null);
  const [commentModerationNotice, setCommentModerationNotice] = useState<{ courseId: string; lessonId: string; message: string } | null>(null);
  const [commentRemovalIds, setCommentRemovalIds] = useState<Set<string>>(() => new Set());
  const [pendingCommentRemoval, setPendingCommentRemoval] = useState<PendingCommentRemoval | null>(null);
  const [reactionSaving, setReactionSaving] = useState(false);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [commentSavingLessonIds, setCommentSavingLessonIds] = useState<Set<string>>(() => new Set());
  const commentSavingLessonIdsRef = useRef(new Set<string>());
  const [commentsLoading, setCommentsLoading] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoPlayerFrameRef = useRef<HTMLDivElement | null>(null);
  const playbackPositionRef = useRef(0);
  const videoReloadingRef = useRef(false);
  const pendingVideoResumeRef = useRef<PendingVideoResume | null>(null);
  const videoStallTimerRef = useRef<number | null>(null);
  const videoRecoveryTimerRef = useRef<number | null>(null);
  const autoVideoRecoveryLessonRef = useRef<string | null>(null);
  const watchStartedLessonRef = useRef<string | null>(null);
  const pendingVisibilityResumeLessonRef = useRef<{ lessonId: string; positionSeconds: number } | null>(null);
  const reportVideoProgressRef = useRef<(force?: boolean, positionOverride?: number) => void>(() => {});
  const videoStartPromiseRef = useRef<Promise<void> | null>(null);
  const progressReportChainRef = useRef<Promise<void>>(Promise.resolve());
  const lastProgressReportAtRef = useRef(0);
  const watchRequestControllerRef = useRef<AbortController | null>(null);
  const railToggleRef = useRef<HTMLButtonElement | null>(null);
  const railCloseRef = useRef<HTMLButtonElement | null>(null);
  const focusRailAfterOpenRef = useRef(false);
  const lessonHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const commentSectionTitleRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    function syncVideoFullscreenState() {
      setVideoFullscreen(document.fullscreenElement === videoPlayerFrameRef.current);
    }
    document.addEventListener('fullscreenchange', syncVideoFullscreenState);
    return () => document.removeEventListener('fullscreenchange', syncVideoFullscreenState);
  }, []);

  useEffect(() => {
    if (!railOpen) {
      focusRailAfterOpenRef.current = false;
      return;
    }
    if (!focusRailAfterOpenRef.current) return;
    focusRailAfterOpenRef.current = false;
    if (window.matchMedia('(max-width: 720px)').matches) railCloseRef.current?.focus();
  }, [railOpen]);

  function toggleCourseRail() {
    const open = !railOpen;
    focusRailAfterOpenRef.current = open;
    setRailOpen(open);
  }

  async function openCurriculumActivity(href: string) {
    const requestedCourseId = courseId;
    if (!course || course.id !== requestedCourseId || curriculumNavigationInFlightRef.current) return;
    curriculumNavigationInFlightRef.current = true;
    setError('');
    try {
      if (shouldEnrollBeforeCourseActivity(user?.role)) await api.post(`/api/courses/${requestedCourseId}/enroll`);
      if (routeCourseIdRef.current === requestedCourseId) navigate(href);
    } catch (cause) {
      if (routeCourseIdRef.current === requestedCourseId) setError(cause instanceof ApiError ? cause.message : 'Course access could not be started.');
    } finally {
      curriculumNavigationInFlightRef.current = false;
    }
  }

  async function load(showLoading = true) {
    if (!coursePageActiveRef.current) return;
    const requestSequence = ++loadSequenceRef.current;
    const requestedCourseId = courseId;
    courseRequestControllerRef.current?.abort();
    const requestController = new AbortController();
    courseRequestControllerRef.current = requestController;
    const isCurrentRequest = () => requestSequence === loadSequenceRef.current && routeCourseIdRef.current === requestedCourseId;
    if (showLoading) setLoading(true);
    setError('');
    try {
      const response = await fetchCourse(requestedCourseId, false, { signal: requestController.signal });
      if (isCurrentRequest()) setCourse(response.course);
    } catch (cause) {
      if (isCurrentRequest()) setError(cause instanceof ApiError ? cause.message : 'This course could not be loaded.');
    } finally {
      if (isCurrentRequest()) setLoading(false);
      if (courseRequestControllerRef.current === requestController) courseRequestControllerRef.current = null;
    }
  }
  useEffect(() => {
    coursePageActiveRef.current = true;
    setCourse(null); setLoading(true); setSaving(false); setError('');
    load();
    return () => {
      coursePageActiveRef.current = false;
      loadSequenceRef.current += 1;
      courseRequestControllerRef.current?.abort();
      courseRequestControllerRef.current = null;
    };
  }, [courseId, courseLoadRetryVersion]);
  useEffect(() => { setVideoError(false); setFullscreenError(''); }, [courseId, lessonId]);
  useEffect(() => {
    const requestSequence = ++feedbackSequenceRef.current;
    const controller = new AbortController();
    commentPageSequenceRef.current += 1;
    let active = true;
    setPendingCommentRemoval(null); setFeedback(null); setFeedbackError(null); setReactionSaving(false); setCommentsLoading(false);
    if (!canViewLessonFeedback) {
      setFeedbackLoading(false);
      return () => {
        active = false;
        commentPageSequenceRef.current += 1;
        controller.abort();
        commentPageControllerRef.current?.abort();
        commentPageControllerRef.current = null;
      };
    }
    setFeedbackLoading(true);
    api.get<LessonFeedback>(`/api/lessons/${lessonId}/feedback`, { signal: controller.signal }).then((result) => {
      if (active && requestSequence === feedbackSequenceRef.current && routeCourseIdRef.current === courseId && routeLessonIdRef.current === lessonId) setFeedback(result);
    }).catch((cause) => {
      if (active && requestSequence === feedbackSequenceRef.current && routeCourseIdRef.current === courseId && routeLessonIdRef.current === lessonId) {
        setFeedbackError({ lessonId, message: cause instanceof ApiError ? cause.message : 'Lesson feedback could not be loaded.' });
      }
    }).finally(() => {
      if (active && requestSequence === feedbackSequenceRef.current && routeCourseIdRef.current === courseId && routeLessonIdRef.current === lessonId) setFeedbackLoading(false);
    });
    return () => {
      active = false;
      commentPageSequenceRef.current += 1;
      controller.abort();
      commentPageControllerRef.current?.abort();
      commentPageControllerRef.current = null;
    };
  }, [courseId, lessonId, canViewLessonFeedback, feedbackRefreshVersion]);

  const modules = course?.modules || [];
  const lessons = useMemo(() => orderedLessons(modules), [modules]);
  const currentIndex = lessons.findIndex((lesson) => lesson.id === lessonId);
  const current = lessons[currentIndex];
  const previous = currentIndex > 0 ? lessons[currentIndex - 1] : null;
  const nextActivityAfterCurrent = current ? nextCourseActivityAfterLesson(modules, current.id) : null;
  // Every authenticated viewer of the learning player must use verified
  // playback. Staff can still edit course media in the management interface.
  const watchRequired = Boolean(current?.hasVideo);
  const watchReadyForCurrent = watchProgress.lessonId === lessonId && watchProgress.ready;
  const watchedForCurrent = watchProgress.lessonId === lessonId && watchProgress.complete;
  const activeCaptionId = current?.captions.some((caption) => caption.id === selectedCaptionId) ? selectedCaptionId : '';
  const videoWatchProgressDisplay = getVideoWatchProgressDisplay({
    watchedUntilSeconds: watchProgress.lessonId === lessonId ? watchProgress.watchedUntilSeconds : 0,
    durationSeconds: videoDuration,
  });
  const lessonCanBeCompleted = !watchRequired || current?.completed || watchedForCurrent;
  const commentDraft = commentDrafts[lessonId] ?? '';
  const commentSaving = commentSavingLessonIds.has(lessonId);
  const visibleFeedback = feedback?.lessonId === lessonId ? feedback : null;
  const visibleFeedbackError = feedbackError?.lessonId === lessonId ? feedbackError.message : '';

  useEffect(() => {
    selectVideoCaptionTrack(videoRef.current, activeCaptionId);
  }, [current?.id, current?.captions, activeCaptionId]);

  useEffect(() => {
    const requestedLessonId = lessonId;
    const controller = new AbortController();
    watchRequestControllerRef.current?.abort();
    watchRequestControllerRef.current = controller;
    videoStartPromiseRef.current = null;
    watchStartedLessonRef.current = null;
    lastProgressReportAtRef.current = 0;
    playbackPositionRef.current = 0;
    videoReloadingRef.current = false;
    pendingVideoResumeRef.current = null;
    pendingVisibilityResumeLessonRef.current = null;
    autoVideoRecoveryLessonRef.current = null;
    if (videoStallTimerRef.current !== null) window.clearTimeout(videoStallTimerRef.current);
    videoStallTimerRef.current = null;
    if (videoRecoveryTimerRef.current !== null) window.clearTimeout(videoRecoveryTimerRef.current);
    videoRecoveryTimerRef.current = null;
    setRewindSaving(false);
    setVideoBuffering(false);
    setVideoRecovering(false);
    setVideoStalled(false);
    setWatchError('');
    setVideoPlaying(false);
    setVideoPosition(0);
    setVideoDuration(0);
    setWatchProgress({
      lessonId: requestedLessonId,
      ready: !watchRequired || Boolean(current?.locked),
      required: Boolean(watchRequired),
      started: false,
      complete: Boolean(current?.completed),
      watchedUntilSeconds: 0,
      lastPositionSeconds: 0,
      durationSeconds: 0,
    });
    videoRef.current?.pause();
    if (!watchRequired || !current || current.locked) {
      return () => {
        controller.abort();
        if (watchRequestControllerRef.current === controller) watchRequestControllerRef.current = null;
      };
    }
    api.get<Omit<LessonWatchProgress, 'lessonId' | 'ready' | 'started'>>(`/api/lessons/${requestedLessonId}/watch-progress`, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted || routeLessonIdRef.current !== requestedLessonId) return;
        const resumeAt = result.complete ? 0 : result.watchedUntilSeconds;
        playbackPositionRef.current = resumeAt;
        setVideoPosition(resumeAt);
        setWatchProgress({ lessonId: requestedLessonId, ready: true, required: result.required, started: false,
          complete: result.complete, watchedUntilSeconds: result.watchedUntilSeconds, lastPositionSeconds: result.lastPositionSeconds, durationSeconds: result.durationSeconds });
        const video = videoRef.current;
        if (video && video.readyState >= 1) video.currentTime = resumeAt;
      })
      .catch((cause) => {
        if (controller.signal.aborted || routeLessonIdRef.current !== requestedLessonId) return;
        setWatchError(cause instanceof ApiError ? cause.message : 'Video watch progress could not be loaded.');
      });
    return () => {
      controller.abort();
      if (watchRequestControllerRef.current === controller) watchRequestControllerRef.current = null;
    };
  }, [courseId, lessonId, watchRequired, current?.locked, current?.completed]);

  useEffect(() => {
    const routeKey = `${courseId}:${lessonId}`;
    if (previousLessonRouteRef.current === routeKey) return;
    previousLessonRouteRef.current = routeKey;
    setCommentPostedNotice(null);
    setCommentModerationNotice(null);
    if (course?.id === courseId && current) lessonHeadingRef.current?.focus();
  }, [courseId, lessonId, course?.id, current?.id]);

  async function toggleCompleted() {
    if (!current) return;
    const requestedCourseId = courseId;
    const requestedLessonId = lessonId;
    const requestSequence = ++completionSequenceRef.current;
    setSaving(true); setError('');
    try {
      if (current.completed) await api.delete<{ completed: boolean }>(`/api/lessons/${current.id}/completion`);
      else {
        const response = await api.put<{ completed: boolean; certificate: CourseCertificate | null }>(`/api/lessons/${current.id}/completion`);
        if (routeCourseIdRef.current === requestedCourseId) setAvailableCertificate(response.certificate);
      }
      if (coursePageActiveRef.current && routeCourseIdRef.current === requestedCourseId) await load(false);
    } catch (cause) {
      if (routeCourseIdRef.current === requestedCourseId && routeLessonIdRef.current === requestedLessonId) {
        setError(cause instanceof ApiError ? cause.message : 'Progress could not be saved.');
      }
    }
    finally {
      if (requestSequence === completionSequenceRef.current) setSaving(false);
    }
  }

  async function chooseReaction(nextReaction: LessonReaction) {
    if (!feedback || reactionSaving) return;
    const requestedCourseId = courseId;
    const requestedLessonId = lessonId;
    const requestedReaction = feedback.reaction === nextReaction ? null : nextReaction;
    setReactionSaving(true); setFeedbackError(null);
    try {
      const response = await api.put<{ reaction: LessonReaction | null; counts: LessonFeedback['counts'] }>(
        `/api/lessons/${requestedLessonId}/reaction`, { reaction: requestedReaction },
      );
      if (routeCourseIdRef.current === requestedCourseId && routeLessonIdRef.current === requestedLessonId) {
        setFeedback((current) => current?.lessonId === requestedLessonId ? { ...current, ...response } : current);
      }
    } catch (cause) {
      if (routeCourseIdRef.current === requestedCourseId && routeLessonIdRef.current === requestedLessonId) {
        setFeedbackError({ lessonId: requestedLessonId, message: cause instanceof ApiError ? cause.message : 'Your reaction could not be saved.' });
      }
    } finally {
      if (routeCourseIdRef.current === requestedCourseId && routeLessonIdRef.current === requestedLessonId) setReactionSaving(false);
    }
  }

  async function postComment(event: React.FormEvent) {
    event.preventDefault();
    if (!feedback || !commentDraft.trim() || commentSavingLessonIdsRef.current.has(lessonId)) return;
    const requestedCourseId = courseId;
    const requestedLessonId = lessonId;
    const submittedDraft = commentDraft;
    updateCommentSaving(requestedLessonId, true);
    setCommentPostedNotice(null);
    setFeedbackError(null);
    try {
      const response = await api.post<{ comment: LessonComment; total: number }>(
        `/api/lessons/${requestedLessonId}/comments`, { body: submittedDraft },
      );
      setCommentDrafts((current) => {
        if (current[requestedLessonId] !== submittedDraft) return current;
        const nextDrafts = { ...current };
        delete nextDrafts[requestedLessonId];
        return nextDrafts;
      });
      if (routeCourseIdRef.current === requestedCourseId && routeLessonIdRef.current === requestedLessonId) {
        setCommentPostedNotice({ courseId: requestedCourseId, lessonId: requestedLessonId });
        commentPageSequenceRef.current += 1;
        commentPageControllerRef.current?.abort();
        commentPageControllerRef.current = null;
        setCommentsLoading(false);
        if (feedback?.lessonId === requestedLessonId) {
          setFeedback((current) => current?.lessonId === requestedLessonId ? {
            ...current,
            comments: addLessonCommentToPage(current.comments, response.comment, current.pageSize),
            total: response.total,
          } : current);
        } else {
          setFeedbackRefreshVersion((version) => version + 1);
        }
      }
    } catch (cause) {
      if (routeCourseIdRef.current === requestedCourseId && routeLessonIdRef.current === requestedLessonId) {
        setFeedbackError({ lessonId: requestedLessonId, message: cause instanceof ApiError ? cause.message : 'Your comment could not be posted.' });
      }
    } finally {
      updateCommentSaving(requestedLessonId, false);
    }
  }

  function requestCommentRemoval(comment: LessonComment) {
    if (!isCourseManager || commentRemovalIds.has(comment.id) || feedback?.lessonId !== lessonId) return;
    setPendingCommentRemoval({ courseId, lessonId, commentId: comment.id, username: comment.username });
  }

  async function confirmCommentRemoval() {
    const pending = pendingCommentRemoval;
    if (!pending) return;
    const comment = feedback?.lessonId === pending.lessonId
      ? feedback.comments.find((item) => item.id === pending.commentId && item.username === pending.username)
      : undefined;
    setPendingCommentRemoval(null);
    if (!isCourseManager || !comment || commentRemovalIds.has(pending.commentId)
      || routeCourseIdRef.current !== pending.courseId || routeLessonIdRef.current !== pending.lessonId) return;
    const requestedCourseId = pending.courseId;
    const requestedLessonId = pending.lessonId;
    setCommentRemovalIds((current) => new Set(current).add(comment.id));
    setFeedbackError(null);
    setCommentModerationNotice(null);
    try {
      await api.delete(`/api/lessons/${requestedLessonId}/comments/${comment.id}`);
      if (routeCourseIdRef.current === requestedCourseId && routeLessonIdRef.current === requestedLessonId) {
        commentPageSequenceRef.current += 1;
        commentPageControllerRef.current?.abort();
        commentPageControllerRef.current = null;
        setCommentsLoading(false);
        setCommentModerationNotice({ courseId: requestedCourseId, lessonId: requestedLessonId, message: `Removed comment by ${comment.username}.` });
        commentSectionTitleRef.current?.focus();
        setFeedbackRefreshVersion((version) => version + 1);
      }
    } catch (cause) {
      if (routeCourseIdRef.current === requestedCourseId && routeLessonIdRef.current === requestedLessonId) {
        setFeedbackError({ lessonId: requestedLessonId, message: cause instanceof ApiError ? cause.message : 'The comment could not be removed.' });
      }
    } finally {
      setCommentRemovalIds((current) => {
        if (!current.has(comment.id)) return current;
        const next = new Set(current);
        next.delete(comment.id);
        return next;
      });
    }
  }

  async function loadMoreComments() {
    if (!feedback || commentsLoading || feedback.comments.length >= feedback.total) return;
    const requestedCourseId = courseId;
    const requestedLessonId = lessonId;
    const nextPage = feedback.page + 1;
    commentPageControllerRef.current?.abort();
    const controller = new AbortController();
    commentPageControllerRef.current = controller;
    const requestSequence = ++commentPageSequenceRef.current;
    const isCurrentRequest = () => requestSequence === commentPageSequenceRef.current
      && routeCourseIdRef.current === requestedCourseId && routeLessonIdRef.current === requestedLessonId;
    setCommentsLoading(true); setFeedbackError(null);
    try {
      const response = await api.get<LessonFeedback>(`/api/lessons/${requestedLessonId}/feedback?page=${nextPage}`, { signal: controller.signal });
      if (isCurrentRequest()) {
        const newComments = getNewLessonComments(feedback.comments, response.comments);
        if (response.page < nextPage || response.total !== feedback.total || newComments.length !== response.comments.length || (!newComments.length && feedback.comments.length < response.total)) {
          commentPageSequenceRef.current += 1;
          setCommentsLoading(false);
          setFeedbackRefreshVersion((version) => version + 1);
          return;
        }
        setFeedback((current) => current?.lessonId === requestedLessonId ? {
          ...current,
          comments: [...current.comments, ...getNewLessonComments(current.comments, newComments)],
          page: response.page,
          total: response.total,
        } : current);
      }
    } catch (cause) {
      if (isCurrentRequest()) {
        setFeedbackError({ lessonId: requestedLessonId, message: cause instanceof ApiError ? cause.message : 'More comments could not be loaded.' });
      }
    } finally {
      if (commentPageControllerRef.current === controller) commentPageControllerRef.current = null;
      if (requestSequence === commentPageSequenceRef.current
        && routeCourseIdRef.current === requestedCourseId && routeLessonIdRef.current === requestedLessonId) setCommentsLoading(false);
    }
  }

  function commentTimestamp(value: string) {
    const date = new Date(value.includes('Z') ? value : `${value.replace(' ', 'T')}Z`);
    const valid = !Number.isNaN(date.getTime());
    return {
      dateTime: valid ? date.toISOString() : undefined,
      label: valid ? lessonCommentDateFormatter.format(date) : value,
    };
  }

  function updateCommentDraft(value: string) {
    const draftLessonId = lessonId;
    setCommentDrafts((current) => {
      if (value) return { ...current, [draftLessonId]: value };
      if (!Object.hasOwn(current, draftLessonId)) return current;
      const nextDrafts = { ...current };
      delete nextDrafts[draftLessonId];
      return nextDrafts;
    });
  }

  function updateCommentSaving(targetLessonId: string, isSaving: boolean) {
    const nextSaving = new Set(commentSavingLessonIdsRef.current);
    if (isSaving) nextSaving.add(targetLessonId);
    else nextSaving.delete(targetLessonId);
    commentSavingLessonIdsRef.current = nextSaving;
    setCommentSavingLessonIds(nextSaving);
  }

  function retryVideo(resumePlayback = true, verifiedResume = false) {
    const video = videoRef.current;
    if (!video) return;
    const requestedLessonId = lessonId;
    const shouldResumePlayback = shouldResumeVideoPlayback({
      requested: resumePlayback,
      lessonId: requestedLessonId,
      watchRequired,
      watchProgress,
      startedLessonId: watchStartedLessonRef.current,
      verifiedResume,
    });
    const verifiedPosition = watchRequired && watchStartedLessonRef.current === requestedLessonId
      ? playbackPositionRef.current
      : video.currentTime;
    pendingVideoResumeRef.current = { lessonId: requestedLessonId, position: verifiedPosition, resumePlayback: shouldResumePlayback };
    videoReloadingRef.current = true;
    if (videoRecoveryTimerRef.current !== null) window.clearTimeout(videoRecoveryTimerRef.current);
    videoRecoveryTimerRef.current = window.setTimeout(() => {
      videoRecoveryTimerRef.current = null;
      if (routeLessonIdRef.current !== requestedLessonId || !pendingVideoResumeRef.current
        || pendingVideoResumeRef.current.lessonId !== requestedLessonId) return;
      pendingVideoResumeRef.current = null;
      videoReloadingRef.current = false;
      setVideoRecovering(false);
      setVideoStalled(true);
    }, 15_000);
    setVideoBuffering(false);
    setVideoRecovering(true);
    setVideoStalled(false);
    setVideoError(false);
    video.pause();
    video.load();
  }

  function clearVideoStallState() {
    if (videoStallTimerRef.current !== null) window.clearTimeout(videoStallTimerRef.current);
    videoStallTimerRef.current = null;
    setVideoBuffering(false);
    setVideoStalled(false);
  }

  function scheduleVideoStallRecovery() {
    const requestedLessonId = lessonId;
    const video = videoRef.current;
    if (!video || video.paused || video.ended) return;
    setVideoBuffering(true);
    if (videoStallTimerRef.current !== null) return;
    videoStallTimerRef.current = window.setTimeout(() => {
      videoStallTimerRef.current = null;
      const activeVideo = videoRef.current;
      if (routeLessonIdRef.current !== requestedLessonId || !activeVideo) return;
      if (activeVideo.paused || activeVideo.ended || activeVideo.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
        setVideoBuffering(false);
        return;
      }
      setVideoBuffering(false);
      setVideoStalled(true);
      if (autoVideoRecoveryLessonRef.current !== requestedLessonId) {
        autoVideoRecoveryLessonRef.current = requestedLessonId;
        retryVideo(true);
      }
    }, 10_000);
  }

  useEffect(() => () => {
    if (videoStallTimerRef.current !== null) window.clearTimeout(videoStallTimerRef.current);
    if (videoRecoveryTimerRef.current !== null) window.clearTimeout(videoRecoveryTimerRef.current);
  }, []);

  async function toggleVideoPlayback() {
    const video = videoRef.current;
    if (!video || !watchReadyForCurrent || current?.locked) return;
    setWatchError('');
    try {
      if (video.paused) {
        if (pendingVisibilityResumeLessonRef.current?.lessonId === lessonId) {
          const requestedLessonId = lessonId;
          // A backgrounded tab can pause or reset its media clock while the
          // pause checkpoint is still in flight. Let that write settle, then
          // restore the server-verified position before honoring Play.
          await progressReportChainRef.current.catch(() => undefined);
          if (routeLessonIdRef.current !== requestedLessonId) return;
          const savedProgress = await api.get<Omit<LessonWatchProgress, 'lessonId' | 'ready' | 'started'>>(
            `/api/lessons/${requestedLessonId}/watch-progress`,
          );
          if (routeLessonIdRef.current !== requestedLessonId) return;
          let resumePosition = savedProgress.lastPositionSeconds;
          let resumeProgress = savedProgress;
          if (savedProgress.complete) {
            // A fully watched lesson may be replayed from the start.
            resumeProgress = await api.post<Omit<LessonWatchProgress, 'lessonId' | 'ready'>>(
              `/api/lessons/${requestedLessonId}/watch-progress/start`, {},
            );
            resumePosition = resumeProgress.lastPositionSeconds;
          }
          if (routeLessonIdRef.current !== requestedLessonId) return;
          playbackPositionRef.current = resumePosition;
          watchStartedLessonRef.current = requestedLessonId;
          video.currentTime = resumePosition;
          setVideoPosition(resumePosition);
          setWatchProgress({ ...resumeProgress, lessonId: requestedLessonId, ready: true, started: true });
          lastProgressReportAtRef.current = Date.now();
          pendingVisibilityResumeLessonRef.current = null;
          // Browsers can discard the decoder buffer while a tab is in the
          // background. Reload the media at the checkpoint before resuming so
          // Play does not continue on a stale or partially suspended stream.
          retryVideo(true, true);
          return;
        }
        if (video.ended) {
          if (!videoStartPromiseRef.current) {
            const requestedLessonId = lessonId;
            videoStartPromiseRef.current = api.post<Omit<LessonWatchProgress, 'lessonId' | 'ready'>>(
              `/api/lessons/${requestedLessonId}/watch-progress/start`, {},
            ).then((result) => {
              if (routeLessonIdRef.current === requestedLessonId) {
                playbackPositionRef.current = result.lastPositionSeconds;
                watchStartedLessonRef.current = requestedLessonId;
                lastProgressReportAtRef.current = Date.now();
                video.currentTime = result.lastPositionSeconds;
                setVideoPosition(result.lastPositionSeconds);
                setWatchProgress({ ...result, lessonId: requestedLessonId, ready: true, started: true });
              }
            }).finally(() => { videoStartPromiseRef.current = null; });
          }
          await videoStartPromiseRef.current;
          if (routeLessonIdRef.current !== lessonId) return;
        } else if (!watchProgress.started) {
          if (!videoStartPromiseRef.current) {
            const requestedLessonId = lessonId;
            videoStartPromiseRef.current = api.post<Omit<LessonWatchProgress, 'lessonId' | 'ready'>>(
              `/api/lessons/${requestedLessonId}/watch-progress/start`, {},
            ).then((result) => {
              if (routeLessonIdRef.current === requestedLessonId) {
                playbackPositionRef.current = result.lastPositionSeconds;
                watchStartedLessonRef.current = requestedLessonId;
                lastProgressReportAtRef.current = Date.now();
                setWatchProgress({ ...result, lessonId: requestedLessonId, ready: true, started: true });
              }
            }).finally(() => { videoStartPromiseRef.current = null; });
          }
          await videoStartPromiseRef.current;
        }
        await video.play();
      } else video.pause();
    } catch (cause) {
      setWatchError(cause instanceof ApiError ? cause.message : 'The video could not be started. Try again.');
    }
  }

  function reportVideoProgress(force = false, positionOverride?: number) {
    const video = videoRef.current;
    const requestedLessonId = lessonId;
    if (!watchRequired || !video || !watchReadyForCurrent || current?.locked
      || watchStartedLessonRef.current !== requestedLessonId
      || videoReloadingRef.current
      || !Number.isFinite(video.duration) || video.duration <= 0) return;
    const now = Date.now();
    if (!force && now - lastProgressReportAtRef.current < 4000) return;
    lastProgressReportAtRef.current = now;
    // Capture at event time. Reading currentTime later in the serialized queue
    // can observe a browser reset after a tab was hidden and resumed.
    const reportedPositionSeconds = Math.min(positionOverride ?? video.currentTime, video.duration);
    progressReportChainRef.current = progressReportChainRef.current.catch(() => undefined).then(async () => {
      if (routeLessonIdRef.current !== requestedLessonId
        || watchStartedLessonRef.current !== requestedLessonId) return;
      const activeVideo = videoRef.current;
      if (!activeVideo || !Number.isFinite(activeVideo.duration) || activeVideo.duration <= 0) return;
      const result = await api.put<Omit<LessonWatchProgress, 'lessonId' | 'ready' | 'started'> & { accepted: boolean }>(
        `/api/lessons/${requestedLessonId}/watch-progress`, { positionSeconds: reportedPositionSeconds },
      );
      if (routeLessonIdRef.current !== requestedLessonId) return;
      setWatchProgress((previousProgress) => previousProgress.lessonId === requestedLessonId
        ? { ...previousProgress, ...result, started: true, ready: true }
        : previousProgress);
      if (result.accepted) {
        playbackPositionRef.current = result.lastPositionSeconds;
      } else {
        const videoElement = videoRef.current;
        const resumeAfterSync = Boolean(videoElement && !videoElement.paused && !videoElement.ended);
        playbackPositionRef.current = result.lastPositionSeconds;
        if (videoElement && Math.abs(videoElement.currentTime - result.lastPositionSeconds) > 0.15) {
          videoReloadingRef.current = resumeAfterSync;
          videoElement.pause();
          videoElement.currentTime = result.lastPositionSeconds;
          setVideoPosition(result.lastPositionSeconds);
          setVideoPlaying(false);
          if (resumeAfterSync) {
            setWatchError('Playback was resynced to your last verified position.');
            void videoElement.play().catch(() => {
              videoReloadingRef.current = false;
              setWatchError('Playback was resynced to your last verified position. Select Play to continue.');
            });
          } else {
            setWatchError('Manual seeking or accelerated playback was rejected. Continue from the last server-verified position.');
          }
        }
      }
    }).catch((cause) => {
      if (routeLessonIdRef.current === requestedLessonId) {
        setWatchError(cause instanceof ApiError ? cause.message : 'Playback progress could not be saved. Keep this page open and continue watching.');
      }
    });
  }

  reportVideoProgressRef.current = reportVideoProgress;

  useEffect(() => {
    if (!watchRequired) return;
    const pauseWhenHidden = () => {
      const video = videoRef.current;
      if (document.visibilityState === 'hidden' && video && !video.paused && !video.ended) {
        const positionSeconds = video.currentTime;
        pendingVisibilityResumeLessonRef.current = { lessonId, positionSeconds };
        video.pause();
        reportVideoProgressRef.current(true, positionSeconds);
      }
    };
    document.addEventListener('visibilitychange', pauseWhenHidden);
    return () => document.removeEventListener('visibilitychange', pauseWhenHidden);
  }, [watchRequired, lessonId]);

  function updateVideoPosition() {
    const video = videoRef.current;
    if (!video) return;
    const position = Math.min(video.currentTime, Number.isFinite(video.duration) ? video.duration : video.currentTime);
    setVideoPosition(position);
    if (videoRecoveryMadeProgress({
      lessonId,
      recoveryLessonId: autoVideoRecoveryLessonRef.current,
      positionSeconds: position,
      resumePositionSeconds: playbackPositionRef.current,
    })) autoVideoRecoveryLessonRef.current = null;
    if (!watchRequired) {
      setVideoDuration(Number.isFinite(video.duration) ? video.duration : 0);
      return;
    }
    setVideoDuration(Number.isFinite(video.duration) ? video.duration : 0);
    reportVideoProgress();
  }

  function guardVideoSeek(event: React.SyntheticEvent<HTMLVideoElement>) {
    const video = event.currentTarget;
    if (!watchRequired || !watchReadyForCurrent
      || Math.abs(video.currentTime - playbackPositionRef.current) <= 0.15) return;
    const attemptedPosition = video.currentTime;
    const requestedLessonId = lessonId;
    if (watchStartedLessonRef.current === requestedLessonId) {
      progressReportChainRef.current = progressReportChainRef.current.catch(() => undefined).then(async () => {
        if (routeLessonIdRef.current !== requestedLessonId
          || watchStartedLessonRef.current !== requestedLessonId) return;
        await api.put(`/api/lessons/${requestedLessonId}/watch-progress`, { positionSeconds: attemptedPosition });
      }).catch(() => undefined);
    }
    const verifiedPosition = playbackPositionRef.current;
    video.pause();
    video.currentTime = verifiedPosition;
    setVideoPosition(verifiedPosition);
    setVideoPlaying(false);
    setWatchError('Forward seeking is disabled. Use Rewind 30 seconds to review.');
  }

  function rewindVideo30Seconds() {
    const video = videoRef.current;
    const requestedLessonId = lessonId;
    if (!video || !watchReadyForCurrent || !watchProgress.started || rewindSaving
      || watchStartedLessonRef.current !== requestedLessonId || video.currentTime <= 0) return;
    setWatchError('');
    setRewindSaving(true);
    video.pause();
    progressReportChainRef.current = progressReportChainRef.current.catch(() => undefined).then(async () => {
      if (routeLessonIdRef.current !== requestedLessonId
        || watchStartedLessonRef.current !== requestedLessonId) return;
      const activeVideo = videoRef.current;
      if (!activeVideo) return;
      const targetPosition = Math.max(0, activeVideo.currentTime - 30);
      const result = await api.post<Omit<LessonWatchProgress, 'lessonId' | 'ready' | 'started'>>(
        `/api/lessons/${requestedLessonId}/watch-progress/rewind`, { positionSeconds: targetPosition },
      );
      if (routeLessonIdRef.current !== requestedLessonId) return;
      playbackPositionRef.current = result.lastPositionSeconds;
      activeVideo.currentTime = result.lastPositionSeconds;
      setVideoPosition(result.lastPositionSeconds);
      setWatchProgress((previousProgress) => previousProgress.lessonId === requestedLessonId
        ? { ...previousProgress, ...result, started: true, ready: true }
        : previousProgress);
      lastProgressReportAtRef.current = Date.now();
    }).catch((cause) => {
      if (routeLessonIdRef.current === requestedLessonId) {
        setWatchError(cause instanceof ApiError ? cause.message : 'The video could not be rewound. Try again.');
      }
    }).finally(() => {
      if (routeLessonIdRef.current === requestedLessonId) setRewindSaving(false);
    });
  }

  function enforceNormalPlaybackRate(event: React.SyntheticEvent<HTMLVideoElement>) {
    if (watchRequired && event.currentTarget.playbackRate !== 1) event.currentTarget.playbackRate = 1;
  }

  function updateVolume(value: number) {
    const video = videoRef.current;
    if (!video) return;
    const volume = Math.max(0, Math.min(1, value));
    video.volume = volume;
    video.muted = volume === 0;
    setVideoMuted(volume === 0);
    setVideoVolume(volume);
  }

  async function toggleVideoFullscreen() {
    const requestedCourseId = courseId;
    const requestedLessonId = lessonId;
    setFullscreenError('');
    // Fullscreen the player frame so learner controls remain available with the video.
    const result = await tryToggleFullscreen(videoPlayerFrameRef.current, document);
    if (routeCourseIdRef.current !== requestedCourseId || routeLessonIdRef.current !== requestedLessonId) return;
    if (result === 'unsupported') setFullscreenError('Full-screen mode is not supported by this browser.');
    else if (result === 'failed') setFullscreenError('The browser could not change full-screen mode. Try again.');
  }

  if (loading || (course && course.id !== courseId)) return <div className="page-loading" role="status" aria-live="polite">Loading lesson…</div>;
  if (!course || !current) return <div className="narrow-content">{error && <ErrorNotice message={error} onRetry={() => setCourseLoadRetryVersion((version) => version + 1)} />}<Link className="back-link" to={`/courses/${courseId}`}><ArrowLeft size={17} />Back to course</Link></div>;
  if (watchRequired && current.locked) {
    const nextUnlockedLesson = lessons.find((lesson) => !lesson.locked);
    return <div className="narrow-content lesson-locked-page"><span className="program-icon"><LockKeyhole size={19} /></span><h1>Lesson locked</h1><p>Watch and complete the previous lesson before continuing to {current.title}.</p>{nextUnlockedLesson && nextUnlockedLesson.id !== current.id && <Link className="button button-primary" to={`/courses/${course.id}/learn/${nextUnlockedLesson.id}`}>Continue with available lesson<ArrowRight size={17} /></Link>}<Link className="back-link" to={`/courses/${course.id}`}>Back to course</Link></div>;
  }

  return <div className={`player-layout ${railOpen ? '' : 'player-layout-wide'}`}>
    <div className="player-main-column">
      <div className="player-breadcrumb"><Link to={`/courses/${course.id}`}>{course.title}</Link><span>/</span><span>{current.moduleTitle}</span></div>
      {error && <ErrorNotice message={error} />}
      <div className="player-heading"><div><p>{current.moduleTitle}</p><h1 ref={lessonHeadingRef} tabIndex={-1}>{current.title}</h1></div><button ref={railToggleRef} className="rail-toggle" type="button" onClick={toggleCourseRail} aria-label={railOpen ? 'Hide course content' : 'Show course content'} aria-expanded={railOpen} aria-controls="course-content-rail"><ChevronDown size={18} /></button></div>
      {/* Keep the restricted watch controls inside the fullscreen subtree. */}
      <div ref={videoPlayerFrameRef} className="video-player-frame">
      <section className="video-stage">
        {current.hasVideo && current.mediaUrl ? <video ref={videoRef} controls={!watchRequired} controlsList="nodownload noplaybackrate noremoteplayback" disablePictureInPicture disableRemotePlayback playsInline tabIndex={watchRequired ? -1 : undefined} preload="metadata" src={current.mediaUrl} poster={course.coverUrl || undefined} aria-label={current.title}
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;
            selectVideoCaptionTrack(video, activeCaptionId);
            setVideoDuration(Number.isFinite(video.duration) ? video.duration : 0);
            video.playbackRate = 1;
            const resumeTarget = getVideoResumeTarget({
              lessonId,
              watchRequired,
              watchProgress,
              pendingResume: pendingVideoResumeRef.current,
            });
            if (resumeTarget) {
              video.currentTime = resumeTarget.position;
              playbackPositionRef.current = resumeTarget.position;
              setVideoPosition(resumeTarget.position);
              if (resumeTarget.kind === 'retry') {
                pendingVideoResumeRef.current = null;
                if (videoRecoveryTimerRef.current !== null) window.clearTimeout(videoRecoveryTimerRef.current);
                videoRecoveryTimerRef.current = null;
                if (resumeTarget.resumePlayback) {
                  void video.play().catch(() => {
                    videoReloadingRef.current = false;
                    setVideoRecovering(false);
                    setVideoError(true);
                  });
                } else {
                  videoReloadingRef.current = false;
                  setVideoRecovering(false);
                }
              }
            }
          }}
          onTimeUpdate={updateVideoPosition}
          onSeeking={guardVideoSeek}
          onRateChange={enforceNormalPlaybackRate}
          onPlay={() => setVideoPlaying(true)}
          onPlaying={() => {
            if (pendingVisibilityResumeLessonRef.current?.lessonId === lessonId) {
              pendingVisibilityResumeLessonRef.current = null;
            }
            videoReloadingRef.current = false;
            if (videoRecoveryTimerRef.current !== null) window.clearTimeout(videoRecoveryTimerRef.current);
            videoRecoveryTimerRef.current = null;
            clearVideoStallState();
            setVideoRecovering(false);
            setVideoPlaying(true);
          }}
          onCanPlay={(event) => { if (!event.currentTarget.paused) setVideoBuffering(false); }}
          onWaiting={scheduleVideoStallRecovery}
          onStalled={scheduleVideoStallRecovery}
          onPause={() => {
            setVideoPlaying(false);
            if (!videoReloadingRef.current) clearVideoStallState();
            if (watchRequired && pendingVisibilityResumeLessonRef.current?.lessonId !== lessonId) reportVideoProgress(true);
          }}
          onEnded={() => { clearVideoStallState(); setVideoPlaying(false); reportVideoProgress(true); }}
          onClick={() => { if (watchRequired) void toggleVideoPlayback(); }}
          onContextMenu={(event) => { if (watchRequired) event.preventDefault(); }}
          onKeyDown={(event) => {
            if (watchRequired && ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', '+', '-', '='].includes(event.key)) event.preventDefault();
          }}
          onError={() => {
            videoReloadingRef.current = false;
            pendingVideoResumeRef.current = null;
            if (videoRecoveryTimerRef.current !== null) window.clearTimeout(videoRecoveryTimerRef.current);
            videoRecoveryTimerRef.current = null;
            setVideoRecovering(false);
            setVideoError(true);
          }}>
          {current.captions.map((caption) => <track key={caption.id} data-caption-id={caption.id} kind="captions" src={caption.url} srcLang={caption.language} label={caption.label} />)}
        </video> : <div className="video-missing"><Play size={36} /><span>Video not available</span></div>}
      </section>
      {watchRequired && current.hasVideo && <div className={`lesson-video-controls${current.captions.length ? ' has-caption-tracks' : ''}`} role="group" aria-label="Video playback controls">
        <button className="video-control-button video-play-button" type="button" aria-label={videoPlaying ? 'Pause video' : 'Play video'} disabled={!watchReadyForCurrent || videoError} onClick={() => void toggleVideoPlayback()}>{videoPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button>
        <button className="video-control-button video-rewind-button" type="button" aria-label="Rewind 30 seconds" title="Rewind 30 seconds" disabled={!watchReadyForCurrent || !watchProgress.started || rewindSaving || videoPosition <= 0} onClick={rewindVideo30Seconds}><RotateCcw size={16} /><span>30s</span></button>
        <span className="video-clock" aria-label="Current video time">{videoClock(videoPosition)} <span>/</span> {videoClock(videoDuration)}</span>
        <div className="video-watch-progress" role="progressbar" aria-label="Video watch progress; seeking is disabled" aria-valuemin={0} aria-valuemax={videoWatchProgressDisplay.ariaMax} aria-valuenow={videoWatchProgressDisplay.ariaValue} aria-valuetext={videoWatchProgressDisplay.ariaValueText}><span style={{ width: `${videoWatchProgressDisplay.percentage}%` }} /></div>
        <button className="video-control-button" type="button" aria-label={videoMuted ? 'Unmute video' : 'Mute video'} aria-pressed={videoMuted} onClick={() => updateVolume(videoMuted ? videoVolume || 1 : 0)}>{videoMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>
        <input className="video-volume-control" type="range" min="0" max="1" step="0.05" value={videoMuted ? 0 : videoVolume} aria-label="Video volume" onChange={(event) => updateVolume(Number(event.target.value))} />
        <button className="video-control-button video-fullscreen-button" type="button" aria-label={videoFullscreen ? 'Exit full screen' : 'Enter full screen'} onClick={() => { void toggleVideoFullscreen(); }}>{videoFullscreen ? <Minimize size={17} /> : <Maximize size={17} />}</button>
        {current.captions.length > 0 && <AppSelect className="video-caption-select" ariaLabel="Captions" portalContainer={videoPlayerFrameRef.current} value={activeCaptionId} onChange={(captionId) => { setSelectedCaptionId(captionId); selectVideoCaptionTrack(videoRef.current, captionId); }} options={[{ value: '', label: 'Captions off' }, ...current.captions.map((caption) => ({ value: caption.id, label: `${caption.label} (${caption.language})` }))]} />}
      </div>}
      {fullscreenError && <div className="player-video-error" role="alert">{fullscreenError}</div>}
      </div>
      {watchRequired && current.hasVideo && <p className={`video-watch-guidance ${watchedForCurrent ? 'is-watched' : ''}`} role="status" aria-live="polite">{!watchReadyForCurrent ? 'Preparing lesson playback…' : watchedForCurrent ? 'Full video watched. Mark this lesson complete to continue.' : 'Watch the full video to unlock lesson completion. Forward seeking and speed changes are disabled.'}</p>}
      {videoBuffering && <p className="video-watch-guidance" role="status" aria-live="polite">{getVideoRecoveryStatusMessage('buffering', watchRequired)}</p>}
      {videoRecovering && <p className="video-watch-guidance" role="status" aria-live="polite">{getVideoRecoveryStatusMessage('reconnecting', watchRequired)}</p>}
      {videoStalled && !videoRecovering && !videoError && <div className="player-video-error" role="alert"><p>Playback is still waiting for video data. Retry from your saved position.</p><Button type="button" variant="secondary" onClick={() => retryVideo(true)}>Retry playback</Button></div>}
      {videoError && <div className="player-video-error" role="alert"><p>The video could not be loaded. Retry, or contact your course administrator if it still will not play.</p><Button type="button" variant="secondary" onClick={() => retryVideo(true)}>Retry video</Button></div>}
      {watchError && <div className="player-video-error" role="alert">{watchError}</div>}
      <div className="player-controls-row">
        <button className="button button-secondary" type="button" disabled={!previous} onClick={() => previous && navigate(`/courses/${course.id}/learn/${previous.id}`)}><ArrowLeft size={17} />Previous lesson</button>
        <Button variant={current.completed ? 'secondary' : 'primary'} disabled={saving || !lessonCanBeCompleted} aria-busy={saving} onClick={toggleCompleted}>{saving ? 'Saving progress…' : current.completed ? <><Check size={17} />Completed</> : 'Mark lesson complete'}</Button>
        {saving && <span className="sr-only" role="status" aria-live="polite">Saving lesson progress…</span>}
        <button className="button button-secondary" type="button" disabled={!nextActivityAfterCurrent || Boolean(watchRequired && !current.completed)} title={watchRequired && !current.completed ? 'Watch and complete this lesson before continuing' : undefined} onClick={() => {
          if (!nextActivityAfterCurrent) return;
          navigate(nextActivityAfterCurrent.type === 'quiz'
            ? `/courses/${course.id}/quiz/${nextActivityAfterCurrent.id}`
            : `/courses/${course.id}/learn/${nextActivityAfterCurrent.id}`);
        }}>{nextActivityAfterCurrent?.type === 'quiz' ? 'Continue to quiz' : nextActivityAfterCurrent ? 'Next lesson' : 'No next activity'}<ArrowRight size={17} /></button>
      </div>
      {user?.role === 'learner' && (course.completed || availableCertificate?.courseId === course.id) && <div className="course-completion-certificate"><div role="status" aria-live="polite"><strong>Course complete</strong><p>You have completed all lessons and required quizzes.</p></div>{user.firstName?.trim() && user.lastName?.trim() ? <Link className="button button-secondary" to={`/my-learning/certificates/${course.id}`}><Award size={17} />View certificate</Link> : <Link className="button button-secondary" to="/account/security"><Award size={17} />Add name for certificate</Link>}</div>}
      <section className="lesson-notes"><h2>About this lesson</h2><p>{current.description || 'Work through this lesson at your own pace. Mark it complete when you are ready to continue.'}</p></section>
      {current.transcript && <section className="lesson-transcript" aria-labelledby={`lesson-transcript-heading-${current.id}`}><h2 id={`lesson-transcript-heading-${current.id}`}>Lesson transcript</h2><details><summary>Read transcript</summary><div className="lesson-transcript-text">{current.transcript}</div></details></section>}
      {current.resources.length > 0 && <section className="learner-lesson-resources" aria-label="Lesson links and documents">
        <h2>Links and documents</h2>
        <ul>{current.resources.map((resource) => <li key={resource.id}>
          {resource.kind === 'link' ? <Link2 size={17} /> : <FileText size={17} />}
          <a href={resource.url} {...(resource.kind === 'link' ? { target: '_blank', rel: 'noopener noreferrer' } : { download: true })}>
            <span><strong>{resource.title}{resource.kind === 'link' && <span className="sr-only"> (opens in a new tab)</span>}</strong><small>{resource.kind === 'document' ? resource.fileName : resource.url}</small></span>
            {resource.kind === 'link' ? <ExternalLink size={15} /> : <Download size={15} />}
          </a>
        </li>)}</ul>
      </section>}
      {canViewLessonFeedback && <section className="lesson-feedback" aria-labelledby="lesson-feedback-title">
        <div className="lesson-feedback-heading"><div><h2 ref={commentSectionTitleRef} id="lesson-feedback-title" tabIndex={-1}>{isCourseManager ? 'Learner comments' : 'Lesson feedback'}</h2><p>{isCourseManager ? 'Review comments for this lesson. Removals appear in the administrator audit log.' : 'Share your reaction and discuss this lesson with other learners.'}</p></div>{visibleFeedback && <span><MessageSquare size={16} />{visibleFeedback.total} {visibleFeedback.total === 1 ? 'comment' : 'comments'}</span>}</div>
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {commentPostedNotice?.courseId === courseId && commentPostedNotice.lessonId === lessonId ? 'Your comment was posted.' : ''}
        </p>
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {commentModerationNotice?.courseId === courseId && commentModerationNotice.lessonId === lessonId ? commentModerationNotice.message : ''}
        </p>
        {feedbackLoading || (!visibleFeedback && !visibleFeedbackError) ? <div className="feedback-loading" role="status">Loading lesson feedback…</div> : visibleFeedback && <>
          {user?.role === 'learner' && <>
            <div className="lesson-reactions" role="group" aria-label="React to this lesson">
              <Button type="button" variant={visibleFeedback.reaction === 'like' ? 'primary' : 'secondary'} aria-pressed={visibleFeedback.reaction === 'like'} disabled={reactionSaving} onClick={() => chooseReaction('like')}><ThumbsUp size={17} />Like<span className="reaction-count">{visibleFeedback.counts.like}</span></Button>
              <Button type="button" variant={visibleFeedback.reaction === 'dislike' ? 'primary' : 'secondary'} aria-pressed={visibleFeedback.reaction === 'dislike'} disabled={reactionSaving} onClick={() => chooseReaction('dislike')}><ThumbsDown size={17} />Dislike<span className="reaction-count">{visibleFeedback.counts.dislike}</span></Button>
            </div>
            <form className="lesson-comment-form" onSubmit={postComment} aria-busy={commentSaving}>
              <label htmlFor="lesson-comment">Add a comment</label>
              <textarea id="lesson-comment" aria-describedby="lesson-comment-hint" rows={4} maxLength={2000} value={commentDraft} onChange={(event) => updateCommentDraft(event.target.value)} placeholder="What did you think of this lesson?" disabled={commentSaving} />
              <div><small id="lesson-comment-hint">{commentDraft.length}/2,000 characters · visible to learners with course access</small><Button type="submit" disabled={commentSaving || !commentDraft.trim()}>{commentSaving ? 'Posting…' : 'Post comment'}<Send size={16} /></Button></div>
            </form>
            <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{commentSaving ? 'Posting comment…' : ''}</p>
          </>}
          {visibleFeedbackError && <ErrorNotice message={visibleFeedbackError} />}
          <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {visibleFeedback.comments.length === visibleFeedback.total
              ? `Showing all ${visibleFeedback.total} ${visibleFeedback.total === 1 ? 'comment' : 'comments'}.`
              : `Showing ${visibleFeedback.comments.length} of ${formatCountLabel(visibleFeedback.total, 'comment', 'comments')}.`}
          </p>
          <div className="lesson-comments">
            {visibleFeedback.comments.map((comment) => {
              const timestamp = commentTimestamp(comment.createdAt);
              const removing = commentRemovalIds.has(comment.id);
              return <article className="lesson-comment" key={comment.id}><span className="comment-avatar" aria-hidden="true">{comment.username.slice(0, 1).toUpperCase()}</span><div><header><strong>{comment.username}</strong><time dateTime={timestamp.dateTime}>{timestamp.label}</time>{isCourseManager && <Button type="button" variant="quiet" className="lesson-comment-remove" aria-label={`Remove comment by ${comment.username}`} disabled={removing} onClick={() => requestCommentRemoval(comment)}>{removing ? 'Removing…' : <><Trash2 size={14} />Remove</>}</Button>}</header><p>{comment.body}</p></div></article>;
            })}
            {!visibleFeedback.comments.length && <p className="comments-empty">{isCourseManager ? 'No learner comments yet.' : 'No comments yet. Start the conversation.'}</p>}
          </div>
          <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{commentsLoading ? 'Loading more comments.' : ''}</p>
          {visibleFeedback.comments.length < visibleFeedback.total && <Button type="button" variant="secondary" className="load-comments-button" disabled={commentsLoading} onClick={loadMoreComments}>{commentsLoading ? 'Loading…' : 'Load more comments'}</Button>}
        </>}
        {!feedbackLoading && visibleFeedbackError && !visibleFeedback && <ErrorNotice message={visibleFeedbackError} onRetry={() => setFeedbackRefreshVersion((version) => version + 1)} />}
      </section>}
    </div>
    <aside id="course-content-rail" className="course-rail" aria-labelledby="course-rail-title" hidden={!railOpen}><div className="course-rail-head"><div><h2 id="course-rail-title">Course content</h2><small>{course.progress}% complete</small></div><button ref={railCloseRef} type="button" aria-label="Hide course content" onClick={() => { focusRailAfterOpenRef.current = false; setRailOpen(false); railToggleRef.current?.focus(); }}><ChevronDown size={18} /></button></div><ProgressBar value={course.progress} label={`Course progress for ${course.title}`} />
      {modules.map((module) => <CurriculumModule key={module.id} module={module} selectedLessonId={lessonId} courseId={course.id} compact onOpenActivity={openCurriculumActivity} />)}
    </aside>
    {pendingCommentRemoval?.courseId === courseId && pendingCommentRemoval.lessonId === lessonId && isCourseManager
      && visibleFeedback?.comments.some((comment) => comment.id === pendingCommentRemoval.commentId && comment.username === pendingCommentRemoval.username)
      && <ConfirmationDialog {...lessonCommentRemovalConfirmation(pendingCommentRemoval.username)} confirmLabel="Remove comment" onCancel={() => setPendingCommentRemoval(null)} onConfirm={() => void confirmCommentRemoval()} />}
  </div>;
}

export function QuizPage() {
  const { courseId = '', quizId = '' } = useParams();
  const { user } = useAuth();
  const loadSequenceRef = useRef(0);
  const courseRequestControllerRef = useRef<AbortController | null>(null);
  const routeCourseIdRef = useRef(courseId);
  routeCourseIdRef.current = courseId;
  const routeKey = `${courseId}:${quizId}`;
  const routeKeyRef = useRef(routeKey);
  routeKeyRef.current = routeKey;
  const submitSequenceRef = useRef(0);
  const submitInFlightRouteKeyRef = useRef<string | null>(null);
  const firstAnswerRef = useRef<HTMLInputElement | null>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const focusFirstAnswerRef = useRef(false);
  const focusResultRef = useRef(false);
  const [choiceShuffleGeneration, setChoiceShuffleGeneration] = useState(0);
  const [course, setCourse] = useState<Course | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<QuizAttempt | QuizAttemptPreview | null>(null);
  const [availableCertificate, setAvailableCertificate] = useState<CourseCertificate | null>(null);
  const [resultRouteKey, setResultRouteKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attemptDetailsLoadFailed, setAttemptDetailsLoadFailed] = useState(false);
  const [courseLoadRetryVersion, setCourseLoadRetryVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const requestSequence = ++loadSequenceRef.current;
    const requestedRouteKey = `${courseId}:${quizId}`;
    const requestController = new AbortController();
    courseRequestControllerRef.current?.abort();
    courseRequestControllerRef.current = requestController;
    const isCurrentRequest = () => requestSequence === loadSequenceRef.current
      && routeCourseIdRef.current === courseId
      && routeKeyRef.current === requestedRouteKey;
    setCourse(null); setLoading(true); setError(''); setAttemptDetailsLoadFailed(false); setSaving(false);
    void (async () => {
      try {
        const { course: data } = await fetchCourse(courseId, false, { signal: requestController.signal });
        if (!isCurrentRequest()) return;
        setCourse(data);
        const latestAttempt = data.modules?.find((module) => module.quiz?.id === quizId)?.quiz?.latestAttempt;
        if (latestAttempt) {
          try {
            const response = await api.get<{ attempt: QuizAttempt }>(`/api/quizzes/${quizId}/attempts/${latestAttempt.id}`, { signal: requestController.signal });
            if (isCurrentRequest()) {
              setAttemptDetailsLoadFailed(false);
              focusResultRef.current = true;
              setResult(response.attempt);
              setResultRouteKey(requestedRouteKey);
            }
          } catch {
            if (isCurrentRequest() && !requestController.signal.aborted) {
              setAttemptDetailsLoadFailed(true);
              setError('Your saved score is available, but the question breakdown could not be loaded.');
              focusResultRef.current = true;
              // Keep the user-scoped score from the course payload visible if only its breakdown failed.
              setResult(latestAttempt);
              setResultRouteKey(requestedRouteKey);
            }
          }
        }
      } catch (cause) {
        if (isCurrentRequest()) setError(cause instanceof ApiError ? cause.message : 'This quiz could not be loaded.');
      } finally {
        if (isCurrentRequest()) setLoading(false);
        if (courseRequestControllerRef.current === requestController) courseRequestControllerRef.current = null;
      }
    })();
    return () => {
      loadSequenceRef.current += 1; submitSequenceRef.current += 1;
      requestController.abort();
      if (courseRequestControllerRef.current === requestController) courseRequestControllerRef.current = null;
    };
  }, [courseId, quizId, courseLoadRetryVersion]);
  useEffect(() => {
    submitSequenceRef.current += 1;
    focusFirstAnswerRef.current = false; focusResultRef.current = false;
    setAnswers({}); setResult(null); setAvailableCertificate(null); setResultRouteKey(''); setError(''); setAttemptDetailsLoadFailed(false); setSaving(false);
  }, [courseId, quizId]);
  const quiz = course?.modules?.find((module) => module.quiz?.id === quizId)?.quiz;
  const currentResult = resultRouteKey === routeKey ? result : null;
  const choiceOrders = useMemo(() => new Map((quiz?.questions ?? []).map((question, index) => [
    question.id || String(index),
    shuffleQuizChoices(question.choices),
  ])), [quiz?.questions, routeKey, choiceShuffleGeneration]);

  useEffect(() => {
    if (currentResult && focusResultRef.current) {
      focusResultRef.current = false;
      resultHeadingRef.current?.focus();
    } else if (!currentResult && focusFirstAnswerRef.current) {
      focusFirstAnswerRef.current = false;
      firstAnswerRef.current?.focus();
    }
  }, [currentResult]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const requestedRouteKey = routeKey;
    if (!quiz || submitInFlightRouteKeyRef.current === requestedRouteKey) return;
    submitInFlightRouteKeyRef.current = requestedRouteKey;
    const requestSequence = ++submitSequenceRef.current;
    const isCurrentSubmission = () => requestSequence === submitSequenceRef.current && routeKeyRef.current === requestedRouteKey;
    setError(''); setSaving(true);
    try {
      const response = await api.post<{ attempt: QuizAttempt; certificate: CourseCertificate | null }>(`/api/quizzes/${quiz.id}/attempts`, { answers });
      if (isCurrentSubmission()) {
        focusResultRef.current = true;
        setResult(response.attempt); setAvailableCertificate(response.certificate); setResultRouteKey(requestedRouteKey);
        setAttemptDetailsLoadFailed(false);
        setCourse((currentCourse) => {
          if (!currentCourse?.modules || routeKeyRef.current !== requestedRouteKey) return currentCourse;
          let updatedQuiz = false;
          const modules = currentCourse.modules.map((module) => {
            if (module.quiz?.id !== quiz.id) return module;
            updatedQuiz = true;
            const passed = module.quiz.passed || response.attempt.passed;
            return passed === module.quiz.passed ? module : { ...module, quiz: { ...module.quiz, passed } };
          });
          if (!updatedQuiz) return currentCourse;
          const progress = summarizeCourseProgress(modules);
          return {
            ...currentCourse,
            modules,
            ...progress,
            completed: response.certificate?.courseId === currentCourse.id || progress.completed,
          };
        });
      }
    } catch (cause) {
      if (isCurrentSubmission()) setError(cause instanceof ApiError ? cause.message : 'Your quiz could not be submitted.');
    } finally {
      if (submitInFlightRouteKeyRef.current === requestedRouteKey) submitInFlightRouteKeyRef.current = null;
      if (isCurrentSubmission()) setSaving(false);
    }
  }

  if (loading || (course && course.id !== courseId)) return <div className="page-loading" role="status" aria-live="polite">Loading quiz…</div>;
  if (!course || !quiz) return <div className="narrow-content">{error && <ErrorNotice message={error} onRetry={() => setCourseLoadRetryVersion((version) => version + 1)} />}<Link className="back-link" to={`/courses/${courseId}`}><ArrowLeft size={17} />Back to course</Link></div>;
  const answeredCount = quiz.questions.filter((question) => Boolean(answers[question.id || ''])).length;
  const allAnswered = quiz.questions.length > 0 && answeredCount === quiz.questions.length;
  const courseFinished = course.completed || availableCertificate?.courseId === course.id;
  const nextResultActivity = currentResult?.passed && !courseFinished ? nextCourseActivity(course.modules) : null;

  function retryQuiz() {
    focusFirstAnswerRef.current = true;
    setChoiceShuffleGeneration((generation) => generation + 1);
    setAnswers({}); setResult(null); setAvailableCertificate(null); setResultRouteKey(''); setError(''); setAttemptDetailsLoadFailed(false);
  }

  return <div className="quiz-page">
    <div className="breadcrumbs"><Link to={`/courses/${course.id}`}>{course.title}</Link><span>/</span><span>{quiz.title}</span></div>
    <div className="quiz-layout">
      <div className="quiz-main">
        {!currentResult && <div className="quiz-topline"><span>{formatCountLabel(quiz.questions.length, 'question', 'questions')}</span><span>Pass mark {quiz.passMark}%</span></div>}
        <h1>{quiz.title}</h1>
        {!currentResult ? <><p className="lead-copy">Choose one answer for each question. You can retry this quiz if you need another attempt.</p>
          {error && <ErrorNotice message={error} />}
          <form onSubmit={submit} className="quiz-form" aria-busy={saving}>
            {quiz.questions.map((question, index) => <fieldset className="question-block" key={question.id || index} disabled={saving}>
              <legend><span className="question-number">{String(index + 1).padStart(2, '0')}</span>{question.prompt}</legend>
              <div className="quiz-choices">{(choiceOrders.get(question.id || String(index)) ?? question.choices).map((choice, choiceIndex) => <label className={`quiz-choice ${answers[question.id || ''] === choice.id ? 'choice-selected' : ''}`} key={choice.id || choiceIndex}><input ref={index === 0 && choiceIndex === 0 ? firstAnswerRef : undefined} type="radio" name={question.id} value={choice.id} required checked={answers[question.id || ''] === choice.id} onChange={() => setAnswers({ ...answers, [question.id || '']: choice.id || '' })} /><span className="choice-letter">{String.fromCharCode(65 + choiceIndex)}</span><span>{choice.text}</span></label>)}</div>
            </fieldset>)}
            {!quiz.questions.length && <EmptyState icon={<CircleHelp size={24} />} title="This quiz is being prepared" detail="Check back when your course moderator has added questions." />}
            {quiz.questions.length > 0 && <p id="quiz-submit-hint" className="quiz-submit-hint" role="status" aria-live="polite" aria-atomic="true">{allAnswered ? `All ${formatCountLabel(quiz.questions.length, 'question', 'questions')} answered.` : `${answeredCount} of ${formatCountLabel(quiz.questions.length, 'question', 'questions')} answered. Answer the rest to enable submission.`}</p>}
            <Button type="submit" aria-describedby={quiz.questions.length > 0 ? 'quiz-submit-hint' : undefined} disabled={!allAnswered || saving}>{saving ? 'Checking answers…' : 'Submit answers'}<ArrowRight size={17} /></Button>
          </form>
        </> : <div className="quiz-results">
          {attemptDetailsLoadFailed && <ErrorNotice message={error} onRetry={() => setCourseLoadRetryVersion((version) => version + 1)} />}
          <div className={`score-panel ${currentResult.passed ? 'score-pass' : 'score-retry'}`} role="status"><span className="score-icon">{currentResult.passed ? <Check size={22} /> : <Clock3 size={22} />}</span><div><span className="score-label">{currentResult.passed ? 'Quiz passed' : 'Quiz not passed'}</span><strong>{hasQuizAttemptBreakdown(currentResult) ? `${currentResult.correctCount} of ${currentResult.questionCount} correct` : 'Question breakdown unavailable'}</strong><small>Score {currentResult.score}% · {currentResult.passed ? `Pass mark: ${quiz.passMark}%.` : `You need ${quiz.passMark}% to pass.`}</small></div></div>
          <h2 ref={resultHeadingRef} tabIndex={-1}>Quiz result</h2>
          <div className="quiz-result-actions">
            {courseFinished && (user?.firstName?.trim() && user.lastName?.trim() ? <Link className="button button-secondary" to={`/my-learning/certificates/${course.id}`}><Award size={17} />View certificate</Link> : <Link className="button button-secondary" to="/account/security"><Award size={17} />Add name for certificate</Link>)}
            {nextResultActivity && <Link className="button button-primary" to={nextResultActivity.type === 'quiz'
              ? `/courses/${course.id}/quiz/${nextResultActivity.id}`
              : `/courses/${course.id}/learn/${nextResultActivity.id}`}>
              {nextResultActivity.type === 'quiz' ? 'Continue to quiz' : 'Continue learning'}<ArrowRight size={17} />
            </Link>}
            {!currentResult.passed && <Button variant="secondary" onClick={retryQuiz}>Try again</Button>}
            <Link className={`button ${nextResultActivity ? 'button-secondary' : 'button-primary'}`} to={`/courses/${course.id}`}>Back to course</Link>
          </div>
        </div>}
      </div>
      <aside className="quiz-aside"><span className="quiz-aside-label">Course progress</span><strong>{course.progress}%</strong><ProgressBar value={course.progress} label={`Course progress for ${course.title}`} /><p>Complete lessons and pass module quizzes to finish this course.</p><Link to={`/courses/${course.id}`}>View course content<ArrowRight size={16} /></Link></aside>
    </div>
  </div>;
}
