import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type AuthUser = { id: string; email: string; orgId: string };

type AuthState =
  | { status: 'loading' }
  | { status: 'signed-in'; user: AuthUser }
  | { status: 'signed-out' };

type AuthContextValue = {
  state: AuthState;
  register: (email: string, password: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (res.ok) {
        const body = (await res.json()) as { user: AuthUser };
        setState({ status: 'signed-in', user: body.user });
      } else {
        setState({ status: 'signed-out' });
      }
    } catch {
      setState({ status: 'signed-out' });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const register = useCallback(
    async (email: string, password: string) => {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        throw new Error(await readError(res, 'Registration failed'));
      }
      const body = (await res.json()) as { user: AuthUser };
      setState({ status: 'signed-in', user: body.user });
    },
    [],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        throw new Error(await readError(res, 'Login failed'));
      }
      const body = (await res.json()) as { user: AuthUser };
      setState({ status: 'signed-in', user: body.user });
    },
    [],
  );

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    setState({ status: 'signed-out' });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ state, register, login, logout }),
    [state, register, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error === 'invalid_credentials') return 'Invalid email or password.';
    if (body.error === 'email_taken') return 'An account with that email already exists.';
    if (body.error === 'invalid_credentials_shape') return 'Email and an 8+ character password are required.';
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}
