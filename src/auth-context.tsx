import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getMe, getSetupStatus } from './api';
import type { Role, User } from './types';

interface AuthContextValue {
  user: User | null;
  platformName: string;
  configured: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  signIn: (username: string, password: string) => Promise<void>;
  signUp: (username: string, password: string, confirmPassword: string) => Promise<void>;
  completeSetup: (platformName: string, username: string, password: string, confirmPassword: string) => Promise<void>;
  signOut: () => Promise<void>;
  setPlatformName: (name: string) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [platformName, setPlatformNameState] = useState('OpenLearning');
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [setup, me] = await Promise.all([getSetupStatus(), getMe()]);
    setConfigured(setup.configured);
    setPlatformNameState(me.platformName || setup.platformName || 'OpenLearning');
    setUser(me.user);
    await api.refreshCsrf();
  }, []);

  useEffect(() => {
    refresh().catch(() => undefined).finally(() => setLoading(false));
  }, [refresh]);

  const signIn = useCallback(async (username: string, password: string) => {
    const result = await api.post<{ user: User; platformName: string }>('/api/auth/login', { username, password });
    api.clearCsrf();
    await api.refreshCsrf();
    setUser(result.user);
    if (result.platformName) setPlatformNameState(result.platformName);
  }, []);

  const signUp = useCallback(async (username: string, password: string, confirmPassword: string) => {
    const result = await api.post<{ user: User }>('/api/auth/register', { username, password, confirmPassword });
    api.clearCsrf();
    await api.refreshCsrf();
    setUser(result.user);
  }, []);

  const completeSetup = useCallback(async (name: string, username: string, password: string, confirmPassword: string) => {
    const result = await api.post<{ user: User; platformName: string }>('/api/setup', {
      platformName: name, username, password, confirmPassword,
    });
    api.clearCsrf();
    await api.refreshCsrf();
    setUser(result.user);
    setConfigured(true);
    setPlatformNameState(result.platformName);
  }, []);

  const signOut = useCallback(async () => {
    await api.post('/api/auth/logout');
    api.clearCsrf();
    setUser(null);
    await api.refreshCsrf();
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user, platformName, configured, loading, refresh, signIn, signUp, completeSetup, signOut,
    setPlatformName: setPlatformNameState,
  }), [user, platformName, configured, loading, refresh, signIn, signUp, completeSetup, signOut]);

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
