import { randomUUID } from "node:crypto";
import { pool } from "./pool.js";
import { getCourse } from "./courses.repository.js";

function nowIso() {
  return new Date().toISOString();
}

function defaultHeaderSection() {
  return {
    id: randomUUID(),
    type: "header",
    text: "",
  };
}

function titleFromSections(sections) {
  if (!Array.isArray(sections) || sections.length === 0) return "Untitled";
  const line = (sections[0].text ?? "").trim().split(/\n/)[0];
  return (line || "Untitled").slice(0, 500);
}

function parseSectionsFromRow(row) {
  if (!row.content_json) return [defaultHeaderSection()];
  try {
    const parsed = JSON.parse(row.content_json);
    if (parsed && Array.isArray(parsed.sections) && parsed.sections.length > 0) {
      return parsed.sections;
    }
  } catch {
    /* ignore */
  }
  return [defaultHeaderSection()];
}

function rowToWorkbook(row) {
  if (!row) return null;
  return {
    id: row.id,
    courseId: row.course_id,
    title: row.title,
    sections: parseSectionsFromRow(row),
    sourceLang: row.source_lang,
    targetLang: row.target_lang,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listWorkbooks() {
  const { rows } = await pool.query(
    `SELECT id, course_id, title, updated_at FROM workbooks ORDER BY updated_at DESC`,
  );
  return rows.map((r) => ({
    id: r.id,
    courseId: r.course_id,
    title: r.title,
    updatedAt: r.updated_at,
  }));
}

export async function getWorkbook(id) {
  const { rows } = await pool.query(
    `SELECT id, course_id, title, source_text, translation_text, source_lang, target_lang, content_json, created_at, updated_at
     FROM workbooks WHERE id = $1`,
    [id],
  );
  return rowToWorkbook(rows[0]);
}

export async function createWorkbook({ courseId, title = "Untitled" } = {}) {
  if (courseId == null || !Number.isFinite(Number(courseId))) {
    throw new Error("courseId is required");
  }
  const cid = Number(courseId);
  const course = await getCourse(cid);
  if (!course) {
    throw new Error("Course not found");
  }
  const t = nowIso();
  const sl = course.sourceLang ?? "EN";
  const tl = course.targetLang ?? "DE";
  const contentJson = JSON.stringify({ sections: [defaultHeaderSection()] });
  const { rows } = await pool.query(
    `INSERT INTO workbooks (course_id, title, source_text, translation_text, source_lang, target_lang, content_json, created_at, updated_at)
     VALUES ($1, $2, '', '', $3, $4, $5, $6::timestamptz, $7::timestamptz)
     RETURNING id`,
    [cid, title.slice(0, 500), sl, tl, contentJson, t, t],
  );
  await pool.query(`UPDATE courses SET updated_at = $1::timestamptz WHERE id = $2`, [t, cid]);
  return getWorkbook(rows[0].id);
}

export async function updateWorkbook(id, fields) {
  const sets = [];
  const values = [];
  let n = 1;

  if (
    Object.prototype.hasOwnProperty.call(fields, "title") &&
    !Object.prototype.hasOwnProperty.call(fields, "sections")
  ) {
    sets.push(`title = $${n++}`);
    values.push(fields.title);
  }

  if (Object.prototype.hasOwnProperty.call(fields, "sections")) {
    const derivedTitle = titleFromSections(fields.sections);
    sets.push(`content_json = $${n++}`);
    values.push(JSON.stringify({ sections: fields.sections }));
    sets.push(`title = $${n++}`);
    values.push(derivedTitle);

    const firstTr = fields.sections.find((s) => s.type === "translation");
    const sl = firstTr?.sourceLang ?? fields.sourceLang ?? "EN";
    const tl = firstTr?.targetLang ?? fields.targetLang ?? "DE";
    sets.push(`source_text = $${n++}`, `translation_text = $${n++}`, `source_lang = $${n++}`, `target_lang = $${n++}`);
    values.push(firstTr?.sourceText ?? "", firstTr?.translationText ?? "", sl, tl);
  }

  if (sets.length === 0) {
    return getWorkbook(id);
  }

  sets.push(`updated_at = $${n++}::timestamptz`);
  values.push(nowIso());
  values.push(id);

  const { rowCount } = await pool.query(
    `UPDATE workbooks SET ${sets.join(", ")} WHERE id = $${n}`,
    values,
  );
  if (rowCount === 0) return null;
  const w = await getWorkbook(id);
  if (w?.courseId) {
    await pool.query(`UPDATE courses SET updated_at = $1::timestamptz WHERE id = $2`, [
      nowIso(),
      w.courseId,
    ]);
  }
  return w;
}

export async function deleteWorkbook(id) {
  const w = await getWorkbook(id);
  const { rowCount } = await pool.query(`DELETE FROM workbooks WHERE id = $1`, [id]);
  if (rowCount > 0 && w?.courseId) {
    await pool.query(`UPDATE courses SET updated_at = $1::timestamptz WHERE id = $2`, [
      nowIso(),
      w.courseId,
    ]);
  }
  return rowCount > 0;
}

export async function duplicateWorkbook(id) {
  const w = await getWorkbook(id);
  if (!w) return null;
  const newTitle = `Copy of ${w.title}`.slice(0, 500);
  const t = nowIso();
  const cloned = w.sections.map((s) => ({ ...s, id: randomUUID() }));
  const contentJson = JSON.stringify({ sections: cloned });
  const firstTr = cloned.find((s) => s.type === "translation");
  const sl = firstTr?.sourceLang ?? w.sourceLang ?? "EN";
  const tl = firstTr?.targetLang ?? w.targetLang ?? "DE";
  const courseId = w.courseId;
  if (courseId == null) {
    throw new Error("Workbook missing courseId");
  }
  const { rows } = await pool.query(
    `INSERT INTO workbooks (course_id, title, source_text, translation_text, source_lang, target_lang, content_json, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz)
     RETURNING id`,
    [
      courseId,
      newTitle,
      firstTr?.sourceText ?? "",
      firstTr?.translationText ?? "",
      sl,
      tl,
      contentJson,
      t,
      t,
    ],
  );
  await pool.query(`UPDATE courses SET updated_at = $1::timestamptz WHERE id = $2`, [t, courseId]);
  return getWorkbook(rows[0].id);
}
