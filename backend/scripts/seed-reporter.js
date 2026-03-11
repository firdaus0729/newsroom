import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { query } from '../src/db.js';

async function seed() {
  const email = process.env.SEED_EMAIL || 'reporter@newsroom.local';
  const password = process.env.SEED_PASSWORD || 'reporter123';
  const name = process.env.SEED_NAME || 'Test Reporter';
  const hash = await bcrypt.hash(password, 10);
  await query(
    `INSERT INTO reporters (email, password, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET password = $2, name = $3, updated_at = NOW()`,
    [email, hash, name]
  );
  console.log('Seeded reporter:', email);
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
