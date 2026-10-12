import { Activity, BookOpen, Check, ChevronDown, ChevronRight, CircleHelp, ClipboardList, FileText, ImagePlus, LockKeyhole, Play, Settings2, UserRound, UsersRound, LogOut, X, Route, Award } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from './api';
import { useAuth } from './auth-context';
import { pendingRegistrationCountRefreshRequestedEvent, requestPendingRegistrationCountRefresh } from './admin-navigation-events';
import { BRAND_PALETTES, isBrandIconDimensionAllowed, MAX_BRAND_ICON_BYTES, MAX_BRAND_ICON_DIMENSION } from './branding';
import type { BrandingPalette } from './branding';
import { clearAppSelectPointerDownTarget, isAppSelectActivationWithinTrigger, isAppSelectPointerDownWithinTrigger, subscribeToAppSelectPointerTracking } from './app-select-activation';
import { shouldCloseAppSelectForLayoutChange } from './app-select-layout';
import { findAppSelectTypeaheadIndex, findEnabledAppSelectIndex, getAppSelectDisplayLabel, isAppSelectUnavailable, resolveAppSelectActiveIndex } from './app-select-navigation';
import { getAppSelectHorizontalPosition, getAppSelectVerticalPosition } from './app-select-position';
import { formatCountLabel } from './count-label';
import { courseCardActionLabel } from './course-navigation';
import { getHorizontalRevealScrollLeft } from './navigation-scroll';
import type { Course, CourseModule, Lesson } from './types';

export function LoadingScreen({ label = 'Loading your learning space…' }: { label?: string }) {
  return <div className="loading-screen" role="status" aria-live="polite"><span className="loading-mark"><BookOpen size={22} /></span><span>{label}</span></div>;
}

export function PlatformBrand({ className, to = '/courses' }: { className: string; to?: string }) {
  const { platformName, platformIcon } = useAuth();
  return <Link className={className} to={to}>
    <span className="brand-content">
      <ImageWithFallback src={platformIcon} className="brand-icon" alt="" fallback={<span className="brand-icon brand-icon-fallback"><BookOpen size={18} /></span>} />
      <span className="brand-name">{platformName}</span>
    </span>
  </Link>;
}

type ImageWithFallbackProps = {
  src: string | null;
  className: string;
  alt: string;
  fallback: React.ReactNode;
  onError?: () => void;
  loading?: React.ImgHTMLAttributes<HTMLImageElement>['loading'];
  decoding?: React.ImgHTMLAttributes<HTMLImageElement>['decoding'];
};

export function ImageWithFallback(props: ImageWithFallbackProps) {
  if (!props.src) return imageFallback(props.fallback, props.alt);
  // A source change remounts the image so a previous failure cannot hide the new asset.
  return <ImageWithFallbackImage key={props.src} {...props} src={props.src} />;
}

function imageFallback(fallback: React.ReactNode, alt: string) {
  // Keep meaningful image context available when a preview has no source or cannot load.
  return <>{fallback}{alt && <span className="sr-only" role="img" aria-label={alt} />}</>;
}

function ImageWithFallbackImage({ src, className, alt, fallback, onError, loading, decoding }: ImageWithFallbackProps & { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return imageFallback(fallback, alt);
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
  const iconHelpId = useId().replaceAll(':', '');
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
      if (typeof reader.result !== 'string') {
        setError('The selected image could not be read.');
        return;
      }
      const image = new Image();
      image.onerror = () => {
        if (readSequence === readSequenceRef.current) setError('The selected image could not be displayed. Try a different image.');
      };
      image.onload = () => {
        if (readSequence !== readSequenceRef.current) return;
        if (!isBrandIconDimensionAllowed(image.naturalWidth, image.naturalHeight)) {
          setError(`The icon must be ${MAX_BRAND_ICON_DIMENSION} × ${MAX_BRAND_ICON_DIMENSION} pixels or smaller.`);
          return;
        }
        onChange(reader.result as string);
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  return <div className="platform-icon-picker">
    <div className="platform-icon-preview"><ImageWithFallback src={value} className="platform-icon-preview-image" alt="Platform icon preview" fallback={<BookOpen size={23} />} onError={() => setError('The selected image could not be displayed. Try a different image.')} /></div>
    <div className="platform-icon-controls">
      <strong>Platform icon</strong>
      <span id={iconHelpId} className="muted">PNG, JPG, or WebP · up to 512 KB · {MAX_BRAND_ICON_DIMENSION} × {MAX_BRAND_ICON_DIMENSION} px max</span>
      <div className="platform-icon-actions">
        <label className="button button-secondary platform-icon-upload"><ImagePlus size={16} />Upload icon<input type="file" accept="image/png,image/jpeg,image/webp" aria-describedby={iconHelpId} onChange={selectFile} /></label>
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
  const mainNavigationRef = useRef<HTMLElement>(null);
  const userMenuRef = useRef<HTMLDetailsElement>(null);
  // Native details toggles outside React, so mirror its state for ARIA and visual feedback.
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  useEffect(() => {
    if (userMenuRef.current) userMenuRef.current.open = false;
    setUserMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    const closeWhenOutside = (event: Event) => {
      const menu = userMenuRef.current;
      if (!menu?.open || !(event.target instanceof Node) || menu.contains(event.target)) return;
      menu.open = false;
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      const menu = userMenuRef.current;
      if (event.key !== 'Escape' || !menu?.open) return;
      event.preventDefault();
      menu.open = false;
      menu.querySelector('summary')?.focus();
    };

    document.addEventListener('pointerdown', closeWhenOutside);
    document.addEventListener('focusin', closeWhenOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeWhenOutside);
      document.removeEventListener('focusin', closeWhenOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  useEffect(() => {
    const revealActiveLink = () => {
      const navigation = mainNavigationRef.current;
      const activeLink = navigation?.querySelector<HTMLAnchorElement>('a[aria-current="page"]');
      if (!navigation || !activeLink || navigation.scrollWidth <= navigation.clientWidth) return;
      navigation.scrollLeft = getHorizontalRevealScrollLeft(
        navigation.getBoundingClientRect(), activeLink.getBoundingClientRect(), navigation.scrollLeft,
      );
    };
    revealActiveLink();
    window.addEventListener('resize', revealActiveLink);
    return () => window.removeEventListener('resize', revealActiveLink);
  }, [pathname]);

  return (
    <header className="topbar">
      <PlatformBrand className="wordmark" />
      <nav ref={mainNavigationRef} className="topnav" aria-label="Main navigation">
        <NavLink to="/courses" end>Browse courses</NavLink>
        <NavLink to="/my-learning">My learning</NavLink>
        <NavLink to="/learning-paths">Learning paths</NavLink>
        <NavLink to="/competencies">Competencies</NavLink>
        <NavLink to="/calendar">Calendar</NavLink>
      </nav>
      <details ref={userMenuRef} className="user-menu" onToggle={(event) => setUserMenuOpen(event.currentTarget.open)}>
        <summary role="button" aria-label={user?.username ? `Open account menu for ${user.username}` : 'Open account menu'} aria-expanded={userMenuOpen} aria-controls="user-menu-popover"><span className="avatar">{user?.username.slice(0, 1).toUpperCase()}</span><span className="account-name">{user?.username}</span><ChevronDown size={16} aria-hidden="true" /></summary>
        <div id="user-menu-popover" className="user-menu-popover">
          <div className="user-menu-identity"><strong>{user?.username}</strong><span className="muted">{user?.role}</span></div>
          <Link to="/account/security">Account settings</Link>
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
  const { pathname } = useLocation();
  const staffNavigationRef = useRef<HTMLElement>(null);
  const [pendingRegistrationCount, setPendingRegistrationCount] = useState<number | null>(null);
  const [pendingRegistrationCountUnavailable, setPendingRegistrationCountUnavailable] = useState(false);
  const { submit: handleSignOut, signingOut, error: signOutError } = useSignOutAction();
  useEffect(() => {
    const revealActiveLink = () => {
      const navigation = staffNavigationRef.current;
      const activeLink = navigation?.querySelector<HTMLAnchorElement>('a[aria-current="page"]');
      if (!navigation || !activeLink || navigation.scrollWidth <= navigation.clientWidth) return;
      navigation.scrollLeft = getHorizontalRevealScrollLeft(
        navigation.getBoundingClientRect(), activeLink.getBoundingClientRect(), navigation.scrollLeft,
      );
    };
    revealActiveLink();
    window.addEventListener('resize', revealActiveLink);
    return () => window.removeEventListener('resize', revealActiveLink);
  }, [pathname]);
  useEffect(() => {
    if (user?.role !== 'admin') {
      setPendingRegistrationCount(null);
      setPendingRegistrationCountUnavailable(false);
      return;
    }

    let requestController: AbortController | null = null;
    async function refreshPendingRegistrationCount() {
      // Focus and approval events can overlap, so only the latest response should update the badge.
      requestController?.abort();
      const controller = new AbortController();
      requestController = controller;
      try {
        const result = await api.get<{ count: number }>('/api/admin/users/pending-count', { signal: controller.signal });
        if (!controller.signal.aborted) {
          const countIsValid = Number.isSafeInteger(result.count) && result.count >= 0;
          setPendingRegistrationCount(countIsValid ? result.count : null);
          setPendingRegistrationCountUnavailable(!countIsValid);
        }
      } catch {
        if (!controller.signal.aborted) {
          setPendingRegistrationCount(null);
          setPendingRegistrationCountUnavailable(true);
        }
      }
    }

    const refresh = () => { void refreshPendingRegistrationCount(); };
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener(pendingRegistrationCountRefreshRequestedEvent, refresh);
    return () => {
      requestController?.abort();
      window.removeEventListener('focus', refresh);
      window.removeEventListener(pendingRegistrationCountRefreshRequestedEvent, refresh);
    };
  }, [pathname, user?.role]);
  const pendingRegistrationCountLabel = pendingRegistrationCountUnavailable
    ? 'Users, pending registration count unavailable; activate to retry'
    : pendingRegistrationCount !== null && pendingRegistrationCount > 0
      ? `Users, ${formatCountLabel(pendingRegistrationCount, 'pending registration', 'pending registrations')}`
      : undefined;
  const pendingRegistrationCountBadge = pendingRegistrationCountUnavailable
    ? <span className="staff-nav-count staff-nav-count-unavailable" aria-hidden="true" title="Pending registration count unavailable. Select Users to retry.">!</span>
    : pendingRegistrationCount !== null && pendingRegistrationCount > 0
      ? <span className="staff-nav-count" aria-hidden="true">{pendingRegistrationCount > 99 ? '99+' : pendingRegistrationCount}</span>
      : null;
  return (
    <div className="staff-layout">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <aside className="staff-sidebar">
        <PlatformBrand className="staff-brand" />
        <nav ref={staffNavigationRef} aria-label="Management navigation">
          <NavLink to="/manage/courses"><BookOpen size={18} />Courses</NavLink>
          {user?.role === 'admin' && <NavLink to="/admin/users" aria-label={pendingRegistrationCountLabel} onClick={() => { if (pathname === '/admin/users') requestPendingRegistrationCountRefresh(); }}><UsersRound size={18} />Users{pendingRegistrationCountBadge}</NavLink>}
          <NavLink to="/manage/learning-paths"><Route size={18} />Learning paths</NavLink>
          {user?.role === 'admin' && <NavLink to="/admin/competencies"><Award size={18} />Competencies</NavLink>}
          {user?.role === 'admin' && <NavLink to="/admin/audit-log"><ClipboardList size={18} />Audit log</NavLink>}
          {user?.role === 'admin' && <NavLink to="/admin/system-log"><Activity size={18} />System log</NavLink>}
          {user?.role === 'admin' && <NavLink to="/admin/settings"><Settings2 size={18} />Settings</NavLink>}
        </nav>
        <Link className="staff-back-link" to="/courses"><ChevronRight size={16} />Back to learning</Link>
        <div className="staff-account"><span className="avatar" aria-hidden="true">{user?.username.slice(0, 1).toUpperCase()}</span><span><strong>{user?.username}</strong><small>{user?.role}</small>{signOutError && <small className="staff-signout-error" role="alert">{signOutError}</small>}</span><button type="button" disabled={signingOut} aria-busy={signingOut} aria-label={signingOut ? 'Signing out' : 'Sign out'} title={signingOut ? 'Signing out' : 'Sign out'} onClick={handleSignOut}><LogOut size={17} aria-hidden="true" /></button></div>
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

export function ConfirmationDialog({ title, description, confirmLabel, cancelLabel = 'Cancel', confirmVariant = 'danger', confirmDisabled = false, onCancel, onConfirm }: {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  confirmVariant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  confirmDisabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dialogId = useId().replaceAll(':', '');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);

  return <dialog ref={dialogRef} className="confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby={`${dialogId}-title`} aria-describedby={`${dialogId}-description`} onCancel={(event) => { event.preventDefault(); onCancel(); }} onClick={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <h2 id={`${dialogId}-title`}>{title}</h2>
    <p id={`${dialogId}-description`}>{description}</p>
    <div className="confirmation-dialog-actions"><Button variant="secondary" autoFocus onClick={onCancel}>{cancelLabel}</Button><Button variant={confirmVariant} disabled={confirmDisabled} onClick={onConfirm}>{confirmLabel}</Button></div>
  </dialog>;
}

type PasswordFieldProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label: string;
  hint?: string;
  hintId?: string;
  inputRef?: React.Ref<HTMLInputElement>;
};

export function PasswordField({ label, hint, hintId, inputRef, id, disabled, 'aria-describedby': describedBy, ...inputProps }: PasswordFieldProps) {
  const generatedId = useId().replaceAll(':', '');
  const inputId = id || `password-${generatedId}`;
  const visibleHintId = hint ? hintId || `${inputId}-hint` : undefined;
  const describedByIds = [...new Set([describedBy, visibleHintId].filter(Boolean))].join(' ') || undefined;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (inputProps.value === '') setVisible(false);
  }, [inputProps.value]);

  function handlePasswordChange(event: React.ChangeEvent<HTMLInputElement>) {
    const isEmpty = event.currentTarget.value === '';
    inputProps.onChange?.(event);
    if (isEmpty) setVisible(false);
  }

  return <div className="password-field">
    <label htmlFor={inputId}><span className="form-label-row"><span>{label}</span>{inputProps.required && <small className="form-required-indicator" aria-hidden="true">Required</small>}</span></label>
    <div className="password-input-control">
      <input {...inputProps} ref={inputRef} id={inputId} type={visible ? 'text' : 'password'} disabled={disabled} aria-describedby={describedByIds} onChange={handlePasswordChange} />
      {/* The label names the next action (Show/Hide), so this button intentionally has no pressed toggle state. */}
      <button
        type="button"
        className="password-visibility-toggle"
        aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
        aria-controls={inputId}
        disabled={disabled}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? 'Hide' : 'Show'}
      </button>
    </div>
    {hint && <small id={visibleHintId}>{hint}</small>}
  </div>;
}

export type AppSelectOption<T extends string | number> = { value: T; label: string; disabled?: boolean };

export function AppSelect<T extends string | number>({ value, options, onChange, ariaLabel, ariaLabelledBy, describedBy, controlId, invalid = false, className = '', disabled = false, busy = false, required = false, leadingIcon, matchTriggerWidth = false, portalContainer }: {
  value: T;
  options: AppSelectOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  ariaLabelledBy?: string;
  describedBy?: string;
  controlId?: string;
  invalid?: boolean;
  className?: string;
  disabled?: boolean;
  busy?: boolean;
  required?: boolean;
  leadingIcon?: React.ReactNode;
  matchTriggerWidth?: boolean;
  portalContainer?: HTMLElement | null;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const typeaheadRef = useRef('');
  const typeaheadTimerRef = useRef<number | null>(null);
  const id = useId().replaceAll(':', '');
  const menuId = `${id}-listbox`;
  const [open, setOpen] = useState(false);
  const unavailable = isAppSelectUnavailable(options, disabled);
  const menuOpen = open && !unavailable;
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const [activeValue, setActiveValue] = useState(value);
  const activeOptionIndex = resolveAppSelectActiveIndex(options, activeValue, selectedIndex);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 220, maxHeight: 280 });

  useEffect(() => subscribeToAppSelectPointerTracking(), []);

  function focusIndex(index: number, direction: 1 | -1 = 1) {
    const nextIndex = findEnabledAppSelectIndex(options, index, direction);
    const nextOption = options[nextIndex];
    if (nextOption && !nextOption.disabled) setActiveValue(nextOption.value);
  }

  function openMenu(startIndex = selectedIndex) {
    if (unavailable) return;
    const trigger = triggerRef.current;
    if (trigger) {
      const rect = trigger.getBoundingClientRect();
      const { left, width } = getAppSelectHorizontalPosition(rect, window.innerWidth, matchTriggerWidth ? rect.width : undefined);
      const { top, maxHeight } = getAppSelectVerticalPosition(rect, window.innerHeight, options.length);
      setPosition({ top, left, width, maxHeight });
    }
    const nextOption = options[findEnabledAppSelectIndex(options, startIndex)];
    if (nextOption && !nextOption.disabled) setActiveValue(nextOption.value);
    setOpen(true);
  }

  function choose(index: number) {
    const option = options[index];
    if (unavailable || !option || option.disabled) return;
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function searchByKey(key: string) {
    const char = key.toLocaleLowerCase();
    const nextPrefix = `${typeaheadRef.current}${char}`;
    const startIndex = open ? activeOptionIndex : selectedIndex;
    const characters = Array.from(nextPrefix);
    const repeatedCharacter = characters.length > 1 && characters.every((candidate) => candidate.toLocaleLowerCase() === char);
    let prefix = repeatedCharacter ? char : nextPrefix;
    let match = findAppSelectTypeaheadIndex(options, startIndex, prefix, repeatedCharacter);
    if (match < 0 && !repeatedCharacter) {
      prefix = char;
      match = findAppSelectTypeaheadIndex(options, startIndex, prefix);
    }
    typeaheadRef.current = prefix;
    if (typeaheadTimerRef.current !== null) window.clearTimeout(typeaheadTimerRef.current);
    typeaheadTimerRef.current = window.setTimeout(() => { typeaheadRef.current = ''; }, 650);
    if (match >= 0) {
      setActiveValue(options[match].value);
      if (!open) openMenu(match);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      if (!open) openMenu();
      else focusIndex(activeOptionIndex + direction, direction);
      return;
    }
    if (event.key === 'Home' && open) { event.preventDefault(); focusIndex(0, 1); return; }
    if (event.key === 'End' && open) { event.preventDefault(); focusIndex(options.length - 1, -1); return; }
    if (event.key === 'Escape' && open) { event.preventDefault(); setOpen(false); return; }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (open) choose(activeOptionIndex);
      else openMenu();
      return;
    }
    if (event.key.length === 1 && event.key !== ' ') searchByKey(event.key);
  }

  useEffect(() => {
    if (unavailable) setOpen(false);
  }, [unavailable]);

  useEffect(() => {
    const activeOption = options.find((option) => option.value === activeValue && !option.disabled);
    if (activeOption || unavailable) return;
    const fallbackOption = options[activeOptionIndex];
    if (fallbackOption && !fallbackOption.disabled) setActiveValue(fallbackOption.value);
  }, [activeOptionIndex, activeValue, options, unavailable]);

  useEffect(() => {
    if (!menuOpen) return;
    // Keep the active descendant visible when opening or moving through a scrollable listbox.
    menuRef.current?.querySelector<HTMLElement>(`#${menuId}-option-${activeOptionIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeOptionIndex, menuId, menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    function closeFromOutside(event: PointerEvent) {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    }
    function closeForLayoutChange(event: Event) {
      if (!shouldCloseAppSelectForLayoutChange(event.target, menuRef.current)) return;
      setOpen(false);
    }
    document.addEventListener('pointerdown', closeFromOutside);
    window.addEventListener('scroll', closeForLayoutChange, true);
    window.addEventListener('resize', closeForLayoutChange);
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside);
      window.removeEventListener('scroll', closeForLayoutChange, true);
      window.removeEventListener('resize', closeForLayoutChange);
    };
  }, [menuOpen]);

  useEffect(() => () => {
    if (typeaheadTimerRef.current !== null) window.clearTimeout(typeaheadTimerRef.current);
  }, []);

  // A supplied container keeps fullscreen-owned menus in the browser's top layer.
  const menuPortalContainer = portalContainer ?? document.body;

  return <div ref={rootRef} className={`app-select ${className}`.trim()}>
    {/* Keep async work discoverable even while the trigger is disabled. */}
    <button id={controlId} ref={triggerRef} type="button" className="app-select-trigger" role="combobox" aria-label={ariaLabel} aria-labelledby={ariaLabelledBy} aria-describedby={describedBy} aria-invalid={invalid || undefined} aria-required={required || undefined} aria-busy={busy || undefined} aria-haspopup="listbox" aria-expanded={menuOpen} aria-controls={menuOpen ? menuId : undefined} aria-activedescendant={menuOpen ? `${menuId}-option-${activeOptionIndex}` : undefined} disabled={unavailable} onClick={(event) => {
      // A wrapping label can forward clicks from its blank area to this button.
      const pointerStartedWithinTrigger = isAppSelectPointerDownWithinTrigger(event.currentTarget);
      clearAppSelectPointerDownTarget();
      if (!isAppSelectActivationWithinTrigger(event.nativeEvent, event.currentTarget.getBoundingClientRect(), pointerStartedWithinTrigger)) return;
      menuOpen ? setOpen(false) : openMenu();
    }} onKeyDown={handleKeyDown} onBlur={() => setOpen(false)}>
      {leadingIcon && <span className="app-select-leading" aria-hidden="true">{leadingIcon}</span>}<span className="app-select-value">{getAppSelectDisplayLabel(options, value)}</span><ChevronDown className="app-select-chevron" size={16} aria-hidden="true" />
    </button>
    {menuOpen && createPortal(<div ref={menuRef} id={menuId} className={`app-select-menu${matchTriggerWidth ? ' app-select-menu--match-trigger' : ''}`} role="listbox" aria-label={`${ariaLabel} options`} style={position}>
      {options.map((option, index) => <div key={String(option.value)} id={`${menuId}-option-${index}`} className={`app-select-option${option.value === value ? ' selected' : ''}${index === activeOptionIndex ? ' active' : ''}`} role="option" aria-selected={option.value === value} aria-disabled={option.disabled || undefined} onPointerDown={(event) => event.preventDefault()} onPointerEnter={() => !option.disabled && setActiveValue(option.value)} onClick={() => choose(index)}>
        <span className="app-select-option-indicator" aria-hidden="true">{option.value === value && <Check size={14} />}</span><span className="app-select-option-label">{option.label}</span>
      </div>)}
    </div>, menuPortalContainer)}
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

export function CourseCard({ course, showLearningProgress = false, coverLoading = 'lazy' }: {
  course: Course;
  showLearningProgress?: boolean;
  coverLoading?: React.ImgHTMLAttributes<HTMLImageElement>['loading'];
}) {
  // Keep the catalog scannable while giving learners enough context to choose a course.
  const description = course.description.trim();
  const learningActionLabel = showLearningProgress
    ? courseCardActionLabel({ completed: course.completed, progress: course.progress })
    : null;
  return (
    <Link className="course-card" to={`/courses/${course.id}`}>
      <CourseCoverAsset course={course} className="course-cover" iconSize={34} loading={coverLoading} />
      <div className="course-card-copy">
        <h2>{course.title}</h2>
        {description && <p className="course-description">{description}</p>}
        <p className="course-author">{course.owner || 'OpenLearning course'}</p>
        {showLearningProgress ? <><div className="card-progress-label"><span>{course.completed ? 'Completed' : `${course.progress}% complete`}</span><span>{formatCountLabel(course.moduleCount, 'module', 'modules')}</span></div><ProgressBar value={course.progress} label={`Course progress for ${course.title}`} /><span className="course-card-action">{learningActionLabel}<ChevronRight size={15} aria-hidden="true" /></span></> : <div className="card-meta"><BookOpen size={17} /><span>{formatCountLabel(course.moduleCount, 'module', 'modules')}</span></div>}
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
  return <ImageWithFallback src={course.coverUrl} className={className} alt="" loading={loading} decoding={loading === 'lazy' ? 'async' : undefined} fallback={<div className={`course-cover-placeholder ${className}`} aria-hidden="true"><BookOpen size={iconSize} strokeWidth={1.5} /></div>} />;
}

export function CourseCover({ course, className = '' }: { course: Course; className?: string }) {
  return <CourseCoverAsset course={course} className={`course-cover-image ${className}`} iconSize={44} />;
}

function openCurriculumActivity(event: React.MouseEvent<HTMLAnchorElement>, href: string, onOpenActivity?: (href: string) => void) {
  if (!onOpenActivity || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.currentTarget.target) return;
  event.preventDefault();
  onOpenActivity(href);
}

export function CurriculumModule({ module, selectedLessonId, courseId, compact = false, onOpenActivity }: {
  module: CourseModule;
  selectedLessonId?: string;
  courseId: string;
  compact?: boolean;
  onOpenActivity?: (href: string) => void;
}) {
  const quiz = module.quiz;
  return (
    <details className={`curriculum-module ${compact ? 'curriculum-module-compact' : ''}`} open>
      <summary><span className="module-title">{module.title}</span><span className="module-count">{formatCountLabel(module.lessons.length + (quiz ? 1 : 0), 'item', 'items')}</span><ChevronDown size={17} /></summary>
      <div className="curriculum-items">
        {module.lessons.map((lesson) => <CurriculumLesson key={lesson.id} lesson={lesson} selected={selectedLessonId === lesson.id} courseId={courseId} onOpenActivity={onOpenActivity} />)}
        {quiz && <Link className="curriculum-item quiz-item" to={`/courses/${courseId}/quiz/${quiz.id}`} onClick={(event) => openCurriculumActivity(event, `/courses/${courseId}/quiz/${quiz.id}`, onOpenActivity)}><span className="curriculum-icon"><CircleHelp size={17} /></span><span className="curriculum-item-name">{quiz.title}</span>{quiz.passed && <Check className="completion-icon" size={16} />}</Link>}
      </div>
    </details>
  );
}

function CurriculumLesson({ lesson, selected, courseId, onOpenActivity }: { lesson: Lesson; selected: boolean; courseId: string; onOpenActivity?: (href: string) => void }) {
  if (lesson.locked) return (
    <div className="curriculum-item curriculum-item-locked" aria-disabled="true" title="Complete the previous lesson to unlock this lesson">
      <span className="curriculum-icon"><LockKeyhole size={15} /></span>
      <span className="curriculum-item-name">{lesson.title}</span>
      <span className="curriculum-lock-label">Locked</span>
    </div>
  );
  return (
    <Link className={`curriculum-item ${selected ? 'selected' : ''}`} aria-current={selected ? 'page' : undefined} to={`/courses/${courseId}/learn/${lesson.id}`} onClick={(event) => openCurriculumActivity(event, `/courses/${courseId}/learn/${lesson.id}`, onOpenActivity)}>
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
  return <span className="visibility-label">{visibility === 'public' ? <UsersRound size={15} aria-hidden="true" /> : <LockKeyhole size={14} aria-hidden="true" />}{visibility === 'public' ? 'All learners' : 'Private'}</span>;
}

export function UserInitial({ username }: { username: string }) {
  return <span className="avatar avatar-small" aria-hidden="true">{username.slice(0, 1).toUpperCase() || <UserRound size={14} />}</span>;
}
