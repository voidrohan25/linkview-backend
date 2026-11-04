import pg from 'pg';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function seedCoreUsers() {
  const users = [
    {
      id: 'user-admin-001',
      full_name: 'Dr. Priya Patel',
      email: 'admin@linktest.io',
      password: 'Admin123!',
      role: 'ADMIN',
      status: 'active'
    },
    {
      id: 'user-teacher-001',
      full_name: 'Prof. Rajesh Kulkarni',
      email: 'teacher@linktest.io',
      password: 'Teacher123!',
      role: 'TEACHER',
      status: 'active'
    },
    {
      id: 'user-student-001',
      full_name: 'Aarav Sharma',
      email: 'student@linktest.io',
      password: 'Student123!',
      role: 'STUDENT',
      status: 'active'
    }
  ];

  for (const u of users) {
    const hash = await bcrypt.hash(u.password, 10);
    await pool.query(
      `INSERT INTO users (id, full_name, email, password_hash, role, status, email_verified, email_verified_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, true, NOW(), NOW())
       ON CONFLICT (email) DO UPDATE
       SET full_name = EXCLUDED.full_name,
           password_hash = EXCLUDED.password_hash,
           role = EXCLUDED.role,
           status = EXCLUDED.status,
           email_verified = true`,
      [u.id, u.full_name, u.email, hash, u.role, u.status]
    );
    console.log(`Core user upserted: ${u.email} (${u.role})`);
  }

  await pool.end();
}

seedCoreUsers().catch(console.error);
