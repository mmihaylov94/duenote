import { pool } from "./pool.js";

function nowIso() {
  return new Date().toISOString();
}

export async function listCoursesWithWorkbooks() {
  const { rows: courses } = await pool.query(
    `SELECT id, title, source_lang, target_lang, created_at, updated_at FROM courses ORDER BY updated_at DESC`,
  );
  const out = [];
  for (const c of courses) {
    const { rows: wbs } = await pool.query(
      `SELECT id, title, updated_at FROM workbooks WHERE course_id = $1 ORDER BY updated_at DESC`,
      [c.id],
    );
    out.push({
      id: c.id,
      title: c.title,
      sourceLang: c.source_lang,
      targetLang: c.target_lang,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
      workbooks: wbs.map((w) => ({ id: w.id, title: w.title, updatedAt: w.updated_at })),
    });
  }
  return out;
}

export async function createCourse({
  title = "Untitled",
  sourceLang = "EN",
  targetLang = "DE",
} = {}) {
  const t = nowIso();
  const { rows } = await pool.query(
    `INSERT INTO courses (title, source_lang, target_lang, created_at, updated_at)
     VALUES ($1, $2, $3, $4::timestamptz, $4::timestamptz) RETURNING id`,
    [title.slice(0, 500), sourceLang, targetLang, t],
  );
  return getCourse(rows[0].id);
}

export async function getCourse(id) {
  const { rows } = await pool.query(
    `SELECT id, title, source_lang, target_lang, created_at, updated_at FROM courses WHERE id = $1`,
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    title: r.title,
    sourceLang: r.source_lang,
    targetLang: r.target_lang,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function updateCourse(id, fields) {
  const sets = [];
  const values = [];
  let n = 1;

  if (Object.prototype.hasOwnProperty.call(fields, "title")) {
    sets.push(`title = $${n++}`);
    values.push(fields.title.slice(0, 500));
  }
  if (Object.prototype.hasOwnProperty.call(fields, "sourceLang")) {
    sets.push(`source_lang = $${n++}`);
    values.push(fields.sourceLang);
  }
  if (Object.prototype.hasOwnProperty.call(fields, "targetLang")) {
    sets.push(`target_lang = $${n++}`);
    values.push(fields.targetLang);
  }

  if (sets.length === 0) {
    return getCourse(id);
  }

  sets.push(`updated_at = $${n++}::timestamptz`);
  values.push(nowIso());
  values.push(id);

  const { rowCount } = await pool.query(
    `UPDATE courses SET ${sets.join(", ")} WHERE id = $${n}`,
    values,
  );
  if (rowCount === 0) return null;
  return getCourse(id);
}

export async function deleteCourse(id) {
  const { rowCount } = await pool.query(`DELETE FROM courses WHERE id = $1`, [id]);
  return rowCount > 0;
}

export async function getCourseVocabulary(courseId) {
  const cid = Number(courseId);
  if (!Number.isFinite(cid)) return null;
  const course = await getCourse(cid);
  if (!course) return null;

  const { rows: wbs } = await pool.query(
    `SELECT id, title, content_json, created_at FROM workbooks WHERE course_id = $1 ORDER BY created_at ASC, id ASC`,
    [cid],
  );

  const entries = [];
  let order = 0;
  for (const wb of wbs) {
    let sections = [];
    try {
      const parsed = JSON.parse(wb.content_json || "{}");
      sections = Array.isArray(parsed.sections) ? parsed.sections : [];
    } catch {
      sections = [];
    }
    for (const sec of sections) {
      if (!sec || sec.type !== "vocabulary") continue;
      const rows = Array.isArray(sec.rows) ? sec.rows : [];
      for (const row of rows) {
        entries.push({
          order,
          word: typeof row.word === "string" ? row.word : "",
          meaning: typeof row.meaning === "string" ? row.meaning : "",
          workbookId: wb.id,
          workbookTitle: wb.title || "Untitled",
          sectionId: sec.id != null ? String(sec.id) : null,
          rowId: row.id != null ? String(row.id) : null,
        });
        order += 1;
      }
    }
  }

  return {
    courseId: cid,
    courseTitle: course.title,
    entries,
  };
}
