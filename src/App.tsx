import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth-context';
import { AppFrame, LoadingScreen, StaffFrame } from './components';
import { AccountSecurityPage, LoginPage, RegisterPage, SetupPage } from './pages-auth';
import { CatalogPage, CourseOverviewPage, CoursePlayerPage, MyLearningPage, QuizPage } from './pages-learner';
import { AdminSettingsPage, AdminUsersPage, CourseAccessPage, CourseEditorPage, CourseManagementPage } from './pages-manage';

function SignedIn() {
  const { user } = useAuth();
  return user ? <Outlet /> : <Navigate to="/login" replace />;
}

function StaffOnly() {
  const { user } = useAuth();
  return user?.role === 'admin' || user?.role === 'moderator' ? <Outlet /> : <Navigate to="/courses" replace />;
}

function AdminOnly() {
  const { user } = useAuth();
  return user?.role === 'admin' ? <Outlet /> : <Navigate to="/courses" replace />;
}

function AuthRoutes() {
  const { configured, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  return <BrowserRouter>
    {!configured ? <Routes><Route path="*" element={<SetupPage />} /></Routes> : <Routes>
      <Route path="/setup" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<SignedIn />}>
        <Route element={<AppFrame />}>
          <Route path="/" element={<Navigate to="/courses" replace />} />
          <Route path="/courses" element={<CatalogPage />} />
          <Route path="/courses/:courseId" element={<CourseOverviewPage />} />
          <Route path="/courses/:courseId/learn/:lessonId" element={<CoursePlayerPage />} />
          <Route path="/courses/:courseId/quiz/:quizId" element={<QuizPage />} />
          <Route path="/my-learning" element={<MyLearningPage />} />
          <Route path="/account/security" element={<AccountSecurityPage />} />
        </Route>
        <Route element={<StaffOnly />}>
          <Route element={<StaffFrame />}>
            <Route path="/manage/courses" element={<CourseManagementPage />} />
            <Route path="/manage/courses/new" element={<CourseEditorPage />} />
            <Route path="/manage/courses/:courseId/edit" element={<CourseEditorPage />} />
            <Route path="/manage/courses/:courseId/access" element={<CourseAccessPage />} />
            <Route element={<AdminOnly />}>
              <Route path="/admin/users" element={<AdminUsersPage />} />
              <Route path="/admin/settings" element={<AdminSettingsPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/courses" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>}
  </BrowserRouter>;
}

export function App() {
  return <AuthProvider><AuthRoutes /></AuthProvider>;
}

