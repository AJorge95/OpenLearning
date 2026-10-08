import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api, ApiError } from './api';
import { useAuth } from './auth-context';
import { Button } from './components';

function AuthPanel({ children, eyebrow }: { children: React.ReactNode; eyebrow?: string }) {
  const { platformName } = useAuth();
  return (
    <main className="auth-page">
      <section className="auth-panel">
        <Link className="auth-brand" to="/login">{platformName}</Link>
        {eyebrow && <span className="auth-eyebrow">{eyebrow}</span>}
        {children}
      </section>
    </main>
  );
}

export function SetupPage() {
  const { completeSetup, configured, user } = useAuth();
  const navigate = useNavigate();
  const [platformName, setPlatformName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  if (configured) return <Navigate to={user ? '/courses' : '/login'} replace />;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      await completeSetup(platformName, username, password, confirmPassword);
      navigate('/courses');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Setup could not be completed. Try again.');
    } finally { setSaving(false); }
  }

  return (
    <main className="setup-page">
      <section className="setup-panel">
        <span className="setup-mark"><BookOpenMark /></span>
        <h1>Set up your learning platform</h1>
        <p>Create the administrator account and choose a name for this installation.</p>
        <form onSubmit={submit} className="form-stack">
          <label>Platform name<input required minLength={2} maxLength={80} value={platformName} onChange={(event) => setPlatformName(event.target.value)} autoFocus /></label>
          <label>Admin username<input required minLength={3} maxLength={32} pattern="[A-Za-z0-9_.-]+" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
          <label>Password<input required minLength={12} maxLength={256} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /><small>Use at least 12 characters.</small></label>
          <label>Confirm password<input required minLength={12} maxLength={256} type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <Button type="submit" disabled={saving}>{saving ? 'Creating platform…' : 'Create platform'}</Button>
        </form>
      </section>
    </main>
  );
}

function BookOpenMark() {
  return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 7.5c4.3-.9 7.5.2 11 2.4v16c-3.5-2.2-6.7-3.3-11-2.4v-16Zm22 0c-4.3-.9-7.5.2-11 2.4v16c3.5-2.2 6.7-3.3 11-2.4v-16Z" /></svg>;
}

export function LoginPage() {
  const { signIn, user, configured } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  if (configured && user) return <Navigate to="/courses" replace />;
  if (!configured) return <Navigate to="/setup" replace />;

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(''); setSaving(true);
    try { await signIn(username, password); navigate('/courses'); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Sign in failed. Try again.'); }
    finally { setSaving(false); }
  }

  return <AuthPanel><h1>Welcome back</h1><p className="auth-description">Sign in to continue learning.</p>
    <form onSubmit={submit} className="form-stack">
      <label>Username<input required autoComplete="username" autoFocus value={username} onChange={(event) => setUsername(event.target.value)} /></label>
      <label>Password<input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <Button type="submit" disabled={saving}>{saving ? 'Signing in…' : 'Sign in'}</Button>
    </form>
    <p className="auth-footer">New to this platform? <Link to="/register">Create an account</Link></p>
  </AuthPanel>;
}

export function RegisterPage() {
  const { signUp, user, configured } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  if (configured && user) return <Navigate to="/courses" replace />;
  if (!configured) return <Navigate to="/setup" replace />;

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(''); setSaving(true);
    try { await signUp(username, password, confirmPassword); navigate('/courses'); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Registration failed. Try again.'); }
    finally { setSaving(false); }
  }

  return <AuthPanel><h1>Create your account</h1><p className="auth-description">Join your learning space and explore available courses.</p>
    <form onSubmit={submit} className="form-stack">
      <label>Username<input required minLength={3} maxLength={32} pattern="[A-Za-z0-9_.-]+" autoComplete="username" autoFocus value={username} onChange={(event) => setUsername(event.target.value)} /><small>Letters, numbers, dots, underscores, and hyphens.</small></label>
      <label>Password<input required minLength={12} maxLength={256} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /><small>Use at least 12 characters.</small></label>
      <label>Confirm password<input required minLength={12} maxLength={256} type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <Button type="submit" disabled={saving}>{saving ? 'Creating account…' : 'Create account'}</Button>
    </form>
    <p className="auth-footer">Already have an account? <Link to="/login">Sign in</Link></p>
  </AuthPanel>;
}

export function AccountSecurityPage() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(''); setMessage(''); setSaving(true);
    try {
      await api.put('/api/auth/password', { currentPassword, password, confirmPassword });
      setCurrentPassword(''); setPassword(''); setConfirmPassword(''); setMessage('Your password has been updated.');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Password could not be updated.'); }
    finally { setSaving(false); }
  }
  return <div className="narrow-content"><div className="breadcrumbs"><Link to="/courses">Browse courses</Link><span>/</span><span>Account security</span></div><h1>Change password</h1><p className="lead-copy">Choose a new password for your account.</p>
    <form className="surface-form form-stack" onSubmit={submit}>
      <label>Current password<input type="password" required autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
      <label>New password<input type="password" required minLength={12} maxLength={256} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /><small>Use at least 12 characters.</small></label>
      <label>Confirm new password<input type="password" required minLength={12} maxLength={256} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
      {message && <p className="form-success" role="status">{message}</p>}{error && <p className="form-error" role="alert">{error}</p>}
      <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Update password'}</Button>
    </form>
  </div>;
}

