import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { query } from '../src/db.js';

async function seed() {
  const email = process.env.SEED_EDITOR_EMAIL || 'editor@newsroom.local';
  const password = process.env.SEED_EDITOR_PASSWORD || 'Editor0729!';
  const name = process.env.SEED_EDITOR_NAME || 'Newsroom Editor';
  const hash = await bcrypt.hash(password, 10);
  await query(
    `INSERT INTO editors (email, password, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET password = $2, name = $3`,
    [email, hash, name]
  );
  console.log('Seeded editor:', email);
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
