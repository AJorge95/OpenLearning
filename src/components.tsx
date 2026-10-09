import { BookOpen, Check, ChevronDown, ChevronRight, CircleHelp, FileText, ImagePlus, LockKeyhole, Play, Settings2, UserRound, UsersRound, LogOut, X } from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from './auth-context';
import { BRAND_PALETTES, MAX_BRAND_ICON_BYTES } from './branding';
import type { BrandingPalette } from './branding';
import type { Course, CourseModule, Lesson } from './types';

export function LoadingScreen({ label = 'Loading your learning space…' }: { label?: string }) {
  return <div className="loading-screen"><span className="loading-mark"><BookOpen size={22} /></span><span>{label}</span></div>;
}

export function PlatformBrand({ className, to = '/courses' }: { className: string; to?: string }) {
  const { platformName, platformIcon } = useAuth();
  return <Link className={className} to={to}>
    <span className="brand-content">
      {platformIcon ? <img className="brand-icon" src={platformIcon} alt="" /> : <span className="brand-icon brand-icon-fallback"><BookOpen size={18} /></span>}
      <span className="brand-name">{platformName}</span>
    </span>
  </Link>;
}

export function PalettePicker({ value, onChange }: { value: BrandingPalette; onChange: (palette: BrandingPalette) => void }) {
  return <div className="palette-picker" role="group" aria-label="Color palette">
    {BRAND_PALETTES.map((palette) => <button key={palette.id} type="button" className={`palette-option ${value === palette.id ? 'selected' : ''}`} aria-pressed={value === palette.id} onClick={() => onChange(palette.id)}>
      <span className="palette-swatch" style={{ backgroundColor: palette.color }} aria-hidden="true">{value === palette.id && <Check size={14} />}</span>
      <span className="palette-option-label">{palette.label}</span>
    </button>)}
  </div>;
}

export function PlatformIconPicker({ value, onChange }: { value: string | null; onChange: (icon: string | null) => void }) {
  const [error, setError] = useState('');

  function selectFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    setError('');
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('Choose a PNG, JPG, or WebP image.');
      return;
    }
    if (file.size > MAX_BRAND_ICON_BYTES) {
      setError('The icon must be 512 KB or smaller.');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setError('The selected image could not be read.');
    reader.onload = () => {
      if (typeof reader.result === 'string') onChange(reader.result);
      else setError('The selected image could not be read.');
    };
    reader.readAsDataURL(file);
  }

  return <div className="platform-icon-picker">
    <div className="platform-icon-preview">{value ? <img src={value} alt="Platform icon preview" /> : <BookOpen size={23} />}</div>
    <div className="platform-icon-controls">
      <strong>Platform icon</strong>
      <span className="muted">PNG, JPG, or WebP · up to 512 KB</span>
      <div className="platform-icon-actions">
        <label className="button button-secondary platform-icon-upload"><ImagePlus size={16} />Upload icon<input type="file" accept="image/png,image/jpeg,image/webp" onChange={selectFile} /></label>
        {value && <button type="button" className="button button-quiet platform-icon-remove" onClick={() => { setError(''); onChange(null); }}><X size={15} />Remove</button>}
      </div>
      {error && <span className="form-error platform-icon-error" role="alert">{error}</span>}
    </div>
  </div>;
}

export function Header() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  return (
    <header className="topbar">
      <PlatformBrand className="wordmark" />
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
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="staff-layout">
      <aside className="staff-sidebar">
        <PlatformBrand className="staff-brand" />
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

