import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api, getMe, getSetupStatus } from './api';
import { BRAND_PALETTES, DEFAULT_PALETTE } from './branding';
import type { BrandingPalette, ConnectionProtocol, PlatformConfiguration } from './branding';
import { isRegistrationAvailabilityError } from './registration-availability';
import type { RegistrationFieldValues, Role, User } from './types';

interface AuthContextValue {
  user: User | null;
  platformName: string;
  platformIcon: string | null;
  themePalette: BrandingPalette;
  connectionProtocol: ConnectionProtocol;
  registrationEnabled: boolean;
  registrationApprovalRequired: boolean;
  registrationAvailable: boolean;
  userLimit: number;
  configured: boolean;
  setupAvailable: boolean;
  loading: boolean;
  startupError: string | null;
  retryStartup: () => Promise<void>;
  refresh: () => Promise<void>;
  signIn: (username: string, password: string) => Promise<void>;
  signUp: (email: string, firstName: string, lastName: string, username: string, password: string, confirmPassword: string, registrationFieldValues: RegistrationFieldValues) => Promise<{ approvalRequired: boolean }>;
  completeSetup: (platformName: string, email: string, firstName: string, lastName: string, username: string, password: string, confirmPassword: string, setupToken: string, configuration: Pick<PlatformConfiguration, 'themePalette' | 'platformIcon' | 'connectionProtocol' | 'registrationEnabled' | 'userLimit'>) => Promise<void>;
  signOut: () => Promise<void>;
  setBranding: (name: string, themePalette: BrandingPalette, platformIcon: string | null) => void;
  setPlatformAccessSettings: (connectionProtocol: ConnectionProtocol, registrationEnabled: boolean, registrationApprovalRequired: boolean, registrationAvailable: boolean, userLimit: number) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [platformName, setPlatformNameState] = useState('OpenLearning');
  const [platformIcon, setPlatformIconState] = useState<string | null>(null);
  const [themePalette, setThemePaletteState] = useState<BrandingPalette>(DEFAULT_PALETTE);
  const [connectionProtocol, setConnectionProtocolState] = useState<ConnectionProtocol>('http');
  const [registrationEnabled, setRegistrationEnabledState] = useState(true);
  const [registrationApprovalRequired, setRegistrationApprovalRequiredState] = useState(false);
  const [registrationAvailable, setRegistrationAvailableState] = useState(true);
  const [userLimit, setUserLimitState] = useState(0);
  const [configured, setConfigured] = useState(false);
  const [setupAvailable, setSetupAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [startupError, setStartupError] = useState<string | null>(null);
  const startupRequestId = useRef(0);
  const authStateRevision = useRef(0);
  const refreshRequestId = useRef(0);
  const lastBrandTitle = useRef('OpenLearning');

  const refresh = useCallback(async () => {
    const requestId = ++refreshRequestId.current;
    const stateRevision = authStateRevision.current;
    const [setup, me] = await Promise.all([getSetupStatus(), getMe()]);
    await api.refreshCsrf();
    if (requestId !== refreshRequestId.current || stateRevision !== authStateRevision.current) return;
    authStateRevision.current += 1;
    setConfigured(setup.configured);
    setSetupAvailable(setup.setupAvailable);
    setPlatformNameState(me.platformName || setup.platformName || 'OpenLearning');
    setPlatformIconState(me.platformIcon ?? setup.platformIcon ?? null);
    setThemePaletteState(me.themePalette || setup.themePalette || DEFAULT_PALETTE);
    setConnectionProtocolState(me.connectionProtocol || setup.connectionProtocol || 'http');
    setRegistrationEnabledState(me.registrationEnabled ?? setup.registrationEnabled ?? true);
    setRegistrationApprovalRequiredState(me.registrationApprovalRequired ?? setup.registrationApprovalRequired ?? false);
    setRegistrationAvailableState(me.registrationAvailable ?? setup.registrationAvailable ?? true);
    setUserLimitState(me.userLimit ?? setup.userLimit ?? 0);
    setUser(me.user);
  }, []);

  const retryStartup = useCallback(async () => {
    const requestId = ++startupRequestId.current;
    setLoading(true);
    setStartupError(null);
    try {
      await refresh();
      if (requestId === startupRequestId.current) setStartupError(null);
    } catch (cause) {
      if (requestId === startupRequestId.current) {
        setStartupError(cause instanceof ApiError ? cause.message : 'Could not reach the learning platform. Check your connection and try again.');
      }
    } finally {
      if (requestId === startupRequestId.current) setLoading(false);
    }
  }, [refresh]);

  useEffect(() => {
    document.documentElement.dataset.palette = themePalette;
  }, [themePalette]);

  useEffect(() => {
    if (document.title === lastBrandTitle.current) document.title = platformName;
    lastBrandTitle.current = platformName;
    const themeColor = BRAND_PALETTES.find((palette) => palette.id === themePalette)?.color ?? BRAND_PALETTES[0].color;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor);
    let favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!favicon) {
      favicon = document.createElement('link');
      favicon.rel = 'icon';
      document.head.append(favicon);
    }
    favicon.href = platformIcon ?? '/favicon.svg';
    if (platformIcon) favicon.removeAttribute('type');
    else favicon.type = 'image/svg+xml';
  }, [platformIcon, platformName, themePalette]);

  useEffect(() => {
    void retryStartup();
  }, [retryStartup]);

  const signIn = useCallback(async (username: string, password: string) => {
    const result = await api.post<{ user: User } & PlatformConfiguration>('/api/auth/login', { username, password });
    authStateRevision.current += 1;
    api.clearCsrf();
    setUser(result.user);
    if (result.platformName) setPlatformNameState(result.platformName);
    setPlatformIconState(result.platformIcon ?? null);
    setThemePaletteState(result.themePalette || DEFAULT_PALETTE);
    setConnectionProtocolState(result.connectionProtocol || 'http');
    setRegistrationEnabledState(result.registrationEnabled ?? true);
    setRegistrationApprovalRequiredState(result.registrationApprovalRequired ?? false);
    setRegistrationAvailableState(result.registrationAvailable ?? true);
    setUserLimitState(result.userLimit ?? 0);
  }, []);

  const signUp = useCallback(async (email: string, firstName: string, lastName: string, username: string, password: string, confirmPassword: string, registrationFieldValues: RegistrationFieldValues) => {
    let result: { user: User; registrationAvailable: boolean; approvalRequired?: boolean };
    try {
      result = await api.post<{ user: User; registrationAvailable: boolean; approvalRequired?: boolean }>('/api/auth/register', { email, firstName, lastName, username, password, confirmPassword, registrationFieldValues });
    } catch (cause) {
      if (isRegistrationAvailabilityError(cause)) {
        try { await refresh(); } catch { /* Keep the original registration error visible if status refresh fails. */ }
      }
      throw cause;
    }
    setRegistrationAvailableState(result.registrationAvailable);
    const approvalRequired = result.approvalRequired === true;
    if (!approvalRequired) {
      authStateRevision.current += 1;
      api.clearCsrf();
      setUser(result.user);
    }
    return { approvalRequired };
  }, [refresh]);

  const completeSetup = useCallback(async (name: string, email: string, firstName: string, lastName: string, username: string, password: string, confirmPassword: string, setupToken: string, configuration: Pick<PlatformConfiguration, 'themePalette' | 'platformIcon' | 'connectionProtocol' | 'registrationEnabled' | 'userLimit'>) => {
    const result = await api.post<{ user: User } & PlatformConfiguration>('/api/setup', {
      platformName: name, email, firstName, lastName, username, password, confirmPassword, setupToken, ...configuration,
    });
    authStateRevision.current += 1;
    api.clearCsrf();
    setUser(result.user);
    setConfigured(true);
    setSetupAvailable(false);
    setPlatformNameState(result.platformName);
    setPlatformIconState(result.platformIcon ?? null);
    setThemePaletteState(result.themePalette || DEFAULT_PALETTE);
    setConnectionProtocolState(result.connectionProtocol || 'http');
    setRegistrationEnabledState(result.registrationEnabled ?? true);
    setRegistrationApprovalRequiredState(result.registrationApprovalRequired ?? false);
    setRegistrationAvailableState(result.registrationAvailable ?? true);
    setUserLimitState(result.userLimit ?? 0);
  }, []);

  const setBranding = useCallback((name: string, palette: BrandingPalette, icon: string | null) => {
    authStateRevision.current += 1;
    setPlatformNameState(name);
    setThemePaletteState(palette);
    setPlatformIconState(icon);
  }, []);

  const setPlatformAccessSettings = useCallback((protocol: ConnectionProtocol, allowRegistration: boolean, approvalRequired: boolean, isRegistrationAvailable: boolean, limit: number) => {
    authStateRevision.current += 1;
    setConnectionProtocolState(protocol);
    setRegistrationEnabledState(allowRegistration);
    setRegistrationApprovalRequiredState(approvalRequired);
    setRegistrationAvailableState(isRegistrationAvailable);
    setUserLimitState(limit);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } catch (cause) {
      if (!(cause instanceof ApiError && cause.status === 401 && cause.code === 'unauthorized')) throw cause;
    }
    authStateRevision.current += 1;
    api.clearCsrf();
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user, platformName, platformIcon, themePalette, connectionProtocol, registrationEnabled, registrationApprovalRequired, registrationAvailable, userLimit, configured, setupAvailable, loading, startupError, retryStartup, refresh, signIn, signUp, completeSetup, signOut, setBranding, setPlatformAccessSettings,
  }), [user, platformName, platformIcon, themePalette, connectionProtocol, registrationEnabled, registrationApprovalRequired, registrationAvailable, userLimit, configured, setupAvailable, loading, startupError, retryStartup, refresh, signIn, signUp, completeSetup, signOut, setBranding, setPlatformAccessSettings]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}

export function roleLabel(role: Role) {
  return role === 'admin' ? 'Administrator' : role === 'moderator' ? 'Moderator' : 'Learner';
}
