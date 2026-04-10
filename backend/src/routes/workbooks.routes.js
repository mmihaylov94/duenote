import { Router } from "express";
import * as workbookRepo from "../db/workbooks.repository.js";
import * as materialsRepo from "../db/materials.repository.js";
import * as materialOcrRepo from "../db/materialOcr.repository.js";
import { analyzeMaterialWithReadModel } from "../services/ocr.service.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const workbooksRouter = Router();
workbooksRouter.use(requireAuth);

function userId(req) {
  return Number(req.session.userId);
}

function rangePages(from, to) {
  const a = from != null ? Number(from) : null;
  const b = to != null ? Number(to) : null;
  const fromOk = Number.isFinite(a) && a > 0;
  const toOk = Number.isFinite(b) && b > 0;
  if (!fromOk && !toOk) return [];
  const start = fromOk ? a : b;
  const end = toOk ? b : a;
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  const out = [];
  for (let p = lo; p <= hi; p += 1) out.push(p);
  return out;
}

async function ensureOcrForDocumentSections(courseId, uid, sections) {
  if (!Array.isArray(sections) || sections.length === 0) return;
  const cid = Number(courseId);
  if (!Number.isFinite(cid) || cid <= 0) return;
  const user = Number(uid);
  if (!Number.isFinite(user) || user <= 0) return;

  // Cap to reduce accidental cost. This is a background-ish best-effort step.
  const MAX_TOTAL_PAGES = 60;
  const MAX_PAGES_PER_SECTION = 30;

  let totalPlanned = 0;
  for (const s of sections) {
    if (s?.type !== "document") continue;
    const materialId = s.materialId != null ? Number(s.materialId) : NaN;
    if (!Number.isFinite(materialId) || materialId <= 0) continue;
    const pages = rangePages(s.pagesFrom, s.pagesTo).slice(0, MAX_PAGES_PER_SECTION);
    if (pages.length === 0) continue;
    totalPlanned += pages.length;
    if (totalPlanned > MAX_TOTAL_PAGES) break;

    const material = await materialsRepo.getMaterial(cid, user, materialId);
    if (!material) continue;

    const existing = await materialOcrRepo.listOcrPages(material.id, pages);
    const have = new Set(existing.map((p) => p.pageNumber));
    const missing = pages.filter((p) => !have.has(p));
    if (missing.length === 0) continue;

    const analyzedPages = await analyzeMaterialWithReadModel({ material, pages: missing });
    for (const p of analyzedPages) {
      await materialOcrRepo.insertOcrPage({
        materialId: material.id,
        pageNumber: p.pageNumber,
        unit: p.unit,
        width: p.width,
        height: p.height,
        ocr: { lines: p.lines, words: p.words },
      });
    }
  }
}

workbooksRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(await workbookRepo.listWorkbooks(userId(req)));
  }),
);

workbooksRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    const w = await workbookRepo.getWorkbook(id, userId(req));
    if (!w) return res.status(404).json({ error: "Not found" });
    res.json(w);
  }),
);

workbooksRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const courseId = body.courseId != null ? Number(body.courseId) : NaN;
    const title = typeof body.title === "string" ? body.title : undefined;
    if (!Number.isFinite(courseId)) {
      return res.status(400).json({ error: "courseId is required" });
    }
    try {
      const w = await workbookRepo.createWorkbook(
        userId(req),
        title !== undefined ? { courseId, title } : { courseId },
      );
      res.status(201).json(w);
    } catch (e) {
      const msg = e?.message || "Database error";
      if (msg.includes("courseId")) {
        return res.status(400).json({ error: msg });
      }
      if (msg === "Course not found") {
        return res.status(404).json({ error: msg });
      }
      throw e;
    }
  }),
);

workbooksRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    const body = req.body || {};
    const fields = {};
    if (typeof body.title === "string") fields.title = body.title;
    if (Array.isArray(body.sections)) fields.sections = body.sections;
    if (typeof body.sourceLang === "string") fields.sourceLang = body.sourceLang;
    if (typeof body.targetLang === "string") fields.targetLang = body.targetLang;
    const w = await workbookRepo.updateWorkbook(id, userId(req), fields);
    if (!w) return res.status(404).json({ error: "Not found" });
    if (Object.prototype.hasOwnProperty.call(fields, "sections")) {
      try {
        await ensureOcrForDocumentSections(w.courseId, userId(req), fields.sections);
      } catch {
        // Best-effort: OCR is optional and should not block saving.
      }
    }
    res.json(w);
  }),
);

workbooksRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    if (!(await workbookRepo.deleteWorkbook(id, userId(req)))) return res.status(404).json({ error: "Not found" });
    res.status(204).end();
  }),
);

workbooksRouter.post(
  "/:id/duplicate",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    const w = await workbookRepo.duplicateWorkbook(id, userId(req));
    if (!w) return res.status(404).json({ error: "Not found" });
    res.status(201).json(w);
  }),
);
