import { Router } from "express";
import * as workbookRepo from "../db/workbooks.repository.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const workbooksRouter = Router();
workbooksRouter.use(requireAuth);

function userId(req) {
  return Number(req.session.userId);
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
