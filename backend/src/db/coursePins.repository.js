import { pool } from "./pool.js";
import { getCourse } from "./courses.repository.js";

function rowToPin(row) {
  if (!row) return null;
  return {
    id: row.id,
    workbookId: row.workbook_id,
    sectionId: row.section_id,
    label: row.label,
    sortOrder: row.sort_order,
  };
}

export async function listPins(courseId, userId) {
  const cid = Number(courseId);
  const uid = Number(userId);
  if (!Number.isFinite(cid) || !Number.isFinite(uid)) return null;
  const course = await getCourse(cid, uid);
  if (!course) return null;
  const { rows } = await pool.query(
    `SELECT id, workbook_id, section_id, label, sort_order
     FROM course_section_pins
     WHERE course_id = $1
     ORDER BY sort_order ASC, id ASC`,
    [cid],
  );
  return { pins: rows.map(rowToPin) };
}

export async function createPin(courseId, userId, { workbookId, sectionId, label }) {
  const cid = Number(courseId);
  const uid = Number(userId);
  const wid = Number(workbookId);
  if (!Number.isFinite(cid) || !Number.isFinite(uid) || !Number.isFinite(wid)) {
    return { error: "invalid_input" };
  }
  const course = await getCourse(cid, uid);
  if (!course) return { error: "not_found" };

  const { rows: wb } = await pool.query(
    `SELECT id FROM workbooks WHERE id = $1 AND course_id = $2`,
    [wid, cid],
  );
  if (wb.length === 0) return { error: "invalid_workbook" };

  const sid = String(sectionId ?? "").trim();
  if (!sid) return { error: "invalid_section" };

  const labelTrim = String(label ?? "").trim().slice(0, 500);
  if (!labelTrim) return { error: "empty_label" };

  const { rows: maxRow } = await pool.query(
    `SELECT COALESCE(MAX(sort_order), -1) AS m FROM course_section_pins WHERE course_id = $1`,
    [cid],
  );
  const sortOrder = Number(maxRow[0].m) + 1;

  try {
    const { rows } = await pool.query(
      `INSERT INTO course_section_pins (course_id, workbook_id, section_id, label, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, workbook_id, section_id, label, sort_order`,
      [cid, wid, sid, labelTrim, sortOrder],
    );
    return { pin: rowToPin(rows[0]) };
  } catch (e) {
    if (e.code === "23505") return { error: "duplicate" };
    throw e;
  }
}

export async function updatePinLabel(courseId, userId, pinId, { label }) {
  const cid = Number(courseId);
  const uid = Number(userId);
  const pid = Number(pinId);
  if (!Number.isFinite(cid) || !Number.isFinite(uid) || !Number.isFinite(pid)) {
    return { error: "invalid_input" };
  }
  const course = await getCourse(cid, uid);
  if (!course) return { error: "not_found" };

  if (typeof label !== "string") return { error: "invalid_label" };
  const labelTrim = label.trim().slice(0, 500);
  if (!labelTrim) return { error: "empty_label" };

  const { rows } = await pool.query(
    `UPDATE course_section_pins SET label = $1 WHERE id = $2 AND course_id = $3
     RETURNING id, workbook_id, section_id, label, sort_order`,
    [labelTrim, pid, cid],
  );
  if (rows.length === 0) return { error: "not_found" };
  return { pin: rowToPin(rows[0]) };
}

/**
 * Deletes pins for this workbook whose section_id is not in validSectionIds
 * (e.g. after sections are removed from the workbook).
 */
export async function deletePinsForMissingSections(courseId, workbookId, validSectionIds) {
  const cid = Number(courseId);
  const wid = Number(workbookId);
  if (!Number.isFinite(cid) || !Number.isFinite(wid)) return 0;
  const ids = Array.isArray(validSectionIds)
    ? [...new Set(validSectionIds.map((x) => String(x ?? "").trim()).filter(Boolean))]
    : [];

  if (ids.length === 0) {
    const { rowCount } = await pool.query(
      `DELETE FROM course_section_pins WHERE course_id = $1 AND workbook_id = $2`,
      [cid, wid],
    );
    return rowCount;
  }

  const { rowCount } = await pool.query(
    `DELETE FROM course_section_pins
     WHERE course_id = $1 AND workbook_id = $2
     AND section_id <> ALL($3::text[])`,
    [cid, wid, ids],
  );
  return rowCount;
}

export async function deletePin(courseId, userId, pinId) {
  const cid = Number(courseId);
  const uid = Number(userId);
  const pid = Number(pinId);
  if (!Number.isFinite(cid) || !Number.isFinite(uid) || !Number.isFinite(pid)) {
    return false;
  }
  const course = await getCourse(cid, uid);
  if (!course) return false;
  const { rowCount } = await pool.query(
    `DELETE FROM course_section_pins WHERE id = $1 AND course_id = $2`,
    [pid, cid],
  );
  return rowCount > 0;
}

export async function reorderPins(courseId, userId, orderedIds) {
  const cid = Number(courseId);
  const uid = Number(userId);
  if (!Number.isFinite(cid) || !Number.isFinite(uid)) return { error: "invalid_input" };
  const course = await getCourse(cid, uid);
  if (!course) return { error: "not_found" };

  if (!Array.isArray(orderedIds)) return { error: "invalid_order" };
  const ids = orderedIds.map((x) => Number(x)).filter((x) => Number.isFinite(x));
  if (ids.length === 0) return { error: "invalid_order" };

  const { rows: existing } = await pool.query(
    `SELECT id FROM course_section_pins WHERE course_id = $1`,
    [cid],
  );
  const existingSet = new Set(existing.map((r) => r.id));
  if (ids.length !== existingSet.size) return { error: "invalid_order" };
  for (const id of ids) {
    if (!existingSet.has(id)) return { error: "invalid_order" };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (let i = 0; i < ids.length; i += 1) {
      await client.query(`UPDATE course_section_pins SET sort_order = $1 WHERE id = $2 AND course_id = $3`, [
        i,
        ids[i],
        cid,
      ]);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  return listPins(cid, uid);
}
