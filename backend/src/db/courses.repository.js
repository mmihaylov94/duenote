import { pool } from "./pool.js";

function nowIso() {
  return new Date().toISOString();
}

export async function listCoursesWithWorkbooks(userId) {
  const uid = Number(userId);
  if (!Number.isFinite(uid)) return [];
  const { rows: courses } = await pool.query(
    `SELECT id, title, source_lang, target_lang, created_at, updated_at FROM courses WHERE user_id = $1 ORDER BY updated_at DESC`,
    [uid],
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
      workbooks: wbs.map((w) => ({
        id: w.id,
        title: w.title,
        updatedAt: w.updated_at,
      })),
    });
  }
  return out;
}

export async function createCourse(
  userId,
  { title = "Untitled", sourceLang = "EN", targetLang = "DE" } = {},
) {
  const uid = Number(userId);
  if (!Number.isFinite(uid)) throw new Error("Invalid user");
  const t = nowIso();
  const { rows } = await pool.query(
    `INSERT INTO courses (user_id, title, source_lang, target_lang, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5::timestamptz, $5::timestamptz) RETURNING id`,
    [uid, title.slice(0, 500), sourceLang, targetLang, t],
  );
  return getCourse(rows[0].id, uid);
}

export async function getCourse(id, userId) {
  const cid = Number(id);
  const uid = Number(userId);
  if (!Number.isFinite(cid) || !Number.isFinite(uid)) return null;
  const { rows } = await pool.query(
    `SELECT id, title, source_lang, target_lang, created_at, updated_at FROM courses WHERE id = $1 AND user_id = $2`,
    [cid, uid],
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

export async function updateCourse(id, userId, fields) {
  const existing = await getCourse(id, userId);
  if (!existing) return null;

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
    return existing;
  }

  sets.push(`updated_at = $${n++}::timestamptz`);
  values.push(nowIso());
  values.push(id);
  values.push(userId);
  const pId = values.length - 1;
  const pUser = values.length;

  const { rowCount } = await pool.query(
    `UPDATE courses SET ${sets.join(", ")} WHERE id = $${pId} AND user_id = $${pUser}`,
    values,
  );
  if (rowCount === 0) return null;
  return getCourse(id, userId);
}

export async function deleteCourse(id, userId) {
  const cid = Number(id);
  const uid = Number(userId);
  if (!Number.isFinite(cid) || !Number.isFinite(uid)) return false;
  const { rowCount } = await pool.query(
    `DELETE FROM courses WHERE id = $1 AND user_id = $2`,
    [cid, uid],
  );
  return rowCount > 0;
}

export async function getCourseVocabulary(courseId, userId) {
  const cid = Number(courseId);
  const uid = Number(userId);
  if (!Number.isFinite(cid) || !Number.isFinite(uid)) return null;
  const course = await getCourse(cid, uid);
  if (!course) return null;

  const { rows: wbs } = await pool.query(
    `SELECT id, title, content_json, created_at FROM workbooks WHERE course_id = $1 ORDER BY created_at ASC, id ASC`,
    [cid],
  );

  const usage = new Map();
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
      const ids = Array.isArray(sec.entryIds) ? sec.entryIds : [];
      for (const rawId of ids) {
        const eid = Number(rawId);
        if (!Number.isFinite(eid)) continue;
        if (!usage.has(eid)) {
          usage.set(eid, {
            workbookId: wb.id,
            workbookTitle: wb.title || "Untitled",
            sectionId: sec.id != null ? String(sec.id) : null,
          });
        }
      }
    }
  }

  const { rows: entryRows } = await pool.query(
    `SELECT id, word, meaning FROM course_vocabulary_entries WHERE course_id = $1 ORDER BY lower(word) ASC, id ASC`,
    [cid],
  );

  const entries = entryRows.map((r, order) => {
    const u = usage.get(r.id);
    return {
      order,
      entryId: r.id,
      word: r.word ?? "",
      meaning: r.meaning ?? "",
      workbookId: u?.workbookId ?? null,
      workbookTitle: u?.workbookTitle ?? "-",
      sectionId: u?.sectionId ?? null,
      rowId: null,
    };
  });

  return {
    courseId: cid,
    courseTitle: course.title,
    entries,
  };
}

/** Plain strings from a section for substring search */
function collectSearchableStrings(sec, vocabMap) {
  if (!sec || typeof sec !== "object") return [];
  const t = sec.type;
  const out = [];
  if (t === "header" || t === "grammar") {
    if (typeof sec.text === "string") out.push(sec.text);
  }
  if (t === "translation") {
    if (typeof sec.sourceText === "string") out.push(sec.sourceText);
    if (typeof sec.translationText === "string") out.push(sec.translationText);
  }
  if (t === "video") {
    if (typeof sec.url === "string") out.push(sec.url);
  }
  if (t === "vocabulary") {
    const ids = Array.isArray(sec.entryIds) ? sec.entryIds : [];
    for (const rawId of ids) {
      const eid = Number(rawId);
      if (!Number.isFinite(eid)) continue;
      const e = vocabMap.get(eid);
      if (e) {
        out.push(e.word, e.meaning);
      }
    }
  }
  return out;
}

function buildSnippet(combined, queryLower, maxLen = 120) {
  const lower = combined.toLowerCase();
  const idx = lower.indexOf(queryLower);
  if (idx < 0)
    return combined.slice(0, maxLen) + (combined.length > maxLen ? "…" : "");
  const start = Math.max(0, idx - 40);
  let s = (start > 0 ? "…" : "") + combined.slice(start, start + maxLen);
  if (start + maxLen < combined.length) s += "…";
  return s;
}

/**
 * @returns {Promise<{ results: Array<{ workbookId, workbookTitle, sectionId, sectionType, snippet }> } | null>}
 */
export async function searchCourseSections(courseId, userId, rawQuery) {
  const cid = Number(courseId);
  const uid = Number(userId);
  if (!Number.isFinite(cid) || !Number.isFinite(uid)) return null;
  const course = await getCourse(cid, uid);
  if (!course) return null;

  const q = String(rawQuery ?? "").trim();
  if (q.length < 2) {
    return { results: [] };
  }
  const queryLower = q.toLowerCase();

  const { rows: vent } = await pool.query(
    `SELECT id, word, meaning FROM course_vocabulary_entries WHERE course_id = $1`,
    [cid],
  );
  const vocabMap = new Map(
    vent.map((r) => [r.id, { word: r.word, meaning: r.meaning }]),
  );

  const { rows: wbs } = await pool.query(
    `SELECT id, title, content_json FROM workbooks WHERE course_id = $1 ORDER BY created_at ASC, id ASC`,
    [cid],
  );

  const results = [];
  for (const wb of wbs) {
    let sections = [];
    try {
      const parsed = JSON.parse(wb.content_json || "{}");
      sections = Array.isArray(parsed.sections) ? parsed.sections : [];
    } catch {
      sections = [];
    }
    for (const sec of sections) {
      if (!sec) continue;
      const strings = collectSearchableStrings(sec, vocabMap);
      const combined = strings.join("\n");
      const combinedLower = combined.toLowerCase();
      if (!combinedLower.includes(queryLower)) continue;
      const sid = sec.id != null ? String(sec.id) : "";
      const sectionType = typeof sec.type === "string" ? sec.type : "unknown";
      results.push({
        workbookId: wb.id,
        workbookTitle: wb.title || "Untitled",
        sectionId: sid,
        sectionType,
        snippet: buildSnippet(combined, queryLower),
      });
    }
  }

  return { results };
}
