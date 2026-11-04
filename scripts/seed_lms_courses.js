import pg from 'pg';
import dotenv from 'dotenv';
import {
  SEED_USERS,
  SEED_COURSES,
  SEED_LESSONS,
  SEED_QUIZZES,
  SEED_QUESTIONS
} from '../src/db/seedData.js';

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Seed Users
    console.log(`Upserting ${SEED_USERS.length} seed users...`);
    for (const u of SEED_USERS) {
      await client.query(
        `INSERT INTO users (id, full_name, email, password_hash, role, status, email_verified, email_verified_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (email) DO UPDATE 
         SET full_name = EXCLUDED.full_name, password_hash = EXCLUDED.password_hash, role = EXCLUDED.role,
             status = EXCLUDED.status, email_verified = EXCLUDED.email_verified, email_verified_at = EXCLUDED.email_verified_at`,
        [u.id, u.full_name, u.email, u.password_hash, u.role, u.status || 'active', u.email_verified ?? true, u.email_verified_at || new Date().toISOString(), u.created_at]
      );
    }

    // 2. Courses
    console.log(`Inserting ${SEED_COURSES.length} courses...`);
    for (const c of SEED_COURSES) {
      await client.query(
        `INSERT INTO courses (id, title, description, category, thumbnail_url, instructor_name, instructor_id, status, published, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO UPDATE
         SET title = EXCLUDED.title, description = EXCLUDED.description, category = EXCLUDED.category, published = EXCLUDED.published`,
        [c.id, c.title, c.description, c.category, c.thumbnail_url, c.instructor_name, c.instructor_id, c.status || 'published', c.published, c.created_at, c.updated_at]
      );
    }

    // 3. Lessons
    console.log(`Inserting ${SEED_LESSONS.length} lessons...`);
    for (const l of SEED_LESSONS) {
      await client.query(
        `INSERT INTO lessons (id, course_id, title, content, video_url, position, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (id) DO UPDATE
         SET title = EXCLUDED.title, content = EXCLUDED.content, video_url = EXCLUDED.video_url, position = EXCLUDED.position`,
        [l.id, l.course_id, l.title, l.content, l.video_url, l.position]
      );
    }

    // 4. Quizzes
    console.log(`Inserting ${SEED_QUIZZES.length} quizzes...`);
    for (const q of SEED_QUIZZES) {
      await client.query(
        `INSERT INTO quizzes (id, course_id, title, description, teacher_id, status, duration_minutes, pass_percentage, results_published, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO UPDATE
         SET title = EXCLUDED.title, description = EXCLUDED.description`,
        [q.id, q.course_id, q.title, q.description, q.teacher_id, q.status || 'published', q.duration_minutes || 20, q.pass_percentage || 60, q.results_published ?? true, q.created_at, q.updated_at]
      );
    }

    // 5. Questions
    console.log(`Inserting ${SEED_QUESTIONS.length} questions...`);
    for (const qu of SEED_QUESTIONS) {
      await client.query(
        `INSERT INTO questions (id, quiz_id, question_text, options, correct_option_index, explanation, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE
         SET question_text = EXCLUDED.question_text, options = EXCLUDED.options, 
             correct_option_index = EXCLUDED.correct_option_index, explanation = EXCLUDED.explanation`,
        [qu.id, qu.quiz_id, qu.question_text, JSON.stringify(qu.options), qu.correct_option_index, qu.explanation, qu.position]
      );
    }

    await client.query('COMMIT');
    console.log('LMS sample data seeded successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error seeding LMS data:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(console.error);
