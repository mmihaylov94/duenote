import { pool } from "./pool.js";
import { getCourse } from "./courses.repository.js";

function nowIso() {
  return new Date().toISOString();
}

function rowToEntry(row) {
  if (!row) return null;
  return {
    id: row.id,
    word: row.word ?? "",
    meaning: row.meaning ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getEntriesByIds(courseId, userId, ids) {
  const cid = Number(courseId);
  const uid = Number(userId);
  if (!Number.isFinite(cid) || !Number.isFinite(uid)) return null;
  const course = await getCourse(cid, uid);
  if (!course) return null;
  const idList = [...new Set((ids || []).map((x) => Number(x)).filter((x) => Number.isFinite(x)))];
  if (idList.length === 0) return { entries: [] };
  const { rows } = await pool.query(
    `SELECT id, word, meaning, created_at, updated_at
     FROM course_vocabulary_entries
     WHERE course_id = $1 AND id = ANY($2::int[])
     ORDER BY id ASC`,
    [cid, idList],
  );
  return { entries: rows.map(rowToEntry) };
}

export async function searchEntries(courseId, userId, rawQ, limit = 20) {
  const cid = Number(courseId);
  const uid = Number(userId);
  if (!Number.isFinite(cid) || !Number.isFinite(uid)) return null;
  const course = await getCourse(cid, uid);
  if (!course) return null;
  const q = String(rawQ ?? "").trim();
  if (q.length === 0) return { entries: [] };
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const pattern = `%${q.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
  const { rows } = await pool.query(
    `SELECT id, word, meaning, created_at, updated_at
     FROM course_vocabulary_entries
     WHERE course_id = $1
       AND (word ILIKE $2 ESCAPE '\\' OR meaning ILIKE $2 ESCAPE '\\')
     ORDER BY lower(word) ASC
     LIMIT $3`,
    [cid, pattern, lim],
  );
  return { entries: rows.map(rowToEntry) };
}

/** Exact match case-insensitive on trimmed word; returns one entry or null */
export async function findEntryByWordCi(courseId, userId, word) {
  const cid = Number(courseId);
  const uid = Number(userId);
  const w = String(word ?? "").trim();
  if (!Number.isFinite(cid) || !Number.isFinite(uid) || !w) return null;
  const course = await getCourse(cid, uid);
  if (!course) return null;
  const { rows } = await pool.query(
    `SELECT id, word, meaning, created_at, updated_at
     FROM course_vocabulary_entries
     WHERE course_id = $1 AND lower(btrim(word)) = lower(btrim($2))
     LIMIT 1`,
    [cid, w],
  );
  return rows[0] ? rowToEntry(rows[0]) : null;
}

export async function createEntry(courseId, userId, { word, meaning }) {
  const cid = Number(courseId);
  const uid = Number(userId);
  if (!Number.isFinite(cid) || !Number.isFinite(uid)) return { error: "invalid_input" };
  const course = await getCourse(cid, uid);
  if (!course) return { error: "not_found" };

  const w = String(word ?? "").trim();
  if (!w) return { error: "empty_word" };
  const m = String(meaning ?? "").trim();

  const existing = await findEntryByWordCi(cid, uid, w);
  if (existing) {
    return { entry: existing, created: false };
  }

  const t = nowIso();
  const { rows } = await pool.query(
    `INSERT INTO course_vocabulary_entries (course_id, word, meaning, created_at, updated_at)
     VALUES ($1, $2, $3, $4::timestamptz, $4::timestamptz)
     RETURNING id, word, meaning, created_at, updated_at`,
    [cid, w.slice(0, 2000), m.slice(0, 4000), t],
  );
  return { entry: rowToEntry(rows[0]), created: true };
}

/**
 * Updates word and/or meaning. At least one field must be provided.
 * Word must stay unique per course (case-insensitive).
 */
export async function updateEntry(courseId, userId, entryId, { word, meaning }) {
  const cid = Number(courseId);
  const uid = Number(userId);
  const eid = Number(entryId);
  if (!Number.isFinite(cid) || !Number.isFinite(uid) || !Number.isFinite(eid)) {
    return { error: "invalid_input" };
  }
  const course = await getCourse(cid, uid);
  if (!course) return { error: "not_found" };

  const hasWord = word !== undefined;
  const hasMeaning = meaning !== undefined;
  if (!hasWord && !hasMeaning) return { error: "nothing_to_update" };

  const { rows: curRows } = await pool.query(
    `SELECT id, word, meaning FROM course_vocabulary_entries WHERE id = $1 AND course_id = $2`,
    [eid, cid],
  );
  if (curRows.length === 0) return { error: "not_found" };
  const cur = curRows[0];

  let nextWord = cur.word;
  let nextMeaning = cur.meaning;
  if (hasWord) {
    const w = String(word ?? "").trim();
    if (!w) return { error: "empty_word" };
    nextWord = w.slice(0, 2000);
  }
  if (hasMeaning) {
    nextMeaning = String(meaning ?? "").trim().slice(0, 4000);
  }

  if (hasWord) {
    const { rows: clash } = await pool.query(
      `SELECT id FROM course_vocabulary_entries
       WHERE course_id = $1 AND id <> $2 AND lower(btrim(word)) = lower(btrim($3))
       LIMIT 1`,
      [cid, eid, nextWord],
    );
    if (clash.length > 0) return { error: "duplicate_word" };
  }

  const t = nowIso();
  const { rows } = await pool.query(
    `UPDATE course_vocabulary_entries
     SET word = $1, meaning = $2, updated_at = $3::timestamptz
     WHERE id = $4 AND course_id = $5
     RETURNING id, word, meaning, created_at, updated_at`,
    [nextWord, nextMeaning, t, eid, cid],
  );
  if (rows.length === 0) return { error: "not_found" };
  return { entry: rowToEntry(rows[0]) };
}

/** How many vocabulary rows across all workbooks in the course reference this entry id */
export async function countEntryReferencesInCourse(courseId, entryId) {
  const cid = Number(courseId);
  const eid = Number(entryId);
  if (!Number.isFinite(cid) || !Number.isFinite(eid)) return -1;
  const { rows: wbs } = await pool.query(
    `SELECT content_json FROM workbooks WHERE course_id = $1`,
    [cid],
  );
  let n = 0;
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
        if (Number(rawId) === eid) n++;
      }
    }
  }
  return n;
}

/**
 * Removes a vocabulary row from the DB only when it is not referenced by any workbook section.
 */
export async function deleteEntry(courseId, userId, entryId) {
  const cid = Number(courseId);
  const uid = Number(userId);
  const eid = Number(entryId);
  if (!Number.isFinite(cid) || !Number.isFinite(uid) || !Number.isFinite(eid)) {
    return { error: "invalid_input" };
  }
  const course = await getCourse(cid, uid);
  if (!course) return { error: "not_found" };

  const n = await countEntryReferencesInCourse(cid, eid);
  if (n > 0) return { error: "still_referenced" };

  const { rowCount } = await pool.query(
    `DELETE FROM course_vocabulary_entries WHERE id = $1 AND course_id = $2`,
    [eid, cid],
  );
  if (rowCount === 0) return { error: "not_found" };
  return { ok: true };
}
