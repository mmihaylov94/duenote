import { Router } from "express";
import { translateText } from "../services/deepl.service.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const translateRouter = Router();
translateRouter.use(requireAuth);

translateRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const result = await translateText(req.body || {});
    res.json(result);
  }),
);
