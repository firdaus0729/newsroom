import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import * as api from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [reporter, setReporter] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadUser = useCallback(async () => {
    const token = api.getToken?.();
    if (!token) {
      setReporter(null);
      setLoading(false);
      return;
    }
    try {
      const me = await api.getMe();
      setReporter(me);
    } catch {
      api.setToken(null);
      setReporter(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  const signIn = useCallback(async (email, password) => {
    const data = await api.login(email, password);
    api.setToken(data.token);
    setReporter(data.reporter);
    return data.reporter;
  }, []);

  const signUp = useCallback(async (name, email, password) => {
    const data = await api.signup(name, email, password);
    api.setToken(data.token);
    setReporter(data.reporter);
    return data.reporter;
  }, []);

  const signOut = useCallback(() => {
    api.logout();
    setReporter(null);
  }, []);

  return (
    <AuthContext.Provider value={{ reporter, loading, signIn, signUp, signOut, refresh: loadUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
