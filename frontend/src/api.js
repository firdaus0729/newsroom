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

export async function getStudioReturnFeed() {
  const res = await fetch(`${API_BASE}/studio/return-feed`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Failed to load studio return feed info');
  }
  return data;
}

/** Upload a clip (video/audio). Optional onProgress(percent 0-100). Returns { id, file_name, ... } or throws. */
export function uploadClip(file, onProgress) {
  const token = getToken();
  if (!token) return Promise.reject(new Error('Not authenticated'));
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append('file', file);
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && typeof onProgress === 'function') {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error('Upload failed'));
        }
      } else {
        try {
          const data = JSON.parse(xhr.responseText);
          reject(new Error(data.error || 'Upload failed'));
        } catch {
          reject(new Error('Upload failed'));
        }
      }
    });
    xhr.addEventListener('error', () => reject(new Error('Upload failed')));
    xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));
    xhr.open('POST', `${API_BASE}/upload`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.send(form);
  });
}
