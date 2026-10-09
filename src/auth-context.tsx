import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getMe, getSetupStatus } from './api';
import { BRAND_PALETTES, DEFAULT_PALETTE } from './branding';
import type { BrandingPalette, ConnectionProtocol, PlatformConfiguration } from './branding';
import type { Role, User } from './types';

interface AuthContextValue {
  user: User | null;
  platformName: string;
  platformIcon: string | null;
  themePalette: BrandingPalette;
  connectionProtocol: ConnectionProtocol;
  registrationEnabled: boolean;
  registrationAvailable: boolean;
  userLimit: number;
  configured: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  signIn: (username: string, password: string) => Promise<void>;
  signUp: (username: string, password: string, confirmPassword: string) => Promise<void>;
  completeSetup: (platformName: string, username: string, password: string, confirmPassword: string, configuration: Pick<PlatformConfiguration, 'themePalette' | 'platformIcon' | 'connectionProtocol' | 'registrationEnabled' | 'userLimit'>) => Promise<void>;
  signOut: () => Promise<void>;
  setBranding: (name: string, themePalette: BrandingPalette, platformIcon: string | null) => void;
  setPlatformAccessSettings: (connectionProtocol: ConnectionProtocol, registrationEnabled: boolean, registrationAvailable: boolean, userLimit: number) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [platformName, setPlatformNameState] = useState('OpenLearning');
  const [platformIcon, setPlatformIconState] = useState<string | null>(null);
  const [themePalette, setThemePaletteState] = useState<BrandingPalette>(DEFAULT_PALETTE);
  const [connectionProtocol, setConnectionProtocolState] = useState<ConnectionProtocol>('http');
  const [registrationEnabled, setRegistrationEnabledState] = useState(true);
  const [registrationAvailable, setRegistrationAvailableState] = useState(true);
  const [userLimit, setUserLimitState] = useState(0);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [setup, me] = await Promise.all([getSetupStatus(), getMe()]);
    setConfigured(setup.configured);
    setPlatformNameState(me.platformName || setup.platformName || 'OpenLearning');
    setPlatformIconState(me.platformIcon ?? setup.platformIcon ?? null);
    setThemePaletteState(me.themePalette || setup.themePalette || DEFAULT_PALETTE);
    setConnectionProtocolState(me.connectionProtocol || setup.connectionProtocol || 'http');
    setRegistrationEnabledState(me.registrationEnabled ?? setup.registrationEnabled ?? true);
    setRegistrationAvailableState(me.registrationAvailable ?? setup.registrationAvailable ?? true);
    setUserLimitState(me.userLimit ?? setup.userLimit ?? 0);
    setUser(me.user);
    await api.refreshCsrf();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.palette = themePalette;
  }, [themePalette]);

  useEffect(() => {
    document.title = platformName;
    const themeColor = BRAND_PALETTES.find((palette) => palette.id === themePalette)?.color ?? BRAND_PALETTES[0].color;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor);
    let favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (platformIcon) {
      if (!favicon) {
        favicon = document.createElement('link');
        favicon.rel = 'icon';
        document.head.append(favicon);
      }
      favicon.href = platformIcon;
    } else {
      favicon?.remove();
    }
  }, [platformIcon, platformName, themePalette]);

  useEffect(() => {
    refresh().catch(() => undefined).finally(() => setLoading(false));
  }, [refresh]);

  const signIn = useCallback(async (username: string, password: string) => {
    const result = await api.post<{ user: User } & PlatformConfiguration>('/api/auth/login', { username, password });
    api.clearCsrf();
    await api.refreshCsrf();
    setUser(result.user);
    if (result.platformName) setPlatformNameState(result.platformName);
    setPlatformIconState(result.platformIcon ?? null);
    setThemePaletteState(result.themePalette || DEFAULT_PALETTE);
    setConnectionProtocolState(result.connectionProtocol || 'http');
    setRegistrationEnabledState(result.registrationEnabled ?? true);
    setRegistrationAvailableState(result.registrationAvailable ?? true);
    setUserLimitState(result.userLimit ?? 0);
  }, []);

  const signUp = useCallback(async (username: string, password: string, confirmPassword: string) => {
    const result = await api.post<{ user: User; registrationAvailable: boolean }>('/api/auth/register', { username, password, confirmPassword });
    api.clearCsrf();
    await api.refreshCsrf();
    setUser(result.user);
    setRegistrationAvailableState(result.registrationAvailable);
  }, []);

  const completeSetup = useCallback(async (name: string, username: string, password: string, confirmPassword: string, configuration: Pick<PlatformConfiguration, 'themePalette' | 'platformIcon' | 'connectionProtocol' | 'registrationEnabled' | 'userLimit'>) => {
    const result = await api.post<{ user: User } & PlatformConfiguration>('/api/setup', {
      platformName: name, username, password, confirmPassword, ...configuration,
    });
    api.clearCsrf();
    await api.refreshCsrf();
    setUser(result.user);
    setConfigured(true);
    setPlatformNameState(result.platformName);
    setPlatformIconState(result.platformIcon ?? null);
    setThemePaletteState(result.themePalette || DEFAULT_PALETTE);
    setConnectionProtocolState(result.connectionProtocol || 'http');
    setRegistrationEnabledState(result.registrationEnabled ?? true);
    setRegistrationAvailableState(result.registrationAvailable ?? true);
    setUserLimitState(result.userLimit ?? 0);
  }, []);

  const setBranding = useCallback((name: string, palette: BrandingPalette, icon: string | null) => {
    setPlatformNameState(name);
    setThemePaletteState(palette);
    setPlatformIconState(icon);
  }, []);

  const setPlatformAccessSettings = useCallback((protocol: ConnectionProtocol, allowRegistration: boolean, isRegistrationAvailable: boolean, limit: number) => {
    setConnectionProtocolState(protocol);
    setRegistrationEnabledState(allowRegistration);
    setRegistrationAvailableState(isRegistrationAvailable);
    setUserLimitState(limit);
  }, []);

  const signOut = useCallback(async () => {
    await api.post('/api/auth/logout');
    api.clearCsrf();
    setUser(null);
    await api.refreshCsrf();
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user, platformName, platformIcon, themePalette, connectionProtocol, registrationEnabled, registrationAvailable, userLimit, configured, loading, refresh, signIn, signUp, completeSetup, signOut, setBranding, setPlatformAccessSettings,
  }), [user, platformName, platformIcon, themePalette, connectionProtocol, registrationEnabled, registrationAvailable, userLimit, configured, loading, refresh, signIn, signUp, completeSetup, signOut, setBranding, setPlatformAccessSettings]);

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
