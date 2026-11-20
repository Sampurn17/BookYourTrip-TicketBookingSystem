import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, readStoredAuth, storeAuth, setUnauthorizedHandler } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(() => readStoredAuth());

  const save = useCallback((value) => {
    storeAuth(value);
    setAuth(value);
  }, []);

  const logout = useCallback(() => save(null), [save]);

  useEffect(() => {
    setUnauthorizedHandler(logout);
  }, [logout]);

  // Refresh the profile once per session so provider status changes (e.g. approval) show up.
  useEffect(() => {
    if (!auth?.token) return;
    api
      .get('/auth/me')
      .then((res) => save({ token: auth.token, user: res.data.user }))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo(
    () => ({
      user: auth?.user || null,
      token: auth?.token || null,
      role: auth?.user?.role || 'guest',
      async login(email, password) {
        const res = await api.post('/auth/login', { email, password });
        save({ token: res.data.token, user: res.data.user });
        return res.data.user;
      },
      async signup(payload) {
        const res = await api.post('/auth/signup', payload);
        save({ token: res.data.token, user: res.data.user });
        return res.data.user;
      },
      setSession: save,
      updateUser(user) {
        save({ token: auth?.token, user });
      },
      logout,
    }),
    [auth, save, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

export const homeFor = (role) => ({ provider: '/provider', admin: '/admin' })[role] || '/';
