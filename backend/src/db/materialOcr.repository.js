import { pool } from "./pool.js";

function rowToOcrPage(row) {
  if (!row) return null;
  return {
    id: row.id,
    materialId: row.material_id,
    pageNumber: row.page_number,
    unit: row.unit,
    width: row.width,
    height: row.height,
    ocr: row.ocr_json,
    createdAt: row.created_at,
  };
}

export async function listOcrPages(materialId, pageNumbers) {
  const mid = Number(materialId);
  const pages = Array.isArray(pageNumbers)
    ? pageNumbers.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
    : [];
  if (!Number.isFinite(mid) || mid <= 0) return [];
  if (pages.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT id, material_id, page_number, unit, width, height, ocr_json, created_at
     FROM course_material_ocr_pages
     WHERE material_id = $1 AND page_number = ANY($2::int[])
     ORDER BY page_number ASC`,
    [mid, pages],
  );
  return rows.map(rowToOcrPage);
}

export async function getOcrPage(materialId, pageNumber) {
  const mid = Number(materialId);
  const p = Number(pageNumber);
  if (!Number.isFinite(mid) || mid <= 0 || !Number.isFinite(p) || p <= 0) return null;
  const { rows } = await pool.query(
    `SELECT id, material_id, page_number, unit, width, height, ocr_json, created_at
     FROM course_material_ocr_pages
     WHERE material_id = $1 AND page_number = $2`,
    [mid, p],
  );
  return rowToOcrPage(rows[0]);
}

export async function insertOcrPage({ materialId, pageNumber, unit, width, height, ocr }) {
  const mid = Number(materialId);
  const p = Number(pageNumber);
  if (!Number.isFinite(mid) || mid <= 0 || !Number.isFinite(p) || p <= 0) {
    const err = new Error("Invalid materialId/pageNumber");
    err.statusCode = 400;
    throw err;
  }
  const { rows } = await pool.query(
    `INSERT INTO course_material_ocr_pages (material_id, page_number, unit, width, height, ocr_json)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (material_id, page_number) DO NOTHING
     RETURNING id, material_id, page_number, unit, width, height, ocr_json, created_at`,
    [mid, p, unit || null, Number(width) || null, Number(height) || null, JSON.stringify(ocr || {})],
  );
  return rowToOcrPage(rows[0]);
}

