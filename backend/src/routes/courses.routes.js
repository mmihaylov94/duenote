import { Router } from "express";
import * as courseRepo from "../db/courses.repository.js";
import { normalizeLangOrDefault, normalizeLangRequired } from "../utils/languages.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

export const coursesRouter = Router();

coursesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(await courseRepo.listCoursesWithWorkbooks());
  }),
);

coursesRouter.get(
  "/:id/vocabulary",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    const data = await courseRepo.getCourseVocabulary(id);
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json(data);
  }),
);

coursesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const title = typeof body.title === "string" ? body.title : "Untitled";
    const sl = normalizeLangOrDefault(body.sourceLang, "EN");
    const tl = normalizeLangOrDefault(body.targetLang, "DE");
    if (sl === null || tl === null) {
      return res.status(400).json({ error: "Invalid sourceLang or targetLang" });
    }
    const c = await courseRepo.createCourse({ title, sourceLang: sl, targetLang: tl });
    res.status(201).json(c);
  }),
);

coursesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    const body = req.body || {};
    const fields = {};
    if (typeof body.title === "string") fields.title = body.title;
    if (Object.prototype.hasOwnProperty.call(body, "sourceLang")) {
      const sl = normalizeLangRequired(body.sourceLang);
      if (sl === null) {
        return res.status(400).json({ error: "Invalid sourceLang" });
      }
      fields.sourceLang = sl;
    }
    if (Object.prototype.hasOwnProperty.call(body, "targetLang")) {
      const tl = normalizeLangRequired(body.targetLang);
      if (tl === null) {
        return res.status(400).json({ error: "Invalid targetLang" });
      }
      fields.targetLang = tl;
    }
    const c = await courseRepo.updateCourse(id, fields);
    if (!c) return res.status(404).json({ error: "Not found" });
    res.json(c);
  }),
);

coursesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    if (!(await courseRepo.deleteCourse(id))) return res.status(404).json({ error: "Not found" });
    res.status(204).end();
  }),
);
