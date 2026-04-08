import { Router } from "express";
import multer from "multer";
import * as courseRepo from "../db/courses.repository.js";
import * as coursePinsRepo from "../db/coursePins.repository.js";
import * as vocabEntriesRepo from "../db/vocabularyEntries.repository.js";
import * as materialsRepo from "../db/materials.repository.js";
import { normalizeLangOrDefault, normalizeLangRequired } from "../utils/languages.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { config } from "../config.js";
import { storeMaterial, deleteStoredMaterial, streamStoredMaterialToResponse } from "../services/materials.service.js";

export const coursesRouter = Router();
coursesRouter.use(requireAuth);

function userId(req) {
  return Number(req.session.userId);
}

const uploadMaterial = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.materialsMaxBytes },
});

function extLower(name) {
  const s = String(name || "");
  const idx = s.lastIndexOf(".");
  if (idx < 0) return "";
  return s.slice(idx).toLowerCase();
}

const ALLOWED_EXTS = new Set([".pdf", ".doc", ".docx", ".txt"]);

coursesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(await courseRepo.listCoursesWithWorkbooks(userId(req)));
  }),
);

coursesRouter.get(
  "/:id/vocabulary-entries",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    const idsRaw = req.query.ids;
    if (typeof idsRaw === "string" && idsRaw.trim()) {
      const ids = idsRaw
        .split(",")
        .map((x) => Number(x.trim()))
        .filter((x) => Number.isFinite(x));
      const data = await vocabEntriesRepo.getEntriesByIds(id, userId(req), ids);
      if (!data) return res.status(404).json({ error: "Not found" });
      return res.json(data);
    }
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const limit = req.query.limit != null ? Number(req.query.limit) : 20;
    const data = await vocabEntriesRepo.searchEntries(id, userId(req), q, limit);
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json(data);
  }),
);

coursesRouter.post(
  "/:id/vocabulary-entries",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    const body = req.body || {};
    const result = await vocabEntriesRepo.createEntry(id, userId(req), {
      word: body.word,
      meaning: body.meaning,
    });
    if (result.error === "not_found") return res.status(404).json({ error: "Not found" });
    if (result.error === "empty_word" || result.error === "invalid_input") {
      return res.status(400).json({ error: "Invalid word" });
    }
    res.status(result.created ? 201 : 200).json(result.entry);
  }),
);

coursesRouter.patch(
  "/:id/vocabulary-entries/:entryId",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const entryId = Number(req.params.entryId);
    if (!Number.isFinite(id) || !Number.isFinite(entryId)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    const body = req.body || {};
    const result = await vocabEntriesRepo.updateEntry(id, userId(req), entryId, {
      word: body.word,
      meaning: body.meaning,
    });
    if (result.error === "not_found") return res.status(404).json({ error: "Not found" });
    if (result.error === "invalid_input") return res.status(400).json({ error: "Invalid id" });
    if (result.error === "nothing_to_update") return res.status(400).json({ error: "Nothing to update" });
    if (result.error === "empty_word") return res.status(400).json({ error: "Word cannot be empty" });
    if (result.error === "duplicate_word") {
      return res.status(409).json({ error: "Another entry already uses this word" });
    }
    res.json(result.entry);
  }),
);

coursesRouter.delete(
  "/:id/vocabulary-entries/:entryId",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const entryId = Number(req.params.entryId);
    if (!Number.isFinite(id) || !Number.isFinite(entryId)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    const result = await vocabEntriesRepo.deleteEntry(id, userId(req), entryId);
    if (result.error === "not_found") return res.status(404).json({ error: "Not found" });
    if (result.error === "still_referenced") {
      return res.status(409).json({ error: "Entry is still used in a workbook" });
    }
    if (result.error === "invalid_input") return res.status(400).json({ error: "Invalid id" });
    res.status(204).end();
  }),
);

coursesRouter.get(
  "/:id/vocabulary",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    const data = await courseRepo.getCourseVocabulary(id, userId(req));
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json(data);
  }),
);

coursesRouter.get(
  "/:id/materials",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

    const course = await courseRepo.getCourse(id, userId(req));
    if (!course) return res.status(404).json({ error: "Not found" });

    const data = await materialsRepo.listMaterials(id, userId(req));
    if (!data) return res.status(404).json({ error: "Not found" });

    res.json({
      courseId: course.id,
      courseTitle: course.title,
      materials: data.materials.map((m) => ({
        id: m.id,
        title: m.title,
        mimeType: m.mimeType,
        byteSize: m.byteSize,
        createdAt: m.createdAt,
      })),
    });
  }),
);

coursesRouter.post(
  "/:id/materials",
  (req, res, next) => {
    uploadMaterial.single("file")(req, res, (err) => {
      if (!err) return next();
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "File too large" });
      }
      return res.status(400).json({ error: err.message || "Upload failed" });
    });
  },
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

    const course = await courseRepo.getCourse(id, userId(req));
    if (!course) return res.status(404).json({ error: "Not found" });

    const file = req.file;
    if (!file?.buffer) return res.status(400).json({ error: "Missing file" });

    const originalName = String(file.originalname || "file").trim().slice(0, 500);
    const ext = extLower(originalName);
    if (!ALLOWED_EXTS.has(ext)) {
      return res.status(400).json({ error: "Unsupported file type" });
    }
    const mimeType = String(file.mimetype || "application/octet-stream").slice(0, 200);
    const byteSize = Number(file.size) || file.buffer.length || 0;

    // Create DB row first to get a stable id for storage keys.
    const placeholder = await materialsRepo.createMaterial(id, userId(req), {
      title: originalName || "Untitled",
      mimeType,
      byteSize,
      storage: "pending",
      storageKey: "pending",
    });
    if (!placeholder) return res.status(404).json({ error: "Not found" });

    try {
      const stored = await storeMaterial({
        courseId: id,
        materialId: placeholder.id,
        buffer: file.buffer,
        mimeType,
        originalName,
      });

      const created = await materialsRepo.updateMaterialStorage(id, userId(req), placeholder.id, {
        storage: stored.storage,
        storageKey: stored.storageKey,
      });
      if (!created) return res.status(500).json({ error: "Could not finalize upload" });

      res.status(201).json({
        id: created.id,
        title: created.title,
        mimeType: created.mimeType,
        byteSize: created.byteSize,
        createdAt: created.createdAt,
      });
    } catch (e) {
      // Best-effort cleanup of stored object if we got that far.
      try {
        const current = await materialsRepo.getMaterial(id, userId(req), placeholder.id);
        if (current?.storage && current?.storageKey && current.storage !== "pending") {
          await deleteStoredMaterial({ storage: current.storage, storageKey: current.storageKey });
        }
      } catch {
        /* ignore */
      }
      throw e;
    }
  }),
);

coursesRouter.delete(
  "/:id/materials/:materialId",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const materialId = Number(req.params.materialId);
    if (!Number.isFinite(id) || !Number.isFinite(materialId)) return res.status(400).json({ error: "Invalid id" });

    const material = await materialsRepo.getMaterial(id, userId(req), materialId);
    if (!material) return res.status(404).json({ error: "Not found" });

    await deleteStoredMaterial({ storage: material.storage, storageKey: material.storageKey });
    const result = await materialsRepo.deleteMaterial(id, userId(req), materialId);
    if (!result.ok) return res.status(404).json({ error: "Not found" });

    res.status(204).end();
  }),
);

coursesRouter.get(
  "/:id/materials/:materialId/download",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const materialId = Number(req.params.materialId);
    if (!Number.isFinite(id) || !Number.isFinite(materialId)) return res.status(400).json({ error: "Invalid id" });

    const material = await materialsRepo.getMaterial(id, userId(req), materialId);
    if (!material) return res.status(404).json({ error: "Not found" });

    const ok = await streamStoredMaterialToResponse(
      {
        storage: material.storage,
        storageKey: material.storageKey,
        mimeType: material.mimeType,
        filename: material.title,
      },
      res,
    );
    if (!ok) return res.status(404).end();
  }),
);

coursesRouter.get(
  "/:id/search",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const data = await courseRepo.searchCourseSections(id, userId(req), q);
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json(data);
  }),
);

coursesRouter.get(
  "/:id/pins",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    const data = await coursePinsRepo.listPins(id, userId(req));
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json(data);
  }),
);

coursesRouter.post(
  "/:id/pins",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    const body = req.body || {};
    const result = await coursePinsRepo.createPin(id, userId(req), {
      workbookId: body.workbookId,
      sectionId: body.sectionId,
      label: body.label,
    });
    if (result.error === "not_found") return res.status(404).json({ error: "Not found" });
    if (result.error === "invalid_workbook") return res.status(400).json({ error: "Workbook not in this course" });
    if (result.error === "invalid_section" || result.error === "invalid_input") {
      return res.status(400).json({ error: "Invalid section" });
    }
    if (result.error === "empty_label") return res.status(400).json({ error: "Label is required" });
    if (result.error === "duplicate") return res.status(409).json({ error: "Section already pinned" });
    res.status(201).json(result.pin);
  }),
);

coursesRouter.put(
  "/:id/pins/reorder",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    const orderedIds = (req.body || {}).orderedIds;
    const result = await coursePinsRepo.reorderPins(id, userId(req), orderedIds);
    if (result.error === "not_found") return res.status(404).json({ error: "Not found" });
    if (result.error === "invalid_order" || result.error === "invalid_input") {
      return res.status(400).json({ error: "Invalid order" });
    }
    res.json(result);
  }),
);

coursesRouter.patch(
  "/:id/pins/:pinId",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const pinId = Number(req.params.pinId);
    if (!Number.isFinite(id) || !Number.isFinite(pinId)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    const body = req.body || {};
    const result = await coursePinsRepo.updatePinLabel(id, userId(req), pinId, { label: body.label });
    if (result.error === "not_found") return res.status(404).json({ error: "Not found" });
    if (result.error === "empty_label" || result.error === "invalid_label") {
      return res.status(400).json({ error: "Invalid label" });
    }
    if (result.error === "invalid_input") return res.status(400).json({ error: "Invalid id" });
    res.json(result.pin);
  }),
);

coursesRouter.delete(
  "/:id/pins/:pinId",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const pinId = Number(req.params.pinId);
    if (!Number.isFinite(id) || !Number.isFinite(pinId)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    if (!(await coursePinsRepo.deletePin(id, userId(req), pinId))) {
      return res.status(404).json({ error: "Not found" });
    }
    res.status(204).end();
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
    const c = await courseRepo.createCourse(userId(req), { title, sourceLang: sl, targetLang: tl });
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
    const c = await courseRepo.updateCourse(id, userId(req), fields);
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
    if (!(await courseRepo.deleteCourse(id, userId(req)))) return res.status(404).json({ error: "Not found" });
    res.status(204).end();
  }),
);
