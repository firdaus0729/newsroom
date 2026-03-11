import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { query } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';

export function signEditorToken(payload) {
  return jwt.sign({ ...payload, role: 'editor' }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

export function verifyEditorToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded?.role === 'editor' ? decoded : null;
  } catch {
    return null;
  }
}

export function editorAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const decoded = verifyEditorToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  req.editor = decoded;
  next();
}

export async function editorLogin(email, password) {
  const { rows } = await query(
    'SELECT id, email, password, name FROM editors WHERE email = $1',
    [email.toLowerCase().trim()]
  );
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return { ok: false, error: 'Invalid email or password' };
  }
  const token = signEditorToken({ id: user.id, email: user.email });
  return {
    ok: true,
    token,
    editor: { id: user.id, email: user.email, name: user.name },
  };
}

export async function createEditor(email, password, name) {
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
      `INSERT INTO editors (email, password, name) VALUES ($1, $2, $3)
       RETURNING id, email, name`,
      [emailNorm, hash, nameTrim]
    );
    return { ok: true, editor: rows[0] };
  } catch (e) {
    if (e.code === '23505') return { ok: false, error: 'Email already registered' };
    throw e;
  }
}
