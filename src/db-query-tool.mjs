import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const sql = process.argv[2] || 'SELECT * FROM question_bank LIMIT 1';
pool.query(sql)
  .then(res => {
    console.log(JSON.stringify(res.rows, null, 2));
    return pool.end();
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
