import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { streamLocalAvatarToResponse } from "../services/avatar.service.js";

export const mediaRouter = Router();

/** Serves locally stored avatars (S3-backed avatars use the public S3 URL in `avatar_url`). */
mediaRouter.get(
  "/avatars/:userId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const uid = Number(req.params.userId);
    const sid = Number(req.session.userId);
    if (!Number.isFinite(uid) || uid !== sid) {
      return res.status(403).end();
    }
    const ok = await streamLocalAvatarToResponse(uid, res);
    if (!ok) res.status(404).end();
  }),
);
