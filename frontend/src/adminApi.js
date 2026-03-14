export const API_BASE = import.meta.env.VITE_API_URL || '/api';
const ADMIN_TOKEN_KEY = 'admin_token';

export function getAdminToken() {
  return localStorage.getItem(ADMIN_TOKEN_KEY);
}

export function setAdminToken(token) {
  if (token) localStorage.setItem(ADMIN_TOKEN_KEY, token);
  else localStorage.removeItem(ADMIN_TOKEN_KEY);
}

export function adminAuthHeaders() {
  const token = getAdminToken();
  return { Authorization: token ? `Bearer ${token}` : '' };
}

export async function adminLogin(email, password) {
  const res = await fetch(`${API_BASE}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Login failed');
  return data;
}

export async function getAdminReporters() {
  const res = await fetch(`${API_BASE}/admin/reporters`, { headers: adminAuthHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to load reporters');
  return data;
}

export async function createReporter(email, password, name) {
  const res = await fetch(`${API_BASE}/admin/reporters`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...adminAuthHeaders() },
    body: JSON.stringify({ email, password, name }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to create reporter');
  return data;
}
