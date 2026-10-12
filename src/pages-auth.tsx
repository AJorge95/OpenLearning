import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from './api';
import { useAuth } from './auth-context';
import { AppSelect, Button, ImageWithFallback, PalettePicker, PasswordField, PlatformBrand, PlatformIconPicker } from './components';
import { getPostLoginPath } from './post-login-path';
import { buildRegistrationFieldSelectOptions, findMissingRequiredRegistrationField, refreshRegistrationFieldValues } from './registration-fields';
import { clearPasswordConfirmationError, getPasswordConfirmationError, passwordConfirmationFieldProps } from './password-confirmation';
import { accountPasswordFieldForError, shouldClearAccountPasswordFieldErrorOnEdit } from './password-change-errors';
import type { AccountPasswordField } from './password-change-errors';
import { acquireSubmissionLock, releaseSubmissionLock } from './submission-lock';
import { validateEmail } from './email-validation';
import { accountNameError, MAX_ACCOUNT_NAME_LENGTH, normalizeAccountName } from './account-name-validation';
import { MAX_PLATFORM_NAME_LENGTH, MIN_PLATFORM_NAME_LENGTH, normalizePlatformName, platformNameValidationError } from './platform-name-validation';
import { CONNECTION_PROTOCOL_OPTIONS } from './branding';
import type { BrandingPalette, ConnectionProtocol } from './branding';
import type { RegistrationField, RegistrationFieldValues } from './types';

const EMPTY_REGISTRATION_SELECT_OPTIONS: { value: string; label: string }[] = [];

function AuthPanel({ children, eyebrow }: { children: React.ReactNode; eyebrow?: string }) {
  return (
    <main id="main-content" tabIndex={-1} className="auth-page">
      <section className="auth-panel">
        <PlatformBrand className="auth-brand" to="/login" />
        {eyebrow && <span className="auth-eyebrow">{eyebrow}</span>}
        {children}
      </section>
    </main>
  );
}

function RegistrationFieldsForm({ fields, values, disabled, invalidFieldId, onChange }: {
  fields: RegistrationField[];
  values: RegistrationFieldValues;
  disabled: boolean;
  invalidFieldId: string;
  onChange: (id: string, value: string | boolean) => void;
}) {
  // Keep AppSelect's options stable while answers change; its validation effect depends on this reference.
  const selectOptionsByFieldId = useMemo(() => buildRegistrationFieldSelectOptions(fields), [fields]);
  if (!fields.length) return null;
  return <div className="registration-form-fields">
    <div className="registration-form-fields-heading"><h2>About you</h2><span>Share the details requested by this learning space.</span></div>
    {fields.map((field) => {
      if (field.type === 'checkbox') return <label className="registration-checkbox-field" key={field.id}>
        <input
          id={`registration-field-${field.id}`}
          type="checkbox"
          required={field.required}
          checked={values[field.id] === true}
          aria-invalid={invalidFieldId === field.id || undefined}
          aria-describedby={invalidFieldId === field.id ? 'registration-form-error' : undefined}
          onChange={(event) => onChange(field.id, event.target.checked)}
          disabled={disabled}
        />
        <span>{field.label}{field.required && <small>Required</small>}</span>
      </label>;
      if (field.type === 'select') return <div className="registration-custom-field" key={field.id}>
        <span>{field.label}{field.required && <small>Required</small>}</span>
        <AppSelect<string>
          controlId={`registration-field-${field.id}`}
          ariaLabel={field.label}
          describedBy={invalidFieldId === field.id ? 'registration-form-error' : undefined}
          invalid={invalidFieldId === field.id}
          required={field.required}
          value={typeof values[field.id] === 'string' ? values[field.id] as string : ''}
          onChange={(value) => onChange(field.id, value)}
          disabled={disabled}
          options={selectOptionsByFieldId.get(field.id) ?? EMPTY_REGISTRATION_SELECT_OPTIONS}
        />
      </div>;
      const isInvalid = invalidFieldId === field.id;
      const fieldValue = typeof values[field.id] === 'string' ? values[field.id] as string : '';
      const fieldDescriptionId = field.type === 'text' ? `registration-field-count-${field.id}` : undefined;
      const describedBy = [fieldDescriptionId, isInvalid ? 'registration-form-error' : undefined]
        .filter((id): id is string => Boolean(id))
        .join(' ') || undefined;
      return <label className="registration-custom-field" key={field.id}>
        <span>{field.label}{field.required && <small>Required</small>}</span>
        <input
          id={`registration-field-${field.id}`}
          type={field.type === 'date' ? 'date' : 'text'}
          required={field.required}
          maxLength={field.type === 'text' ? 2000 : undefined}
          min={field.type === 'date' ? '0001-01-01' : undefined}
          max={field.type === 'date' ? '9999-12-31' : undefined}
          value={fieldValue}
          aria-invalid={isInvalid || undefined}
          aria-describedby={describedBy}
          onChange={(event) => onChange(field.id, event.target.value)}
          disabled={disabled}
        />
        {fieldDescriptionId && <small id={fieldDescriptionId} className="field-character-count">{fieldValue.length} / 2,000 characters</small>}
      </label>;
    })}
  </div>;
}

export function SetupPage() {
  const { completeSetup, configured, setupAvailable, user, connectionProtocol: initialProtocol, registrationEnabled: initialRegistrationEnabled, userLimit: initialUserLimit } = useAuth();
  const navigate = useNavigate();
  const setupErrorId = useId();
  const setupEmailErrorId = useId();
  const setupPlatformNameErrorId = useId();
  const setupUsernameInputId = useId();
  const setupUsernameHelpId = `${setupUsernameInputId}-help`;
  const setupPlatformNameInputRef = useRef<HTMLInputElement>(null);
  const setupEmailInputRef = useRef<HTMLInputElement>(null);
  const setupFirstNameInputRef = useRef<HTMLInputElement>(null);
  const setupLastNameInputRef = useRef<HTMLInputElement>(null);
  const confirmPasswordInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousStepRef = useRef(step);
  const [platformName, setPlatformName] = useState('');
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [platformIcon, setPlatformIcon] = useState<string | null>(null);
  const [themePalette, setThemePalette] = useState<BrandingPalette>('violet');
  const [connectionProtocol, setConnectionProtocol] = useState<ConnectionProtocol>(initialProtocol);
  const [registrationEnabled, setRegistrationEnabled] = useState(initialRegistrationEnabled);
  const [userLimit, setUserLimit] = useState(String(initialUserLimit));
  const [error, setError] = useState('');
  const [platformNameError, setPlatformNameError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [invalidNameField, setInvalidNameField] = useState<'firstName' | 'lastName' | null>(null);
  const [saving, setSaving] = useState(false);
  const setupSubmissionInFlightRef = useRef(false);

  useEffect(() => {
    if (previousStepRef.current === step) return;
    previousStepRef.current = step;
    stepHeadingRef.current?.focus();
  }, [step]);

  if (configured) return <Navigate to={user ? '/courses' : '/login'} replace />;
  if (!setupAvailable) return <main id="main-content" tabIndex={-1} className="setup-page">
    <section className="setup-panel">
      <span className="setup-mark"><BookOpenMark /></span>
      <h1>Initial setup is unavailable</h1>
      <p>Ask the server operator to configure the private <code>SETUP_TOKEN</code> before creating the administrator account.</p>
    </section>
  </main>;

  function continueToAccessSettings(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setPlatformNameError('');
    setInvalidNameField(null);
    const currentPlatformNameError = platformNameValidationError(platformName);
    if (currentPlatformNameError) {
      setPlatformNameError(currentPlatformNameError);
      window.requestAnimationFrame(() => setupPlatformNameInputRef.current?.focus());
      return;
    }
    const normalizedPlatformName = normalizePlatformName(platformName);
    const currentEmailError = validateEmail(email);
    if (currentEmailError) {
      setEmailError(currentEmailError);
      window.requestAnimationFrame(() => setupEmailInputRef.current?.focus());
      return;
    }
    setEmailError('');
    const firstNameError = accountNameError(firstName, 'First name');
    if (firstNameError) {
      setInvalidNameField('firstName');
      setError(firstNameError);
      window.requestAnimationFrame(() => setupFirstNameInputRef.current?.focus());
      return;
    }
    const lastNameError = accountNameError(lastName, 'Last name');
    if (lastNameError) {
      setInvalidNameField('lastName');
      setError(lastNameError);
      window.requestAnimationFrame(() => setupLastNameInputRef.current?.focus());
      return;
    }
    setInvalidNameField(null);
    setFirstName(normalizeAccountName(firstName));
    setLastName(normalizeAccountName(lastName));
    const confirmationError = getPasswordConfirmationError(password, confirmPassword);
    if (confirmationError) {
      setError(confirmationError);
      confirmPasswordInputRef.current?.focus();
      return;
    }
    setPlatformName(normalizedPlatformName);
    setStep(2);
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    window.scrollTo({ top: 0, behavior });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!acquireSubmissionLock(setupSubmissionInFlightRef)) return;
    setError('');
    setSaving(true);
    try {
      await completeSetup(platformName, email, firstName, lastName, username, password, confirmPassword, setupToken, {
        themePalette, platformIcon, connectionProtocol, registrationEnabled, userLimit: Number(userLimit),
      });
      navigate('/courses');
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'invalid_platform_name') {
        setPlatformNameError(cause.message);
        setStep(1);
        window.requestAnimationFrame(() => setupPlatformNameInputRef.current?.focus());
      } else if (cause instanceof ApiError && cause.code === 'invalid_email') {
        setEmailError(cause.message);
        setStep(1);
        window.requestAnimationFrame(() => setupEmailInputRef.current?.focus());
      } else if (cause instanceof ApiError && cause.code === 'invalid_name') {
        const invalidField = cause.message.startsWith('Last name') ? 'lastName' : 'firstName';
        setInvalidNameField(invalidField);
        setError(cause.message);
        setStep(1);
        window.requestAnimationFrame(() => (invalidField === 'lastName' ? setupLastNameInputRef.current : setupFirstNameInputRef.current)?.focus());
      } else setError(cause instanceof ApiError ? cause.message : 'Setup could not be completed. Try again.');
    } finally {
      releaseSubmissionLock(setupSubmissionInFlightRef);
      setSaving(false);
    }
  }

  function choosePalette(palette: BrandingPalette) {
    setThemePalette(palette);
    document.documentElement.dataset.palette = palette;
  }

  return (
    <main id="main-content" tabIndex={-1} className="setup-page">
      <section className="setup-panel">
        <span className="setup-mark"><ImageWithFallback src={platformIcon} className="setup-mark-image" alt="Platform icon preview" fallback={<BookOpenMark />} /></span>
        <div className="setup-step-label">Step {step} of 2</div>
        {step === 1 ? <>
          <h1 ref={stepHeadingRef} tabIndex={-1}>Set up your learning platform</h1>
          <p>Create the administrator account and choose a name for this installation.</p>
          <form onSubmit={continueToAccessSettings} className="form-stack">
            <label>Platform name<input ref={setupPlatformNameInputRef} required minLength={MIN_PLATFORM_NAME_LENGTH} maxLength={MAX_PLATFORM_NAME_LENGTH} aria-invalid={platformNameError ? true : undefined} aria-describedby={platformNameError ? setupPlatformNameErrorId : undefined} value={platformName} onChange={(event) => { setPlatformName(event.target.value); setPlatformNameError(''); }} autoFocus /></label>
            {platformNameError && <p id={setupPlatformNameErrorId} className="form-error" role="alert">{platformNameError}</p>}
            <PlatformIconPicker value={platformIcon} onChange={setPlatformIcon} />
            <div className="branding-choice-field"><span className="branding-choice-label">Color palette</span><small>Choose the accent colors used across the platform.</small><PalettePicker value={themePalette} onChange={choosePalette} /></div>
            <label>Admin email<input ref={setupEmailInputRef} name="email" required type="email" maxLength={254} autoComplete="email" aria-invalid={emailError ? true : undefined} aria-describedby={emailError ? setupEmailErrorId : undefined} value={email} onChange={(event) => { setEmail(event.target.value); setEmailError(''); }} /></label>
            {emailError && <p id={setupEmailErrorId} className="form-error" role="alert">{emailError}</p>}
            <div className="account-name-fields"><label>First name<input ref={setupFirstNameInputRef} name="firstName" required maxLength={MAX_ACCOUNT_NAME_LENGTH} autoComplete="given-name" aria-invalid={invalidNameField === 'firstName' || undefined} aria-describedby={invalidNameField === 'firstName' ? setupErrorId : undefined} value={firstName} onChange={(event) => { setFirstName(event.target.value); if (invalidNameField === 'firstName') { setInvalidNameField(null); setError(''); } }} /></label><label>Last name<input ref={setupLastNameInputRef} name="lastName" required maxLength={MAX_ACCOUNT_NAME_LENGTH} autoComplete="family-name" aria-invalid={invalidNameField === 'lastName' || undefined} aria-describedby={invalidNameField === 'lastName' ? setupErrorId : undefined} value={lastName} onChange={(event) => { setLastName(event.target.value); if (invalidNameField === 'lastName') { setInvalidNameField(null); setError(''); } }} /></label></div>
            <div className="form-stack-username-field"><label htmlFor={setupUsernameInputId}>Admin username</label><input id={setupUsernameInputId} name="username" aria-describedby={setupUsernameHelpId} required minLength={3} maxLength={32} pattern="[A-Za-z0-9_.-]+" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(event) => setUsername(event.target.value)} /><small id={setupUsernameHelpId}>Letters, numbers, dots, underscores, and hyphens.</small></div>
            <PasswordField label="Password" name="password" required minLength={12} maxLength={256} autoComplete="new-password" value={password} onChange={(event) => { setPassword(event.target.value); setError((currentError) => clearPasswordConfirmationError(currentError)); }} hint="Use at least 12 characters." />
            <PasswordField label="Confirm password" name="confirmPassword" inputRef={confirmPasswordInputRef} {...passwordConfirmationFieldProps(error, setupErrorId)} required minLength={12} maxLength={256} autoComplete="new-password" value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setError((currentError) => clearPasswordConfirmationError(currentError)); }} />
            <label>One-time setup token<input name="setupToken" required minLength={32} maxLength={256} type="password" autoComplete="off" value={setupToken} onChange={(event) => setSetupToken(event.target.value)} /><small>Enter the private bootstrap credential configured by the server operator.</small></label>
            {error && <p id={setupErrorId} className="form-error" role="alert">{error}</p>}
            <Button type="submit">Continue to access settings</Button>
          </form>
        </> : <>
          <h1 ref={stepHeadingRef} tabIndex={-1}>Configure access</h1>
          <p>Choose how people connect and whether new learner accounts can be created.</p>
          <form onSubmit={submit} className="form-stack" aria-busy={saving}>
            <div className="app-select-field"><span>Public connection protocol</span><AppSelect<ConnectionProtocol> ariaLabel="Public connection protocol" describedBy="setup-protocol-help" value={connectionProtocol} onChange={setConnectionProtocol} disabled={saving} options={CONNECTION_PROTOCOL_OPTIONS} /></div>
            <p id="setup-protocol-help" className="protocol-help">HTTPS requires a TLS certificate on this server or a reverse proxy. When a proxy handles TLS, set <code>TRUST_PROXY=true</code> in the server environment.</p>
            <label className="setup-toggle"><span><strong>Allow new registrations</strong><small>Let people create learner accounts from the sign-in page.</small></span><input type="checkbox" checked={registrationEnabled} onChange={(event) => setRegistrationEnabled(event.target.checked)} disabled={saving} /></label>
            <label>Maximum registered accounts<input type="number" min={0} max={1000000} step={1} required value={userLimit} onChange={(event) => setUserLimit(event.target.value)} disabled={saving} /><small>Set to 0 for no limit. The cap includes this administrator account, moderators, and learners.</small></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="setup-step-actions"><Button type="button" variant="secondary" disabled={saving} onClick={() => { setError(''); setStep(1); }}>Back</Button><Button type="submit" disabled={saving}>{saving ? 'Creating platform…' : 'Create platform'}</Button></div>
          </form>
        </>}
      </section>
    </main>
  );
}

function BookOpenMark() {
  return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 7.5c4.3-.9 7.5.2 11 2.4v16c-3.5-2.2-6.7-3.3-11-2.4v-16Zm22 0c-4.3-.9-7.5.2-11 2.4v16c3.5-2.2 6.7-3.3 11-2.4v-16Z" /></svg>;
}

export function LoginPage() {
  const { signIn, user, configured, registrationEnabled, registrationAvailable } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const postLoginPath = getPostLoginPath(location.state?.from);
  const hasRequestedDestination = postLoginPath !== '/courses';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const submissionInFlightRef = useRef(false);
  if (configured && user) return <Navigate to={postLoginPath} replace />;
  if (!configured) return <Navigate to="/setup" replace />;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!acquireSubmissionLock(submissionInFlightRef)) return;
    setError(''); setSaving(true);
    try { await signIn(username, password); navigate(postLoginPath, { replace: true }); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Sign in failed. Try again.'); }
    finally { releaseSubmissionLock(submissionInFlightRef); setSaving(false); }
  }

  return <AuthPanel><h1>Welcome back</h1><p id="login-description" className="auth-description">{hasRequestedDestination ? 'Sign in to return to the page you requested.' : 'Sign in to continue learning.'}</p>
    <form onSubmit={submit} className="form-stack" aria-busy={saving}>
      <label>Username<input name="username" aria-describedby="login-description" required maxLength={32} autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus value={username} onChange={(event) => setUsername(event.target.value)} disabled={saving} /></label>
      <PasswordField label="Password" name="password" required maxLength={256} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={saving} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <Button type="submit" disabled={saving}>{saving ? 'Signing in…' : 'Sign in'}</Button>
    </form>
    {registrationEnabled && registrationAvailable
      ? <p className="auth-footer">New to this platform? <Link to="/register" state={{ from: postLoginPath }}>Create an account</Link></p>
      : <p className="auth-footer">{registrationEnabled ? 'The registered-account limit has been reached.' : 'New account registration is currently disabled.'}</p>}
  </AuthPanel>;
}

export function RegisterPage() {
  const { signUp, user, configured, registrationEnabled, registrationApprovalRequired, registrationAvailable } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const postLoginPath = getPostLoginPath(location.state?.from);
  const emailErrorId = useId();
  const firstNameInputId = useId();
  const firstNameHelpId = `${firstNameInputId}-help`;
  const lastNameInputId = useId();
  const lastNameHelpId = `${lastNameInputId}-help`;
  const usernameInputId = useId();
  const usernameHelpId = `${usernameInputId}-help`;
  const emailInputRef = useRef<HTMLInputElement>(null);
  const firstNameInputRef = useRef<HTMLInputElement>(null);
  const lastNameInputRef = useRef<HTMLInputElement>(null);
  const confirmPasswordInputRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [invalidNameField, setInvalidNameField] = useState<'firstName' | 'lastName' | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [registrationFields, setRegistrationFields] = useState<RegistrationField[]>([]);
  const registrationFieldsRef = useRef<RegistrationField[]>([]);
  const [registrationFieldValues, setRegistrationFieldValues] = useState<RegistrationFieldValues>({});
  const [registrationFieldsLoading, setRegistrationFieldsLoading] = useState(true);
  const [registrationFieldsError, setRegistrationFieldsError] = useState('');
  const [registrationFieldsRetryVersion, setRegistrationFieldsRetryVersion] = useState(0);
  const [registrationFieldsChanged, setRegistrationFieldsChanged] = useState(false);
  const [invalidRegistrationFieldId, setInvalidRegistrationFieldId] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [approvalSubmitted, setApprovalSubmitted] = useState(false);
  const approvalConfirmationHeadingRef = useRef<HTMLHeadingElement>(null);
  const submissionInFlightRef = useRef(false);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setRegistrationFieldsLoading(true);
    setRegistrationFieldsError('');
    api.get<{ fields: RegistrationField[] }>('/api/registration-fields', { signal: controller.signal })
      .then((result) => {
        if (!active) return;
        const previousFields = registrationFieldsRef.current;
        registrationFieldsRef.current = result.fields;
        setRegistrationFields(result.fields);
        setRegistrationFieldValues((current) => refreshRegistrationFieldValues(previousFields, result.fields, current));
      })
      .catch((cause) => { if (active) setRegistrationFieldsError(cause instanceof ApiError ? cause.message : 'Registration details could not be loaded.'); })
      .finally(() => { if (active) setRegistrationFieldsLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [registrationFieldsRetryVersion]);
  // Move focus to the confirmation after the form is replaced so its result is announced.
  useEffect(() => {
    if (approvalSubmitted) approvalConfirmationHeadingRef.current?.focus();
  }, [approvalSubmitted]);
  if (configured && user) return <Navigate to={postLoginPath} replace />;
  if (!configured) return <Navigate to="/setup" replace />;
  if (approvalSubmitted) return <AuthPanel><h1 ref={approvalConfirmationHeadingRef} tabIndex={-1}>Registration submitted</h1><p className="auth-description">Your account is waiting for administrator approval. You can sign in after it has been approved.</p><p className="auth-footer"><Link to="/login">Back to sign in</Link></p></AuthPanel>;
  if (!registrationEnabled) return <AuthPanel><h1>Registration is closed</h1><p className="auth-description">An administrator has disabled new account registrations.</p><p className="auth-footer"><Link to="/login">Back to sign in</Link></p></AuthPanel>;
  if (!registrationAvailable) return <AuthPanel><h1>Registration is closed</h1><p className="auth-description">The platform has reached its registered-account limit.</p><p className="auth-footer"><Link to="/login">Back to sign in</Link></p></AuthPanel>;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(''); setInvalidRegistrationFieldId('');
    setInvalidNameField(null);
    setRegistrationFieldsChanged(false);
    const currentEmailError = validateEmail(email);
    if (currentEmailError) {
      setEmailError(currentEmailError);
      window.requestAnimationFrame(() => emailInputRef.current?.focus());
      return;
    }
    setEmailError('');
    const firstNameError = accountNameError(firstName, 'First name');
    if (firstNameError) {
      setInvalidNameField('firstName');
      setError(firstNameError);
      window.requestAnimationFrame(() => firstNameInputRef.current?.focus());
      return;
    }
    const lastNameError = accountNameError(lastName, 'Last name');
    if (lastNameError) {
      setInvalidNameField('lastName');
      setError(lastNameError);
      window.requestAnimationFrame(() => lastNameInputRef.current?.focus());
      return;
    }
    setInvalidNameField(null);
    const normalizedFirstName = normalizeAccountName(firstName);
    const normalizedLastName = normalizeAccountName(lastName);
    setFirstName(normalizedFirstName);
    setLastName(normalizedLastName);
    const missingField = findMissingRequiredRegistrationField(registrationFields, registrationFieldValues);
    if (missingField) {
      setError(`${missingField.label} is required.`);
      setInvalidRegistrationFieldId(missingField.id);
      window.requestAnimationFrame(() => document.getElementById(`registration-field-${missingField.id}`)?.focus());
      return;
    }
    const confirmationError = getPasswordConfirmationError(password, confirmPassword);
    if (confirmationError) {
      setError(confirmationError);
      confirmPasswordInputRef.current?.focus();
      return;
    }
    if (!acquireSubmissionLock(submissionInFlightRef)) return;
    setSaving(true);
    try {
      const result = await signUp(email, normalizedFirstName, normalizedLastName, username, password, confirmPassword, registrationFieldValues);
      if (result.approvalRequired) { setApprovalSubmitted(true); return; }
      navigate(postLoginPath, { replace: true });
    }
    catch (cause) {
      if (cause instanceof ApiError && (cause.code === 'registration_fields_changed' || cause.code === 'invalid_registration_answers')) {
        // Select options may change while the learner's registration form is open; refresh before asking them to retry.
        setRegistrationFieldsChanged(true);
        setRegistrationFieldsLoading(true);
        setRegistrationFieldsRetryVersion((version) => version + 1);
      } else if (cause instanceof ApiError && cause.code === 'invalid_email') {
        setEmailError(cause.message);
        window.requestAnimationFrame(() => emailInputRef.current?.focus());
      } else if (cause instanceof ApiError && cause.code === 'invalid_name') {
        const invalidField = cause.message.startsWith('Last name') ? 'lastName' : 'firstName';
        setInvalidNameField(invalidField);
        setError(cause.message);
        window.requestAnimationFrame(() => (invalidField === 'lastName' ? lastNameInputRef.current : firstNameInputRef.current)?.focus());
      } else setError(cause instanceof ApiError ? cause.message : 'Registration failed. Try again.');
    }
    finally { releaseSubmissionLock(submissionInFlightRef); setSaving(false); }
  }

  return <AuthPanel><h1>Create your account</h1><p className="auth-description">Join your learning space and explore available courses.</p>
    {registrationApprovalRequired && <p className="auth-approval-note" role="note">New accounts need administrator approval before they can sign in.</p>}
    <form onSubmit={submit} className="form-stack" aria-busy={saving}>
      <label>Email<input ref={emailInputRef} name="email" required type="email" maxLength={254} autoComplete="email" aria-invalid={emailError ? true : undefined} aria-describedby={emailError ? emailErrorId : undefined} value={email} onChange={(event) => { setEmail(event.target.value); setError(''); }} disabled={saving} /></label>
      {emailError && <p id={emailErrorId} className="form-error" role="alert">{emailError}</p>}
      {/* Keep certificate guidance in each field's description instead of its accessible name. */}
      <div className="account-name-fields registration-name-fields">
        <div className="registration-name-field">
          <label htmlFor={firstNameInputId}>First name</label>
          <small id={firstNameHelpId}>Required · used on certificates</small>
          <input
            id={firstNameInputId}
            ref={firstNameInputRef}
            name="firstName"
            required
            maxLength={MAX_ACCOUNT_NAME_LENGTH}
            autoComplete="given-name"
            aria-invalid={invalidNameField === 'firstName' || undefined}
            aria-describedby={invalidNameField === 'firstName' ? `${firstNameHelpId} registration-form-error` : firstNameHelpId}
            value={firstName}
            onChange={(event) => {
              setFirstName(event.target.value);
              if (invalidNameField === 'firstName') { setInvalidNameField(null); setError(''); }
            }}
            disabled={saving}
          />
        </div>
        <div className="registration-name-field">
          <label htmlFor={lastNameInputId}>Last name</label>
          <small id={lastNameHelpId}>Required · used on certificates</small>
          <input
            id={lastNameInputId}
            ref={lastNameInputRef}
            name="lastName"
            required
            maxLength={MAX_ACCOUNT_NAME_LENGTH}
            autoComplete="family-name"
            aria-invalid={invalidNameField === 'lastName' || undefined}
            aria-describedby={invalidNameField === 'lastName' ? `${lastNameHelpId} registration-form-error` : lastNameHelpId}
            value={lastName}
            onChange={(event) => {
              setLastName(event.target.value);
              if (invalidNameField === 'lastName') { setInvalidNameField(null); setError(''); }
            }}
            disabled={saving}
          />
        </div>
      </div>
      <div className="form-stack-username-field"><label htmlFor={usernameInputId}>Username</label><input id={usernameInputId} name="username" aria-describedby={usernameHelpId} required minLength={3} maxLength={32} pattern="[A-Za-z0-9_.-]+" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(event) => setUsername(event.target.value)} disabled={saving} /><small id={usernameHelpId}>Letters, numbers, dots, underscores, and hyphens.</small></div>
      {registrationFieldsLoading ? <p className="registration-fields-loading" role="status">Loading registration details…</p> : registrationFieldsError
        ? <div className="registration-fields-load-error"><p className="form-error" role="alert">{registrationFieldsError}</p><Button type="button" variant="secondary" onClick={() => setRegistrationFieldsRetryVersion((version) => version + 1)}>Retry</Button></div>
        : <RegistrationFieldsForm fields={registrationFields} values={registrationFieldValues} disabled={saving} invalidFieldId={invalidRegistrationFieldId} onChange={(id, value) => { setRegistrationFieldValues((current) => ({ ...current, [id]: value })); setRegistrationFieldsChanged(false); if (id === invalidRegistrationFieldId) { setInvalidRegistrationFieldId(''); setError(''); } }} />}
      {registrationFieldsChanged && <p className="registration-fields-changed" role="status" aria-live="polite">{registrationFieldsLoading ? 'Registration details changed. Refreshing the latest fields…' : registrationFieldsError ? 'Registration details changed. Retry loading the latest fields before continuing.' : 'Registration details changed. Answers that still match were kept; review the updated fields and submit again.'}</p>}
      <PasswordField label="Password" name="password" required minLength={12} maxLength={256} autoComplete="new-password" value={password} onChange={(event) => { setPassword(event.target.value); setError((currentError) => clearPasswordConfirmationError(currentError)); }} disabled={saving} hint="Use at least 12 characters." />
      <PasswordField label="Confirm password" name="confirmPassword" inputRef={confirmPasswordInputRef} {...passwordConfirmationFieldProps(error, 'registration-form-error')} required minLength={12} maxLength={256} autoComplete="new-password" value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setError((currentError) => clearPasswordConfirmationError(currentError)); }} disabled={saving} />
      {error && <p id="registration-form-error" className="form-error" role="alert">{error}</p>}
      <Button type="submit" disabled={saving || registrationFieldsLoading || Boolean(registrationFieldsError)}>{saving ? 'Creating account…' : 'Create account'}</Button>
    </form>
    <p className="auth-footer">Already have an account? <Link to="/login">Sign in</Link></p>
  </AuthPanel>;
}

export function AccountSecurityPage() {
  const { user, refresh } = useAuth();
  const passwordErrorId = useId();
  const profileNameErrorId = useId();
  const [firstName, setFirstName] = useState(user?.firstName || '');
  const [lastName, setLastName] = useState(user?.lastName || '');
  const [profileMessage, setProfileMessage] = useState('');
  const [profileError, setProfileError] = useState('');
  const [invalidProfileNameField, setInvalidProfileNameField] = useState<'firstName' | 'lastName' | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const profileSubmissionInFlightRef = useRef(false);
  const firstNameInputRef = useRef<HTMLInputElement>(null);
  const lastNameInputRef = useRef<HTMLInputElement>(null);
  const confirmPasswordInputRef = useRef<HTMLInputElement>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [invalidPasswordField, setInvalidPasswordField] = useState<AccountPasswordField | null>(null);
  const [saving, setSaving] = useState(false);
  const passwordSubmissionInFlightRef = useRef(false);
  useEffect(() => {
    setFirstName(user?.firstName || '');
    setLastName(user?.lastName || '');
  }, [user?.firstName, user?.lastName]);

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    setProfileError(''); setProfileMessage(''); setInvalidProfileNameField(null);
    const firstNameError = accountNameError(firstName, 'First name');
    if (firstNameError) {
      setInvalidProfileNameField('firstName');
      setProfileError(firstNameError);
      window.requestAnimationFrame(() => firstNameInputRef.current?.focus());
      return;
    }
    const lastNameError = accountNameError(lastName, 'Last name');
    if (lastNameError) {
      setInvalidProfileNameField('lastName');
      setProfileError(lastNameError);
      window.requestAnimationFrame(() => lastNameInputRef.current?.focus());
      return;
    }
    if (!acquireSubmissionLock(profileSubmissionInFlightRef)) return;
    setSavingProfile(true);
    try {
      const result = await api.put<{ certificatesIssued: number }>('/api/auth/profile', {
        firstName: normalizeAccountName(firstName),
        lastName: normalizeAccountName(lastName),
      });
      const certificateMessage = result.certificatesIssued > 0
        ? ` ${result.certificatesIssued} newly eligible ${result.certificatesIssued === 1 ? 'certificate is' : 'certificates are'} now in My learning.`
        : '';
      try {
        await refresh();
        setProfileMessage(result.certificatesIssued > 0 ? `Profile updated.${certificateMessage}` : 'Profile details updated.');
      } catch {
        setProfileMessage(`Profile details were saved, but account information could not refresh. Reload to see the updated name.${certificateMessage}`);
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'invalid_name') {
        // Keep authoritative server validation beside the certificate-name field that needs correction.
        const invalidField = cause.message.startsWith('Last name') ? 'lastName' : 'firstName';
        setInvalidProfileNameField(invalidField);
        setProfileError(cause.message);
        window.requestAnimationFrame(() => (invalidField === 'lastName' ? lastNameInputRef.current : firstNameInputRef.current)?.focus());
      } else setProfileError(cause instanceof ApiError ? cause.message : 'Profile details could not be updated.');
    }
    finally { releaseSubmissionLock(profileSubmissionInFlightRef); setSavingProfile(false); }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const confirmationError = getPasswordConfirmationError(password, confirmPassword);
    if (confirmationError) {
      setError(confirmationError);
      setInvalidPasswordField('confirmation');
      setMessage('');
      confirmPasswordInputRef.current?.focus();
      return;
    }
    if (!acquireSubmissionLock(passwordSubmissionInFlightRef)) return;
    setError(''); setInvalidPasswordField(null); setMessage(''); setSaving(true);
    try {
      await api.put('/api/auth/password', { currentPassword, password, confirmPassword });
      setCurrentPassword(''); setPassword(''); setConfirmPassword(''); setInvalidPasswordField(null); setMessage('Your password has been updated. Other active sessions have been signed out.');
    } catch (cause) {
      let authRefreshFailed = false;
      if (cause instanceof ApiError && (cause.status === 401 || cause.code === 'password_changed')) {
        setCurrentPassword(''); setPassword(''); setConfirmPassword('');
        try { await refresh(); } catch { authRefreshFailed = true; }
      }
      const message = cause instanceof ApiError ? cause.message : 'Password could not be updated.';
      setInvalidPasswordField(cause instanceof ApiError ? accountPasswordFieldForError(cause.code) : null);
      setError(authRefreshFailed ? `${message} Your sign-in status could not be refreshed. Reload before continuing.` : message);
    }
    finally { releaseSubmissionLock(passwordSubmissionInFlightRef); setSaving(false); }
  }
  function clearPasswordFieldFeedback(field: AccountPasswordField) {
    if (!shouldClearAccountPasswordFieldErrorOnEdit(field, invalidPasswordField)) return;
    setInvalidPasswordField(null);
    setError('');
  }
  return <div className="narrow-content account-settings-page"><div className="breadcrumbs"><Link to="/courses">Browse courses</Link><span>/</span><span>Account settings</span></div><h1>Account settings</h1><p className="lead-copy">Manage your certificate name and account password.</p>
    <section className="account-settings-section"><h2>Profile details</h2><p>Certificates use your first and last name. Your email address is also included on certificates.</p>
      <form className="surface-form form-stack" onSubmit={saveProfile} aria-busy={savingProfile}>
        <label>Email<input type="email" value={user?.email || ''} readOnly aria-describedby="profile-email-help" /></label><small id="profile-email-help">Contact an administrator if you need to change your email address.</small>
        <div className="account-name-fields">
          <label>First name<input ref={firstNameInputRef} name="firstName" required maxLength={MAX_ACCOUNT_NAME_LENGTH} autoComplete="given-name" aria-invalid={invalidProfileNameField === 'firstName' || undefined} aria-describedby={invalidProfileNameField === 'firstName' ? profileNameErrorId : undefined} value={firstName} onChange={(event) => { setFirstName(event.target.value); setProfileMessage(''); if (invalidProfileNameField === 'firstName') { setInvalidProfileNameField(null); setProfileError(''); } }} disabled={savingProfile} /></label>
          <label>Last name<input ref={lastNameInputRef} name="lastName" required maxLength={MAX_ACCOUNT_NAME_LENGTH} autoComplete="family-name" aria-invalid={invalidProfileNameField === 'lastName' || undefined} aria-describedby={invalidProfileNameField === 'lastName' ? profileNameErrorId : undefined} value={lastName} onChange={(event) => { setLastName(event.target.value); setProfileMessage(''); if (invalidProfileNameField === 'lastName') { setInvalidProfileNameField(null); setProfileError(''); } }} disabled={savingProfile} /></label>
        </div>
        {profileMessage && <p className="form-success" role="status">{profileMessage}</p>}{profileError && <p id={profileNameErrorId} className="form-error" role="alert">{profileError}</p>}
        <Button type="submit" disabled={savingProfile}>{savingProfile ? 'Saving profile…' : 'Save profile details'}</Button>
      </form>
    </section>
    <section className="account-settings-section"><h2>Change password</h2><p className="lead-copy">Choose a new password. Other signed-in devices will be signed out after you save.</p>
    <form className="surface-form form-stack" onSubmit={submit} aria-busy={saving}>
      <PasswordField label="Current password" name="currentPassword" required maxLength={256} autoComplete="current-password" aria-invalid={invalidPasswordField === 'current' || undefined} aria-describedby={invalidPasswordField === 'current' ? passwordErrorId : undefined} value={currentPassword} onChange={(event) => { setCurrentPassword(event.target.value); clearPasswordFieldFeedback('current'); }} disabled={saving} />
      <PasswordField label="New password" name="newPassword" required minLength={12} maxLength={256} autoComplete="new-password" aria-invalid={invalidPasswordField === 'new' || undefined} aria-describedby={invalidPasswordField === 'new' ? passwordErrorId : undefined} value={password} onChange={(event) => { setPassword(event.target.value); clearPasswordFieldFeedback('new'); setError((currentError) => clearPasswordConfirmationError(currentError)); }} disabled={saving} hint="Use at least 12 characters." />
      <PasswordField label="Confirm new password" name="confirmPassword" inputRef={confirmPasswordInputRef} {...passwordConfirmationFieldProps(error, passwordErrorId, invalidPasswordField === 'confirmation')} required minLength={12} maxLength={256} autoComplete="new-password" value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); clearPasswordFieldFeedback('confirmation'); setError((currentError) => clearPasswordConfirmationError(currentError)); }} disabled={saving} />
      {message && <p className="form-success" role="status">{message}</p>}{error && <p id={passwordErrorId} className="form-error" role="alert">{error}</p>}
      <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Update password'}</Button>
    </form>
    </section>
  </div>;
}
