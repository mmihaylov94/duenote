import { pool, pgConfigFromEnv } from "./pool.js";

async function ensureCoursesSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS courses (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Untitled',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const { rows: colRows } = await pool.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'workbooks' AND column_name = 'course_id'
  `);
  if (colRows.length === 0) {
    await pool.query(`
      ALTER TABLE workbooks ADD COLUMN course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE;
    `);
    const { rows: ins } = await pool.query(`
      INSERT INTO courses (title, created_at, updated_at)
      VALUES ('General', NOW(), NOW())
      RETURNING id
    `);
    const defaultCourseId = ins[0].id;
    await pool.query(`UPDATE workbooks SET course_id = $1 WHERE course_id IS NULL`, [defaultCourseId]);
    await pool.query(`ALTER TABLE workbooks ALTER COLUMN course_id SET NOT NULL`);
  }

  const { rows: langCols } = await pool.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'courses' AND column_name = 'source_lang'
  `);
  if (langCols.length === 0) {
    await pool.query(`
      ALTER TABLE courses ADD COLUMN source_lang TEXT NOT NULL DEFAULT 'EN';
      ALTER TABLE courses ADD COLUMN target_lang TEXT NOT NULL DEFAULT 'DE';
    `);
  }
}

export async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workbooks (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Untitled',
      source_text TEXT NOT NULL DEFAULT '',
      translation_text TEXT NOT NULL DEFAULT '',
      source_lang TEXT NOT NULL DEFAULT 'EN',
      target_lang TEXT NOT NULL DEFAULT 'DE',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      content_json TEXT
    );
  `);
  await ensureCoursesSchema();

  const cfg = pgConfigFromEnv();
  const label = cfg.connectionString
    ? "DATABASE_URL"
    : `${cfg.host}:${cfg.port}/${cfg.database}`;
  console.log(`[DueNote] PostgreSQL ready (${label})`);
}
