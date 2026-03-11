const API_BASE = import.meta.env.VITE_API_URL || '/api';

export function getToken() {
  return window.__REPORTER_TOKEN__ || localStorage.getItem('reporter_token');
}

export function setToken(token) {
  if (token) {
    localStorage.setItem('reporter_token', token);
    window.__REPORTER_TOKEN__ = token;
  } else {
    localStorage.removeItem('reporter_token');
    window.__REPORTER_TOKEN__ = null;
  }
}

export async function login(email, password) {
  const res = await fetch(`${API_BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Login failed');
  return data;
}

export async function signup(name, email, password) {
  const res = await fetch(`${API_BASE}/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Sign up failed');
  return data;
}

export async function getMe() {
  const token = getToken();
  if (!token) throw new Error('Not authenticated');
  const res = await fetch(`${API_BASE}/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to get user');
  return data;
}

export async function logout() {
  const token = getToken();
  if (token) {
    try {
      await fetch(`${API_BASE}/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (_) {}
  }
  setToken(null);
}

export async function streamStarted() {
  const token = getToken();
  if (!token) return;
  try {
    await fetch(`${API_BASE}/streams/start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (_) {}
}

export async function streamStopped() {
  const token = getToken();
  if (!token) return;
  try {
    await fetch(`${API_BASE}/streams/stop`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (_) {}
}

export async function sendBreakingNews(message) {
  const token = getToken();
  if (!token) throw new Error('Not authenticated');
  const res = await fetch(`${API_BASE}/alerts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ message }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to send alert');
  return data;
}

/** Upload a clip (video/audio). Returns { id, file_name, ... } or throws. */
export async function uploadClip(file) {
  const token = getToken();
  if (!token) throw new Error('Not authenticated');
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_BASE}/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  return data;
}
