import { pool } from "./pool.js";

function rowToMaterial(row) {
  if (!row) return null;
  return {
    id: row.id,
    courseId: row.course_id,
    title: row.title,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    storage: row.storage,
    storageKey: row.storage_key,
    createdAt: row.created_at,
  };
}

export async function listMaterials(courseId, userId) {
  const cid = Number(courseId);
  const uid = Number(userId);
  if (!Number.isFinite(cid) || !Number.isFinite(uid)) return null;
  const { rows } = await pool.query(
    `SELECT m.id, m.course_id, m.title, m.mime_type, m.byte_size, m.storage, m.storage_key, m.created_at
     FROM course_materials m
     INNER JOIN courses c ON c.id = m.course_id AND c.user_id = $2
     WHERE m.course_id = $1
     ORDER BY m.created_at DESC, m.id DESC`,
    [cid, uid],
  );
  return { materials: rows.map(rowToMaterial) };
}

export async function getMaterial(courseId, userId, materialId) {
  const cid = Number(courseId);
  const uid = Number(userId);
  const mid = Number(materialId);
  if (!Number.isFinite(cid) || !Number.isFinite(uid) || !Number.isFinite(mid)) return null;
  const { rows } = await pool.query(
    `SELECT m.id, m.course_id, m.title, m.mime_type, m.byte_size, m.storage, m.storage_key, m.created_at
     FROM course_materials m
     INNER JOIN courses c ON c.id = m.course_id AND c.user_id = $3
     WHERE m.course_id = $1 AND m.id = $2`,
    [cid, mid, uid],
  );
  return rowToMaterial(rows[0]);
}

export async function createMaterial(courseId, userId, { title, mimeType, byteSize, storage, storageKey }) {
  const cid = Number(courseId);
  const uid = Number(userId);
  if (!Number.isFinite(cid) || !Number.isFinite(uid)) return null;

  // Ensure course exists and is owned by user.
  const { rowCount: ok } = await pool.query(`SELECT 1 FROM courses WHERE id = $1 AND user_id = $2`, [cid, uid]);
  if (ok === 0) return null;

  const { rows } = await pool.query(
    `INSERT INTO course_materials (course_id, title, mime_type, byte_size, storage, storage_key)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, course_id, title, mime_type, byte_size, storage, storage_key, created_at`,
    [
      cid,
      String(title || "").slice(0, 500) || "Untitled",
      String(mimeType || "application/octet-stream").slice(0, 200),
      Number(byteSize) || 0,
      String(storage || "").slice(0, 20),
      String(storageKey || "").slice(0, 1000),
    ],
  );
  return rowToMaterial(rows[0]);
}

export async function updateMaterialStorage(courseId, userId, materialId, { storage, storageKey }) {
  const cid = Number(courseId);
  const uid = Number(userId);
  const mid = Number(materialId);
  if (!Number.isFinite(cid) || !Number.isFinite(uid) || !Number.isFinite(mid)) return null;

  const { rows } = await pool.query(
    `UPDATE course_materials m
     SET storage = $1, storage_key = $2
     FROM courses c
     WHERE m.id = $3 AND m.course_id = $4 AND m.course_id = c.id AND c.user_id = $5
     RETURNING m.id, m.course_id, m.title, m.mime_type, m.byte_size, m.storage, m.storage_key, m.created_at`,
    [String(storage || "").slice(0, 20), String(storageKey || "").slice(0, 1000), mid, cid, uid],
  );
  return rowToMaterial(rows[0]);
}

/** All course materials for a user (for storage cleanup before account deletion). */
export async function listAllMaterialsForUser(userId) {
  const uid = Number(userId);
  if (!Number.isFinite(uid)) return [];
  const { rows } = await pool.query(
    `SELECT m.id, m.course_id, m.storage, m.storage_key
     FROM course_materials m
     INNER JOIN courses c ON c.id = m.course_id AND c.user_id = $1`,
    [uid],
  );
  return rows.map((r) => ({
    id: r.id,
    courseId: r.course_id,
    storage: r.storage,
    storageKey: r.storage_key,
  }));
}

export async function deleteMaterial(courseId, userId, materialId) {
  const cid = Number(courseId);
  const uid = Number(userId);
  const mid = Number(materialId);
  if (!Number.isFinite(cid) || !Number.isFinite(uid) || !Number.isFinite(mid)) return { ok: false, error: "invalid" };

  const existing = await getMaterial(cid, uid, mid);
  if (!existing) return { ok: false, error: "not_found" };

  const { rowCount } = await pool.query(
    `DELETE FROM course_materials
     WHERE id = $1 AND course_id = $2`,
    [mid, cid],
  );
  if (rowCount === 0) return { ok: false, error: "not_found" };
  return { ok: true, material: existing };
}

