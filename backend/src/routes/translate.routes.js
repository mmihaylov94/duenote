import { Router } from "express";
import { translateText } from "../services/deepl.service.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

export const translateRouter = Router();

translateRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const result = await translateText(req.body || {});
    res.json(result);
  }),
);
