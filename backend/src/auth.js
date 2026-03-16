import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { query } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';

export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

export function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  req.user = decoded;
  next();
}

export async function login(email, password) {
  const { rows } = await query(
    'SELECT id, email, password, name FROM reporters WHERE email = $1',
    [email.toLowerCase().trim()]
  );
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return { ok: false, error: 'Invalid email or password' };
  }
  const token = signToken({ id: user.id, email: user.email });
  return {
    ok: true,
    token,
    reporter: { id: user.id, email: user.email, name: user.name },
  };
}

export async function getReporterById(id) {
  const { rows } = await query(
    'SELECT id, email, name, created_at FROM reporters WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

export async function signup(email, password, name) {
  const emailNorm = email.toLowerCase().trim();
  const nameTrim = (name || '').trim();
  if (!emailNorm || !password || !nameTrim) {
    return { ok: false, error: 'Email, password and name are required' };
  }
  if (password.length < 6) {
    return { ok: false, error: 'Password must be at least 6 characters' };
  }
  const hash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await query(
      `INSERT INTO reporters (email, password, name) VALUES ($1, $2, $3)
       RETURNING id, email, name`,
      [emailNorm, hash, nameTrim]
    );
    const user = rows[0];
    const token = signToken({ id: user.id, email: user.email });
    return {
      ok: true,
      token,
      reporter: { id: user.id, email: user.email, name: user.name },
    };
  } catch (e) {
    if (e.code === '23505') return { ok: false, error: 'Email already registered' };
    throw e;
  }
}

/** Create a reporter (admin only). Returns reporter without token. */
export async function createReporter(email, password, name) {
  const result = await signup(email, password, name);
  if (!result.ok) return result;
  return { ok: true, reporter: result.reporter };
}

/** Delete reporter (admin only). Cascades to sessions/uploads via FK constraints. */
export async function deleteReporter(id) {
  await query('DELETE FROM reporters WHERE id = $1', [id]);
  return { ok: true };
}
