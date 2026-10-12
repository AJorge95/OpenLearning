import { Component, lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createBrowserRouter, Link, Navigate, Outlet, Route, Routes, RouterProvider, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth-context';
import { AppFrame, Button, LoadingScreen, PageHeading, PlatformBrand, StaffFrame } from './components';
import { AccountSecurityPage, LoginPage, RegisterPage, SetupPage } from './pages-auth';

// Keep the larger learner page module out of the signed-out entry bundle.
const CatalogPage = lazy(() => import('./pages-learner').then((pages) => ({ default: pages.CatalogPage })));
const CourseCertificatePage = lazy(() => import('./pages-learner').then((pages) => ({ default: pages.CourseCertificatePage })));
const CourseOverviewPage = lazy(() => import('./pages-learner').then((pages) => ({ default: pages.CourseOverviewPage })));
const CoursePlayerPage = lazy(() => import('./pages-learner').then((pages) => ({ default: pages.CoursePlayerPage })));
const MyLearningPage = lazy(() => import('./pages-learner').then((pages) => ({ default: pages.MyLearningPage })));
const QuizPage = lazy(() => import('./pages-learner').then((pages) => ({ default: pages.QuizPage })));
const CourseAccessPage = lazy(() => import('./pages-manage').then((pages) => ({ default: pages.CourseAccessPage })));
const CourseAnalyticsPage = lazy(() => import('./pages-manage').then((pages) => ({ default: pages.CourseAnalyticsPage })));
const CourseEditorPage = lazy(() => import('./pages-manage').then((pages) => ({ default: pages.CourseEditorPage })));
const CourseManagementPage = lazy(() => import('./pages-manage').then((pages) => ({ default: pages.CourseManagementPage })));
const AdminAuditLogPage = lazy(() => import('./pages-manage').then((pages) => ({ default: pages.AdminAuditLogPage })));
const AdminSettingsPage = lazy(() => import('./pages-manage').then((pages) => ({ default: pages.AdminSettingsPage })));
const AdminRegistrationFieldsPage = lazy(() => import('./pages-manage').then((pages) => ({ default: pages.AdminRegistrationFieldsPage })));
const AdminSystemLogPage = lazy(() => import('./pages-manage').then((pages) => ({ default: pages.AdminSystemLogPage })));
const AdminUserCreatePage = lazy(() => import('./pages-manage').then((pages) => ({ default: pages.AdminUserCreatePage })));
const AdminUserDetailsPage = lazy(() => import('./pages-manage').then((pages) => ({ default: pages.AdminUserDetailsPage })));
const AdminUsersPage = lazy(() => import('./pages-manage').then((pages) => ({ default: pages.AdminUsersPage })));
const LearningPathsPage = lazy(() => import('./pages-programs').then((pages) => ({ default: pages.LearningPathsPage })));
const CalendarPage = lazy(() => import('./pages-programs').then((pages) => ({ default: pages.CalendarPage })));
const CompetenciesPage = lazy(() => import('./pages-programs').then((pages) => ({ default: pages.CompetenciesPage })));
const AdminCompetenciesPage = lazy(() => import('./pages-programs').then((pages) => ({ default: pages.AdminCompetenciesPage })));

function SignedIn() {
  const { user } = useAuth();
  const location = useLocation();
  const from = `${location.pathname}${location.search}${location.hash}`;
  return user ? <Outlet /> : <Navigate to="/login" replace state={{ from }} />;
}

function StaffOnly() {
  const { user } = useAuth();
  return user?.role === 'admin' || user?.role === 'moderator' ? <Outlet /> : <Navigate to="/courses" replace />;
}

function AdminOnly() {
  const { user } = useAuth();
  return user?.role === 'admin' ? <Outlet /> : <Navigate to="/courses" replace />;
}

function CourseEditorRoute() {
  const { pathname } = useLocation();
  return <CourseEditorPage key={pathname} />;
}

class LearnerPageBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return <div className="page-loading" role="alert"><p>This learning page could not be loaded. You can try another page or reload.</p><Button type="button" onClick={() => window.location.reload()}>Reload page</Button></div>;
    }
    return this.props.children;
  }
}

function LearnerPageOutlet() {
  const { pathname } = useLocation();
  // Reset a failed chunk state after navigation so the rest of the app stays usable.
  return <LearnerPageBoundary key={pathname}><Suspense fallback={<div className="page-loading" role="status" aria-live="polite">Loading learning page…</div>}><Outlet /></Suspense></LearnerPageBoundary>;
}

class ManagementPageBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return <div className="page-loading" role="alert"><p>This management page could not be loaded. Reload to try again.</p><Button type="button" onClick={() => window.location.reload()}>Reload page</Button></div>;
    }
    return this.props.children;
  }
}

class ApplicationErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch() {
    document.getElementById('application-error-heading')?.focus();
  }

  render() {
    if (this.state.hasError) {
      return <main className="auth-page"><section className="auth-panel">
        <h1 id="application-error-heading" tabIndex={-1}>This page could not be displayed</h1>
        <p className="auth-description" role="alert">OpenLearning ran into a problem while displaying this page. Reload to try again.</p>
        <Button type="button" onClick={() => window.location.reload()}>Reload page</Button>
      </section></main>;
    }
    return this.props.children;
  }
}

function StaffPageOutlet() {
  const { pathname } = useLocation();
  return <ManagementPageBoundary key={pathname}><Suspense fallback={<div className="page-loading" role="status" aria-live="polite">Loading management page…</div>}><Outlet /></Suspense></ManagementPageBoundary>;
}

function NotFoundPage({ signedIn }: { signedIn: boolean }) {
  if (!signedIn) return <main id="main-content" tabIndex={-1} className="auth-page">
    <section className="auth-panel">
      <PlatformBrand className="auth-brand" to="/login" />
      <h1>Page not found</h1>
      <p className="auth-description">Check the address or return to sign in.</p>
      <Link className="button button-primary" to="/login">Sign in</Link>
    </section>
  </main>;

  return <div className="catalog-page">
    <PageHeading
      title="Page not found"
      subtitle="Check the address or return to the course catalog."
      action={<Link className="button button-primary" to="/courses">Browse courses</Link>}
    />
  </div>;
}

function NotFoundRoute() {
  const { user } = useAuth();
  return user
    ? <AppFrame><NotFoundPage signedIn /></AppFrame>
    : <NotFoundPage signedIn={false} />;
}

function fallbackPageTitle(pathname: string, configured: boolean) {
  if (!configured) return 'Set up your learning platform';
  if (pathname === '/' || pathname === '/courses') return 'Browse courses';
  if (pathname === '/login' || pathname === '/setup') return 'Sign in';
  if (pathname === '/register') return 'Create your account';
  if (pathname === '/my-learning') return 'My learning';
  if (pathname === '/learning-paths') return 'Learning paths';
  if (pathname === '/competencies') return 'Competencies';
  if (pathname === '/calendar') return 'Learning calendar';
  if (pathname === '/manage/learning-paths') return 'Learning paths';
  if (pathname === '/admin/competencies') return 'Competency map';
  if (/^\/my-learning\/certificates\/[^/]+$/.test(pathname)) return 'Course certificate';
  if (pathname === '/account/security') return 'Account settings';
  if (/^\/courses\/[^/]+\/learn\/[^/]+$/.test(pathname)) return 'Lesson';
  if (/^\/courses\/[^/]+\/quiz\/[^/]+$/.test(pathname)) return 'Quiz';
  if (/^\/courses\/[^/]+$/.test(pathname)) return 'Course';
  if (pathname === '/manage/courses') return 'Courses';
  if (pathname === '/manage/courses/new') return 'Create course';
  if (/^\/manage\/courses\/[^/]+\/edit$/.test(pathname)) return 'Course editor';
  if (/^\/manage\/courses\/[^/]+\/analytics$/.test(pathname)) return 'Course dashboard';
  if (/^\/manage\/courses\/[^/]+\/access$/.test(pathname)) return 'Course access';
  if (pathname === '/admin/users') return 'Users';
  if (pathname === '/admin/users/new') return 'Create account';
  if (/^\/admin\/users\/[^/]+$/.test(pathname)) return 'Account details';
  if (pathname === '/admin/settings') return 'Settings';
  if (pathname === '/admin/settings/registration-fields') return 'Registration fields';
  if (pathname === '/admin/audit-log') return 'Audit log';
  if (pathname === '/admin/system-log') return 'System log';
  return 'OpenLearning';
}

function RouteStatus({ configured }: { configured: boolean }) {
  const { pathname } = useLocation();
  const { platformName } = useAuth();
  const previousPathnameRef = useRef(pathname);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    const routeChanged = previousPathnameRef.current !== pathname;
    previousPathnameRef.current = pathname;
    setAnnouncement('');
    const contentRoot = document.getElementById('main-content') || document.querySelector('.auth-page, .setup-page');
    if (routeChanged) document.getElementById('main-content')?.focus();
    const brand = platformName.trim() || 'OpenLearning';
    let lastHeading = '';
    const setPageTitle = (title: string) => {
      document.title = title === brand ? brand : `${title} | ${brand}`;
      if (title !== lastHeading) {
        lastHeading = title;
        setAnnouncement(title);
      }
    };
    document.title = `${fallbackPageTitle(pathname, configured)} | ${brand}`;

    const updateFromHeading = () => {
      const heading = contentRoot?.querySelector('h1')?.textContent?.trim();
      if (heading) setPageTitle(heading);
    };
    updateFromHeading();
    if (!contentRoot) return;
    const observer = new MutationObserver(updateFromHeading);
    observer.observe(contentRoot, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [pathname, platformName, configured]);

  return <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>;
}

function AuthRoutes() {
  const { configured, loading, startupError, retryStartup } = useAuth();
  if (loading) return <LoadingScreen />;
  if (startupError) return <main className="auth-page"><section className="auth-panel">
    <h1>Unable to load the learning platform</h1>
    <p className="auth-description" role="alert">{startupError}</p>
    <Button type="button" onClick={() => void retryStartup()}>Try again</Button>
  </section></main>;
  return <>
    <RouteStatus configured={configured} />
    {!configured ? <Routes><Route path="*" element={<SetupPage />} /></Routes> : <Routes>
      <Route path="/setup" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<SignedIn />}>
        <Route element={<AppFrame />}>
          <Route path="/" element={<Navigate to="/courses" replace />} />
          <Route element={<LearnerPageOutlet />}>
            <Route path="/courses" element={<CatalogPage />} />
            <Route path="/courses/:courseId" element={<CourseOverviewPage />} />
            <Route path="/courses/:courseId/learn/:lessonId" element={<CoursePlayerPage />} />
            <Route path="/courses/:courseId/quiz/:quizId" element={<QuizPage />} />
            <Route path="/my-learning" element={<MyLearningPage />} />
            <Route path="/my-learning/certificates/:courseId" element={<CourseCertificatePage />} />
          </Route>
          <Route path="/learning-paths" element={<Suspense fallback={<LoadingScreen label="Loading learning paths…" />}><LearningPathsPage /></Suspense>} />
          <Route path="/competencies" element={<Suspense fallback={<LoadingScreen label="Loading competencies…" />}><CompetenciesPage /></Suspense>} />
          <Route path="/calendar" element={<Suspense fallback={<LoadingScreen label="Loading calendar…" />}><CalendarPage /></Suspense>} />
          <Route path="/account/security" element={<AccountSecurityPage />} />
        </Route>
        <Route element={<StaffOnly />}>
          <Route element={<StaffFrame />}>
            <Route element={<StaffPageOutlet />}>
              <Route path="/manage/courses" element={<CourseManagementPage />} />
              <Route path="/manage/courses/new" element={<CourseEditorRoute />} />
              <Route path="/manage/courses/:courseId/edit" element={<CourseEditorRoute />} />
              <Route path="/manage/courses/:courseId/analytics" element={<CourseAnalyticsPage />} />
              <Route path="/manage/courses/:courseId/access" element={<CourseAccessPage />} />
              <Route path="/manage/learning-paths" element={<LearningPathsPage />} />
              <Route element={<AdminOnly />}>
                <Route path="/admin/competencies" element={<AdminCompetenciesPage />} />
                <Route path="/admin/users" element={<AdminUsersPage />} />
                <Route path="/admin/users/new" element={<AdminUserCreatePage />} />
                <Route path="/admin/users/:userId" element={<AdminUserDetailsPage />} />
                <Route path="/admin/settings" element={<AdminSettingsPage />} />
                <Route path="/admin/settings/registration-fields" element={<AdminRegistrationFieldsPage />} />
                <Route path="/admin/audit-log" element={<AdminAuditLogPage />} />
                <Route path="/admin/system-log" element={<AdminSystemLogPage />} />
              </Route>
            </Route>
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<NotFoundRoute />} />
    </Routes>}
  </>;
}

const applicationRouter = createBrowserRouter([{
  id: 'application',
  path: '*',
  element: <AuthProvider><AuthRoutes /></AuthProvider>,
}]);

export function App() {
  return <ApplicationErrorBoundary><RouterProvider router={applicationRouter} /></ApplicationErrorBoundary>;
}
