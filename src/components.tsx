import { BookOpen, Check, ChevronDown, ChevronRight, CircleHelp, FileText, LockKeyhole, Play, Settings2, UserRound, UsersRound, LogOut } from 'lucide-react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from './auth-context';
import type { Course, CourseModule, Lesson } from './types';

export function LoadingScreen({ label = 'Loading your learning space…' }: { label?: string }) {
  return <div className="loading-screen"><span className="loading-mark"><BookOpen size={22} /></span><span>{label}</span></div>;
}

export function Header() {
  const { user, platformName, signOut } = useAuth();
  const navigate = useNavigate();
  return (
    <header className="topbar">
      <Link className="wordmark" to="/courses">{platformName}</Link>
      <nav className="topnav" aria-label="Main navigation">
        <NavLink to="/courses" end>Browse courses</NavLink>
        <NavLink to="/my-learning">My learning</NavLink>
      </nav>
      <details className="user-menu">
        <summary aria-label="Open account menu"><span className="avatar">{user?.username.slice(0, 1).toUpperCase()}</span><span className="account-name">{user?.username}</span><ChevronDown size={16} /></summary>
        <div className="user-menu-popover">
          <div className="user-menu-identity"><strong>{user?.username}</strong><span className="muted">{user?.role}</span></div>
          <Link to="/account/security">Change password</Link>
          {user?.role === 'admin' && <Link to="/admin/users">User management</Link>}
          {(user?.role === 'admin' || user?.role === 'moderator') && <Link to="/manage/courses">Course management</Link>}
          {user?.role === 'admin' && <Link to="/admin/settings">Platform settings</Link>}
          <button type="button" className="menu-signout" onClick={async () => { await signOut(); navigate('/login'); }}>Sign out</button>
        </div>
      </details>
    </header>
  );
}

export function AppFrame() {
  return <><Header /><main className="app-main"><Outlet /></main></>;
}

export function StaffFrame() {
  const { platformName, user, signOut } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="staff-layout">
      <aside className="staff-sidebar">
        <Link className="staff-brand" to="/courses">{platformName}</Link>
        <nav aria-label="Management navigation">
          <NavLink to="/manage/courses"><BookOpen size={18} />Courses</NavLink>
          {user?.role === 'admin' && <NavLink to="/admin/users"><UsersRound size={18} />Users</NavLink>}
          {user?.role === 'admin' && <NavLink to="/admin/settings"><Settings2 size={18} />Settings</NavLink>}
        </nav>
        <Link className="staff-back-link" to="/courses"><ChevronRight size={16} />Back to learning</Link>
        <div className="staff-account"><span className="avatar">{user?.username.slice(0, 1).toUpperCase()}</span><span><strong>{user?.username}</strong><small>{user?.role}</small></span><button title="Sign out" onClick={async () => { await signOut(); navigate('/login'); }}><LogOut size={17} /></button></div>
      </aside>
      <main className="staff-content"><Outlet /></main>
    </div>
  );
}

export function PageHeading({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{action && <div className="page-heading-action">{action}</div>}</div>;
}

export function Button({ children, variant = 'primary', className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'quiet' | 'danger' }) {
  return <button className={`button button-${variant} ${className}`.trim()} {...props}>{children}</button>;
}

export function EmptyState({ icon = <BookOpen size={24} />, title, detail, action }: { icon?: React.ReactNode; title: string; detail: string; action?: React.ReactNode }) {
  return <div className="empty-state"><span className="empty-icon">{icon}</span><h2>{title}</h2><p>{detail}</p>{action}</div>;
}

export function ProgressBar({ value }: { value: number }) {
  const progress = Math.max(0, Math.min(100, value));
  return <div className="progress-line" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label={`${progress}% complete`}><span style={{ width: `${progress}%` }} /></div>;
}

export function CourseCard({ course, continueLabel = false }: { course: Course; continueLabel?: boolean }) {
  return (
    <Link className="course-card" to={`/courses/${course.id}`}>
      {course.coverUrl ? <img className="course-cover" src={course.coverUrl} alt="" /> : <div className="course-cover course-cover-placeholder"><BookOpen size={34} strokeWidth={1.5} /></div>}
      <div className="course-card-copy">
        <h2>{course.title}</h2>
        <p className="course-author">{course.owner || 'OpenLearning course'}</p>
        {continueLabel ? <><div className="card-progress-label"><span>{course.completed ? 'Completed' : `${course.progress}% complete`}</span><span>{course.moduleCount} modules</span></div><ProgressBar value={course.progress} /></> : <div className="card-meta"><BookOpen size={17} /><span>{course.moduleCount} {course.moduleCount === 1 ? 'module' : 'modules'}</span></div>}
      </div>
    </Link>
  );
}

export function CourseCover({ course, className = '' }: { course: Course; className?: string }) {
  return course.coverUrl
    ? <img className={`course-cover-image ${className}`} src={course.coverUrl} alt="" />
    : <div className={`course-cover-placeholder course-cover-image ${className}`}><BookOpen size={44} strokeWidth={1.35} /></div>;
}

export function CurriculumModule({ module, selectedLessonId, courseId, compact = false }: {
  module: CourseModule;
  selectedLessonId?: string;
  courseId: string;
  compact?: boolean;
}) {
  return (
    <details className={`curriculum-module ${compact ? 'curriculum-module-compact' : ''}`} open>
      <summary><span className="module-title">{module.title}</span><span className="module-count">{module.lessons.length + (module.quiz ? 1 : 0)} items</span><ChevronDown size={17} /></summary>
      <div className="curriculum-items">
        {module.lessons.map((lesson) => <CurriculumLesson key={lesson.id} lesson={lesson} selected={selectedLessonId === lesson.id} courseId={courseId} />)}
        {module.quiz && <Link className="curriculum-item quiz-item" to={`/courses/${courseId}/quiz/${module.quiz.id}`}><span className="curriculum-icon"><CircleHelp size={17} /></span><span className="curriculum-item-name">{module.quiz.title}</span>{module.quiz.passed && <Check className="completion-icon" size={16} />}</Link>}
      </div>
    </details>
  );
}

function CurriculumLesson({ lesson, selected, courseId }: { lesson: Lesson; selected: boolean; courseId: string }) {
  return (
    <Link className={`curriculum-item ${selected ? 'selected' : ''}`} to={`/courses/${courseId}/learn/${lesson.id}`}>
      <span className="curriculum-icon">{lesson.completed ? <Check size={17} /> : lesson.hasVideo ? <Play size={15} /> : <FileText size={17} />}</span>
      <span className="curriculum-item-name">{lesson.title}</span>
      {lesson.completed && <Check className="completion-icon" size={16} />}
    </Link>
  );
}

export function CourseStatus({ status }: { status: Course['status'] }) {
  const labels = { published: 'Published', draft: 'Draft', archived: 'Archived' };
  return <span className={`status status-${status}`}><span className="status-dot" />{labels[status]}</span>;
}

export function VisibilityLabel({ visibility }: { visibility: Course['visibility'] }) {
  return <span className="visibility-label">{visibility === 'public' ? <UsersRound size={15} /> : <LockKeyhole size={14} />}{visibility === 'public' ? 'All learners' : 'Private'}</span>;
}

export function UserInitial({ username }: { username: string }) {
  return <span className="avatar avatar-small" aria-hidden="true">{username.slice(0, 1).toUpperCase() || <UserRound size={14} />}</span>;
}

