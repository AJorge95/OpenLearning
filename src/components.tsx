import { Activity, BookOpen, Check, ChevronDown, ChevronRight, CircleHelp, ClipboardList, FileText, ImagePlus, LockKeyhole, Play, Settings2, UserRound, UsersRound, LogOut, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from './api';
import { useAuth } from './auth-context';
import { BRAND_PALETTES, MAX_BRAND_ICON_BYTES } from './branding';
import type { BrandingPalette } from './branding';
import type { Course, CourseModule, Lesson } from './types';

export function LoadingScreen({ label = 'Loading your learning space…' }: { label?: string }) {
  return <div className="loading-screen" role="status" aria-live="polite"><span className="loading-mark"><BookOpen size={22} /></span><span>{label}</span></div>;
}

export function PlatformBrand({ className, to = '/courses' }: { className: string; to?: string }) {
  const { platformName, platformIcon } = useAuth();
  return <Link className={className} to={to}>
    <span className="brand-content">
      <ImageWithFallback src={platformIcon} className="brand-icon" fallback={<span className="brand-icon brand-icon-fallback"><BookOpen size={18} /></span>} />
      <span className="brand-name">{platformName}</span>
    </span>
  </Link>;
}

type ImageWithFallbackProps = {
  src: string | null;
  className: string;
  alt?: string;
  fallback: React.ReactNode;
  onError?: () => void;
  loading?: React.ImgHTMLAttributes<HTMLImageElement>['loading'];
  decoding?: React.ImgHTMLAttributes<HTMLImageElement>['decoding'];
};

export function ImageWithFallback(props: ImageWithFallbackProps) {
  if (!props.src) return <>{props.fallback}</>;
  return <ImageWithFallbackImage key={props.src} {...props} src={props.src} />;
}

function ImageWithFallbackImage({ src, className, alt = '', fallback, onError, loading, decoding }: ImageWithFallbackProps & { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return <img className={className} src={src} alt={alt} loading={loading} decoding={decoding} onError={() => { setFailed(true); onError?.(); }} />;
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
  const readSequenceRef = useRef(0);

  useEffect(() => () => { readSequenceRef.current += 1; }, []);

  function selectFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    setError('');
    if (!file) return;
    const readSequence = ++readSequenceRef.current;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('Choose a PNG, JPG, or WebP image.');
      return;
    }
    if (file.size > MAX_BRAND_ICON_BYTES) {
      setError('The icon must be 512 KB or smaller.');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => {
      if (readSequence === readSequenceRef.current) setError('The selected image could not be read.');
    };
    reader.onload = () => {
      if (readSequence !== readSequenceRef.current) return;
      if (typeof reader.result === 'string') onChange(reader.result);
      else setError('The selected image could not be read.');
    };
    reader.readAsDataURL(file);
  }

  return <div className="platform-icon-picker">
    <div className="platform-icon-preview"><ImageWithFallback src={value} className="platform-icon-preview-image" alt="Platform icon preview" fallback={<BookOpen size={23} />} onError={() => setError('The selected image could not be displayed. Try a different image.')} /></div>
    <div className="platform-icon-controls">
      <strong>Platform icon</strong>
      <span className="muted">PNG, JPG, or WebP · up to 512 KB</span>
      <div className="platform-icon-actions">
        <label className="button button-secondary platform-icon-upload"><ImagePlus size={16} />Upload icon<input type="file" accept="image/png,image/jpeg,image/webp" onChange={selectFile} /></label>
        {value && <button type="button" className="button button-quiet platform-icon-remove" onClick={() => { readSequenceRef.current += 1; setError(''); onChange(null); }}><X size={15} />Remove</button>}
      </div>
      {error && <span className="form-error platform-icon-error" role="alert">{error}</span>}
    </div>
  </div>;
}

function useSignOutAction() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (signingOut) return;
    setSigningOut(true);
    setError('');
    try {
      await signOut();
      navigate('/login');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Sign out failed. Check your connection and try again.');
      setSigningOut(false);
    }
  }

  return { submit, signingOut, error };
}

export function Header() {
  const { user } = useAuth();
  const { submit: handleSignOut, signingOut, error: signOutError } = useSignOutAction();
  const { pathname } = useLocation();
  const userMenuRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (userMenuRef.current) userMenuRef.current.open = false;
  }, [pathname]);

  return (
    <header className="topbar">
      <PlatformBrand className="wordmark" />
      <nav className="topnav" aria-label="Main navigation">
        <NavLink to="/courses" end>Browse courses</NavLink>
        <NavLink to="/my-learning">My learning</NavLink>
      </nav>
      <details ref={userMenuRef} className="user-menu">
        <summary aria-label={user?.username ? `Open account menu for ${user.username}` : 'Open account menu'}><span className="avatar">{user?.username.slice(0, 1).toUpperCase()}</span><span className="account-name">{user?.username}</span><ChevronDown size={16} /></summary>
        <div className="user-menu-popover">
          <div className="user-menu-identity"><strong>{user?.username}</strong><span className="muted">{user?.role}</span></div>
          <Link to="/account/security">Change password</Link>
          {user?.role === 'admin' && <Link to="/admin/users">User management</Link>}
          {user?.role === 'admin' && <Link to="/admin/audit-log">Audit log</Link>}
          {user?.role === 'admin' && <Link to="/admin/system-log">System log</Link>}
          {(user?.role === 'admin' || user?.role === 'moderator') && <Link to="/manage/courses">Course management</Link>}
          {user?.role === 'admin' && <Link to="/admin/settings">Platform settings</Link>}
          {signOutError && <p className="user-menu-signout-error" role="alert">{signOutError}</p>}
          <button type="button" className="menu-signout" disabled={signingOut} aria-busy={signingOut} onClick={handleSignOut}>{signingOut ? 'Signing out…' : 'Sign out'}</button>
        </div>
      </details>
    </header>
  );
}

export function AppFrame({ children }: { children?: React.ReactNode }) {
  return <><a className="skip-link" href="#main-content">Skip to main content</a><Header /><main id="main-content" tabIndex={-1} className="app-main">{children ?? <Outlet />}</main></>;
}

export function StaffFrame() {
  const { user } = useAuth();
  const { submit: handleSignOut, signingOut, error: signOutError } = useSignOutAction();
  return (
    <div className="staff-layout">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <aside className="staff-sidebar">
        <PlatformBrand className="staff-brand" />
        <nav aria-label="Management navigation">
          <NavLink to="/manage/courses"><BookOpen size={18} />Courses</NavLink>
          {user?.role === 'admin' && <NavLink to="/admin/users"><UsersRound size={18} />Users</NavLink>}
          {user?.role === 'admin' && <NavLink to="/admin/audit-log"><ClipboardList size={18} />Audit log</NavLink>}
          {user?.role === 'admin' && <NavLink to="/admin/system-log"><Activity size={18} />System log</NavLink>}
          {user?.role === 'admin' && <NavLink to="/admin/settings"><Settings2 size={18} />Settings</NavLink>}
        </nav>
        <Link className="staff-back-link" to="/courses"><ChevronRight size={16} />Back to learning</Link>
        <div className="staff-account"><span className="avatar" aria-hidden="true">{user?.username.slice(0, 1).toUpperCase()}</span><span><strong>{user?.username}</strong><small>{user?.role}</small>{signOutError && <small className="staff-signout-error" role="alert">{signOutError}</small>}</span><button type="button" disabled={signingOut} aria-busy={signingOut} aria-label={signingOut ? 'Signing out' : 'Sign out'} title={signingOut ? 'Signing out' : 'Sign out'} onClick={handleSignOut}><LogOut size={17} /></button></div>
      </aside>
      <main id="main-content" tabIndex={-1} className="staff-content"><Outlet /></main>
    </div>
  );
}

export function PageHeading({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{action && <div className="page-heading-action">{action}</div>}</div>;
}

export function Button({ children, variant = 'primary', className = '', type = 'button', ref, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'quiet' | 'danger'; ref?: React.Ref<HTMLButtonElement> }) {
  return <button ref={ref} type={type} className={`button button-${variant} ${className}`.trim()} {...props}>{children}</button>;
}

export type AppSelectOption<T extends string | number> = { value: T; label: string; disabled?: boolean };

export function AppSelect<T extends string | number>({ value, options, onChange, ariaLabel, describedBy, className = '', disabled = false }: {
  value: T;
  options: AppSelectOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  describedBy?: string;
  className?: string;
  disabled?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const typeaheadRef = useRef('');
  const typeaheadTimerRef = useRef<number | null>(null);
  const id = useId().replaceAll(':', '');
  const menuId = `${id}-listbox`;
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 220, maxHeight: 280 });
  const selectedOption = options.find((option) => option.value === value) ?? options[0];

  function findEnabledIndex(start: number, direction = 1) {
    if (!options.length) return 0;
    for (let offset = 0; offset < options.length; offset += 1) {
      const index = ((start + offset * direction) % options.length + options.length) % options.length;
      if (!options[index].disabled) return index;
    }
    return 0;
  }

  function focusIndex(index: number) {
    const nextIndex = findEnabledIndex(index);
    setActiveIndex(nextIndex);
    menuRef.current?.querySelector<HTMLElement>(`#${menuId}-option-${nextIndex}`)?.scrollIntoView({ block: 'nearest' });
  }

  function openMenu(startIndex = selectedIndex) {
    if (disabled || !options.length) return;
    const trigger = triggerRef.current;
    if (trigger) {
      const rect = trigger.getBoundingClientRect();
      const margin = 12;
      const maxWidth = Math.max(180, window.innerWidth - margin * 2);
      const width = Math.min(Math.max(rect.width, 220), maxWidth);
      const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
      const desiredHeight = Math.min(280, options.length * 40 + 12);
      const roomBelow = window.innerHeight - rect.bottom - margin;
      const roomAbove = rect.top - margin;
      const openAbove = roomBelow < desiredHeight && roomAbove > roomBelow;
      const maxHeight = Math.max(120, Math.min(280, openAbove ? roomAbove - 8 : roomBelow - 8));
      const top = openAbove
        ? Math.max(margin, rect.top - Math.min(desiredHeight, maxHeight) - 6)
        : Math.min(rect.bottom + 6, window.innerHeight - Math.min(desiredHeight, maxHeight) - margin);
      setPosition({ top, left, width, maxHeight });
    }
    setActiveIndex(findEnabledIndex(startIndex));
    setOpen(true);
  }

  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function findByPrefix(prefix: string) {
    if (!prefix) return -1;
    for (let offset = 0; offset < options.length; offset += 1) {
      const index = (activeIndex + offset) % options.length;
      if (!options[index].disabled && options[index].label.toLocaleLowerCase().startsWith(prefix)) return index;
    }
    return -1;
  }

  function searchByKey(key: string) {
    const char = key.toLocaleLowerCase();
    const nextPrefix = `${typeaheadRef.current}${char}`;
    let match = findByPrefix(nextPrefix);
    const prefix = match >= 0 ? nextPrefix : char;
    if (match < 0) match = findByPrefix(prefix);
    typeaheadRef.current = prefix;
    if (typeaheadTimerRef.current !== null) window.clearTimeout(typeaheadTimerRef.current);
    typeaheadTimerRef.current = window.setTimeout(() => { typeaheadRef.current = ''; }, 650);
    if (match >= 0) {
      setActiveIndex(match);
      if (!open) openMenu(match);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) openMenu();
      else focusIndex(activeIndex + (event.key === 'ArrowDown' ? 1 : -1));
      return;
    }
    if (event.key === 'Home' && open) { event.preventDefault(); focusIndex(0); return; }
    if (event.key === 'End' && open) { event.preventDefault(); focusIndex(options.length - 1); return; }
    if (event.key === 'Escape' && open) { event.preventDefault(); setOpen(false); return; }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (open) choose(activeIndex);
      else openMenu();
      return;
    }
    if (event.key.length === 1 && event.key !== ' ') searchByKey(event.key);
  }

  useEffect(() => {
    if (!open) return;
    function closeFromOutside(event: PointerEvent) {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    }
    function closeForLayoutChange() { setOpen(false); }
    document.addEventListener('pointerdown', closeFromOutside);
    window.addEventListener('scroll', closeForLayoutChange, true);
    window.addEventListener('resize', closeForLayoutChange);
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside);
      window.removeEventListener('scroll', closeForLayoutChange, true);
      window.removeEventListener('resize', closeForLayoutChange);
    };
  }, [open]);

  useEffect(() => () => {
    if (typeaheadTimerRef.current !== null) window.clearTimeout(typeaheadTimerRef.current);
  }, []);

  return <div ref={rootRef} className={`app-select ${className}`.trim()}>
    <button ref={triggerRef} type="button" className="app-select-trigger" role="combobox" aria-label={ariaLabel} aria-describedby={describedBy} aria-haspopup="listbox" aria-expanded={open} aria-controls={menuId} aria-activedescendant={open ? `${menuId}-option-${activeIndex}` : undefined} disabled={disabled} onClick={() => open ? setOpen(false) : openMenu()} onKeyDown={handleKeyDown} onBlur={() => setOpen(false)}>
      <span className="app-select-value">{selectedOption?.label ?? 'Choose an option'}</span><ChevronDown className="app-select-chevron" size={16} aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={menuRef} id={menuId} className="app-select-menu" role="listbox" aria-label={`${ariaLabel} options`} style={position}>
      {options.map((option, index) => <div key={String(option.value)} id={`${menuId}-option-${index}`} className={`app-select-option${option.value === value ? ' selected' : ''}${index === activeIndex ? ' active' : ''}`} role="option" aria-selected={option.value === value} aria-disabled={option.disabled || undefined} onPointerEnter={() => !option.disabled && setActiveIndex(index)} onClick={() => choose(index)}>
        <span className="app-select-option-indicator" aria-hidden="true">{option.value === value && <Check size={14} />}</span><span className="app-select-option-label">{option.label}</span>
      </div>)}
    </div>, document.body)}
  </div>;
}

export function EmptyState({ icon = <BookOpen size={24} />, title, detail, action, headingLevel = 2 }: { icon?: React.ReactNode; title: string; detail: string; action?: React.ReactNode; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  return <div className="empty-state"><span className="empty-icon">{icon}</span><Heading>{title}</Heading><p>{detail}</p>{action}</div>;
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const progress = Math.max(0, Math.min(100, value));
  return <div className="progress-line" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label={label}><span style={{ width: `${progress}%` }} /></div>;
}

export function CourseCard({ course, continueLabel = false, coverLoading = 'lazy' }: {
  course: Course;
  continueLabel?: boolean;
  coverLoading?: React.ImgHTMLAttributes<HTMLImageElement>['loading'];
}) {
  return (
    <Link className="course-card" to={`/courses/${course.id}`}>
      <CourseCoverAsset course={course} className="course-cover" iconSize={34} loading={coverLoading} />
      <div className="course-card-copy">
        <h2>{course.title}</h2>
        <p className="course-author">{course.owner || 'OpenLearning course'}</p>
        {continueLabel ? <><div className="card-progress-label"><span>{course.completed ? 'Completed' : `${course.progress}% complete`}</span><span>{course.moduleCount} modules</span></div><ProgressBar value={course.progress} label={`Course progress for ${course.title}`} /></> : <div className="card-meta"><BookOpen size={17} /><span>{course.moduleCount} {course.moduleCount === 1 ? 'module' : 'modules'}</span></div>}
      </div>
    </Link>
  );
}

function CourseCoverAsset({ course, className, iconSize, loading }: {
  course: Course;
  className: string;
  iconSize: number;
  loading?: React.ImgHTMLAttributes<HTMLImageElement>['loading'];
}) {
  return <ImageWithFallback src={course.coverUrl} className={className} loading={loading} decoding={loading === 'lazy' ? 'async' : undefined} fallback={<div className={`course-cover-placeholder ${className}`} aria-hidden="true"><BookOpen size={iconSize} strokeWidth={1.5} /></div>} />;
}

export function CourseCover({ course, className = '' }: { course: Course; className?: string }) {
  return <CourseCoverAsset course={course} className={`course-cover-image ${className}`} iconSize={44} />;
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
    <Link className={`curriculum-item ${selected ? 'selected' : ''}`} aria-current={selected ? 'page' : undefined} to={`/courses/${courseId}/learn/${lesson.id}`}>
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
