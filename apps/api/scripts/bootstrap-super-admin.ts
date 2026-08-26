import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { emailSchema, passwordSchema } from '@event-registration/contracts';
import { Pool } from '@event-registration/database';

import { hashPassword } from '../src/auth/password.service.js';

export const bootstrapSuperAdmin = async (
  pool: Pool,
  emailInput: string,
  passwordInput: string,
): Promise<string> => {
  const email = emailSchema.parse(emailInput);
  const password = passwordSchema.parse(passwordInput);
  const passwordHash = await hashPassword(password);
  const client = await pool.connect();

  try {
    const lock = await client.query<{ acquired: number }>(
      "SELECT GET_LOCK('event-registration-super-admin-bootstrap', 10) AS acquired",
    );
    if (Number(lock.rows[0]?.acquired) !== 1) {
      throw new Error('Could not acquire SUPER_ADMIN bootstrap lock');
    }
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT id FROM staff_users WHERE system_role = 'SUPER_ADMIN' LIMIT 1`,
    );
    if (existing.rowCount) {
      throw new Error(
        'SUPER_ADMIN already exists; bootstrap will not overwrite it',
      );
    }

    const id = randomUUID();
    await client.query(
      `INSERT INTO staff_users
        (id, email, email_normalized, password_hash, system_role, active,
         password_changed_at, created_at, updated_at)
       VALUES ($1, $2, $2, $3, 'SUPER_ADMIN', true, now(), now(), now())`,
      [id, email, passwordHash],
    );
    await client.query('COMMIT');
    return id;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.query(
      "SELECT RELEASE_LOCK('event-registration-super-admin-bootstrap')",
    );
    client.release();
  }
};

const run = async (): Promise<void> => {
  const databaseUrl = process.env.DATABASE_URL;
  const email = process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL;
  const password = process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD;

  if (!databaseUrl || !email || !password) {
    throw new Error(
      'DATABASE_URL, BOOTSTRAP_SUPER_ADMIN_EMAIL and BOOTSTRAP_SUPER_ADMIN_PASSWORD are required',
    );
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await bootstrapSuperAdmin(pool, email, password);
    process.stdout.write('SUPER_ADMIN bootstrap completed\n');
  } finally {
    await pool.end();
  }
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await run();
}
