import { pool, pgConfigFromEnv } from "./pool.js";

async function ensureUsersTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      email_verified_at TIMESTAMPTZ,
      google_sub TEXT UNIQUE,
      display_name TEXT,
      avatar_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function ensureEmailOtpTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_otp_challenges (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      attempts INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_email_otp_email_lower ON email_otp_challenges (lower(email));
  `);
}

async function getOrCreateMigrationUserId() {
  const email = "migration@system.duenote";
  const { rows } = await pool.query(`SELECT id FROM users WHERE email = $1`, [email]);
  if (rows.length > 0) return rows[0].id;
  const ins = await pool.query(
    `INSERT INTO users (email, email_verified_at, display_name) VALUES ($1, NOW(), $2) RETURNING id`,
    [email, "Legacy migration"],
  );
  return ins.rows[0].id;
}

async function ensureWorkbooksDropLegacyTextColumns() {
  await pool.query(`
    ALTER TABLE workbooks DROP COLUMN IF EXISTS source_text;
    ALTER TABLE workbooks DROP COLUMN IF EXISTS translation_text;
  `);
}

async function ensureCoursesUserIdColumn() {
  const { rows: colRows } = await pool.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'courses' AND column_name = 'user_id'
  `);
  if (colRows.length > 0) return;

  await pool.query(`
    ALTER TABLE courses ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
  `);
  const migrationUserId = await getOrCreateMigrationUserId();
  await pool.query(`UPDATE courses SET user_id = $1 WHERE user_id IS NULL`, [migrationUserId]);
  await pool.query(`ALTER TABLE courses ALTER COLUMN user_id SET NOT NULL`);
}

async function ensureCoursesSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS courses (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Untitled',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await ensureCoursesUserIdColumn();

  const { rows: colRows } = await pool.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'workbooks' AND column_name = 'course_id'
  `);
  if (colRows.length === 0) {
    await pool.query(`
      ALTER TABLE workbooks ADD COLUMN course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE;
    `);
    const migrationUserId = await getOrCreateMigrationUserId();
    const { rows: ins } = await pool.query(
      `
      INSERT INTO courses (title, user_id, created_at, updated_at)
      VALUES ('General', $1, NOW(), NOW())
      RETURNING id
    `,
      [migrationUserId],
    );
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

async function ensureCourseVocabularyEntriesTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS course_vocabulary_entries (
      id SERIAL PRIMARY KEY,
      course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      word TEXT NOT NULL,
      meaning TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_course_vocab_word_ci
    ON course_vocabulary_entries (course_id, lower(btrim(word)));
  `);
}

async function ensureCourseSectionPinsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS course_section_pins (
      id SERIAL PRIMARY KEY,
      course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      workbook_id INTEGER NOT NULL REFERENCES workbooks(id) ON DELETE CASCADE,
      section_id TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(course_id, workbook_id, section_id)
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_course_section_pins_course_sort
    ON course_section_pins (course_id, sort_order);
  `);
}

async function ensureCourseMaterialsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS course_materials (
      id SERIAL PRIMARY KEY,
      course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      storage TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_course_materials_course_created
    ON course_materials (course_id, created_at DESC, id DESC);
  `);
}

export async function initDatabase() {
  await ensureUsersTable();
  await ensureEmailOtpTable();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS workbooks (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Untitled',
      source_lang TEXT NOT NULL DEFAULT 'EN',
      target_lang TEXT NOT NULL DEFAULT 'DE',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      content_json TEXT
    );
  `);
  await ensureWorkbooksDropLegacyTextColumns();
  await ensureCoursesSchema();
  await ensureCourseVocabularyEntriesTable();
  await ensureCourseSectionPinsTable();
  await ensureCourseMaterialsTable();

  const cfg = pgConfigFromEnv();
  const label = cfg.connectionString
    ? "DATABASE_URL"
    : `${cfg.host}:${cfg.port}/${cfg.database}`;
  console.log(`[DueNote] PostgreSQL ready (${label})`);
}
