import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  const admins = await pool.query("SELECT id, email, full_name, role, status, auth_provider, email_verified, created_at FROM users WHERE role = 'ADMIN'");
  console.log('ADMIN USERS COUNT:', admins.rows.length);
  console.log(JSON.stringify(admins.rows, null, 2));
  await pool.end();
}
run().catch(console.error);
