export const API_BASE = import.meta.env.VITE_API_URL || '/api';

export function getToken() {
  return localStorage.getItem('dashboard_token');
}

export function setToken(token) {
  if (token) localStorage.setItem('dashboard_token', token);
  else localStorage.removeItem('dashboard_token');
}

export async function login(email, password) {
  const res = await fetch(`${API_BASE}/dashboard/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Login failed');
  return data;
}

export function authHeaders() {
  const token = getToken();
  return { Authorization: token ? `Bearer ${token}` : '' };
}

export async function getReporters() {
  const res = await fetch(`${API_BASE}/dashboard/reporters`, { headers: authHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to load reporters');
  return data;
}

export async function getLiveReporters() {
  const res = await fetch(`${API_BASE}/dashboard/reporters/live`, { headers: authHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to load live');
  return data;
}

export async function getStreams() {
  const res = await fetch(`${API_BASE}/dashboard/streams`, { headers: authHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to load streams');
  return data;
}

export async function getUploads(params = {}) {
  const q = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/dashboard/uploads?${q}`, { headers: authHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to load uploads');
  return data;
}

export async function getUpload(id) {
  const res = await fetch(`${API_BASE}/dashboard/uploads/${id}`, { headers: authHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to load upload');
  return data;
}

export async function downloadUpload(id, fileName) {
  const res = await fetch(`${API_BASE}/dashboard/uploads/${id}/download`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Download failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName || `upload-${id}`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function getActivity(limit = 50) {
  const res = await fetch(`${API_BASE}/dashboard/activity?limit=${limit}`, { headers: authHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to load activity');
  return data;
}

export async function getUploadBlob(id) {
  const res = await fetch(`${API_BASE}/dashboard/uploads/${id}/download`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Preview failed');
  return res.blob();
}

export async function createEditor(email, password, name) {
  const res = await fetch(`${API_BASE}/dashboard/editors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ email, password, name }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to create editor');
  return data;
}
