import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
// Optional: use pre-hashed password for security (bcrypt hash in env)
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '';

export function signAdminToken(payload) {
  return jwt.sign({ ...payload, role: 'admin' }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

export function verifyAdminToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded?.role === 'admin' ? decoded : null;
  } catch {
    return null;
  }
}

export function adminAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const decoded = verifyAdminToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  req.admin = decoded;
  next();
}

export async function adminLogin(email, password) {
  const emailNorm = (email || '').toLowerCase().trim();
  if (!ADMIN_EMAIL || !emailNorm || emailNorm !== ADMIN_EMAIL) {
    return { ok: false, error: 'Invalid email or password' };
  }
  let valid = false;
  if (ADMIN_PASSWORD_HASH) {
    valid = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
  } else if (ADMIN_PASSWORD) {
    valid = password === ADMIN_PASSWORD;
  }
  if (!valid) {
    return { ok: false, error: 'Invalid email or password' };
  }
  const token = signAdminToken({ email: emailNorm, id: 'admin' });
  return {
    ok: true,
    token,
    admin: { email: emailNorm, name: 'Administrator' },
    role: 'admin',
  };
}

export function isAdminConfigured() {
  return Boolean(ADMIN_EMAIL && (ADMIN_PASSWORD || ADMIN_PASSWORD_HASH));
}
