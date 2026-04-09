import { randomUUID } from "node:crypto";
import { pool } from "./pool.js";
import { getCourse } from "./courses.repository.js";
import * as coursePinsRepo from "./coursePins.repository.js";

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

export async function listWorkbooks(userId) {
  const uid = Number(userId);
  if (!Number.isFinite(uid)) return [];
  const { rows } = await pool.query(
    `SELECT w.id, w.course_id, w.title, w.updated_at
     FROM workbooks w
     INNER JOIN courses c ON c.id = w.course_id AND c.user_id = $1
     ORDER BY w.updated_at DESC`,
    [uid],
  );
  return rows.map((r) => ({
    id: r.id,
    courseId: r.course_id,
    title: r.title,
    updatedAt: r.updated_at,
  }));
}

export async function getWorkbook(id, userId) {
  const wid = Number(id);
  const uid = Number(userId);
  if (!Number.isFinite(wid) || !Number.isFinite(uid)) return null;
  const { rows } = await pool.query(
    `SELECT w.id, w.course_id, w.title, w.source_lang, w.target_lang, w.content_json, w.created_at, w.updated_at
     FROM workbooks w
     INNER JOIN courses c ON c.id = w.course_id AND c.user_id = $2
     WHERE w.id = $1`,
    [wid, uid],
  );
  return rowToWorkbook(rows[0]);
}

export async function createWorkbook(userId, { courseId, title = "Untitled" } = {}) {
  if (courseId == null || !Number.isFinite(Number(courseId))) {
    throw new Error("courseId is required");
  }
  const cid = Number(courseId);
  const uid = Number(userId);
  if (!Number.isFinite(uid)) throw new Error("Invalid user");
  const course = await getCourse(cid, uid);
  if (!course) {
    throw new Error("Course not found");
  }
  const t = nowIso();
  const sl = course.sourceLang ?? "EN";
  const tl = course.targetLang ?? "DE";
  const contentJson = JSON.stringify({ sections: [defaultHeaderSection()] });
  const { rows } = await pool.query(
    `INSERT INTO workbooks (course_id, title, source_lang, target_lang, content_json, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz)
     RETURNING id`,
    [cid, title.slice(0, 500), sl, tl, contentJson, t, t],
  );
  await pool.query(`UPDATE courses SET updated_at = $1::timestamptz WHERE id = $2`, [t, cid]);
  return getWorkbook(rows[0].id, uid);
}

export async function updateWorkbook(id, userId, fields) {
  const existing = await getWorkbook(id, userId);
  if (!existing) return null;

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
    sets.push(`source_lang = $${n++}`, `target_lang = $${n++}`);
    values.push(sl, tl);
  }

  if (sets.length === 0) {
    return existing;
  }

  sets.push(`updated_at = $${n++}::timestamptz`);
  values.push(nowIso());
  values.push(id);
  values.push(userId);
  const pWb = values.length - 1;
  const pUser = values.length;

  const { rowCount } = await pool.query(
    `UPDATE workbooks w SET ${sets.join(", ")}
     FROM courses c
     WHERE w.id = $${pWb} AND w.course_id = c.id AND c.user_id = $${pUser}`,
    values,
  );
  if (rowCount === 0) return null;

  if (Object.prototype.hasOwnProperty.call(fields, "sections")) {
    const validIds = fields.sections.map((s) => s?.id).filter(Boolean);
    await coursePinsRepo.deletePinsForMissingSections(existing.courseId, id, validIds);
  }

  const w = await getWorkbook(id, userId);
  if (w?.courseId) {
    await pool.query(`UPDATE courses SET updated_at = $1::timestamptz WHERE id = $2`, [nowIso(), w.courseId]);
  }
  return w;
}

/**
 * Remove every document section that references the given material in all workbooks of the course.
 * Updates pins for removed section ids. No-op if user does not own the course.
 */
export async function removeDocumentSectionsUsingMaterial(courseId, materialId, userId) {
  const cid = Number(courseId);
  const mid = Number(materialId);
  const uid = Number(userId);
  if (!Number.isFinite(cid) || !Number.isFinite(mid) || !Number.isFinite(uid)) return { updated: 0 };

  const { rows } = await pool.query(
    `SELECT w.id, w.content_json
     FROM workbooks w
     INNER JOIN courses c ON c.id = w.course_id AND c.user_id = $1
     WHERE w.course_id = $2`,
    [uid, cid],
  );

  let updated = 0;
  for (const row of rows) {
    const sections = parseSectionsFromRow(row);
    const next = sections.filter((s) => {
      if (s?.type !== "document") return true;
      const mat = s.materialId != null ? Number(s.materialId) : NaN;
      return !Number.isFinite(mat) || mat !== mid;
    });
    if (next.length === sections.length) continue;
    const finalSections = next.length > 0 ? next : [defaultHeaderSection()];
    const w = await updateWorkbook(row.id, uid, { sections: finalSections });
    if (w) updated += 1;
  }
  return { updated };
}

export async function deleteWorkbook(id, userId) {
  const w = await getWorkbook(id, userId);
  if (!w) return false;
  const { rowCount } = await pool.query(
    `DELETE FROM workbooks w USING courses c
     WHERE w.id = $1 AND w.course_id = c.id AND c.user_id = $2`,
    [id, userId],
  );
  if (rowCount > 0 && w?.courseId) {
    await pool.query(`UPDATE courses SET updated_at = $1::timestamptz WHERE id = $2`, [nowIso(), w.courseId]);
  }
  return rowCount > 0;
}

export async function duplicateWorkbook(id, userId) {
  const w = await getWorkbook(id, userId);
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
  const uid = Number(userId);
  const course = await getCourse(courseId, uid);
  if (!course) return null;

  const { rows } = await pool.query(
    `INSERT INTO workbooks (course_id, title, source_lang, target_lang, content_json, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz)
     RETURNING id`,
    [courseId, newTitle, sl, tl, contentJson, t, t],
  );
  await pool.query(`UPDATE courses SET updated_at = $1::timestamptz WHERE id = $2`, [t, courseId]);
  return getWorkbook(rows[0].id, uid);
}
