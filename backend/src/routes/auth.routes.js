import { Router } from "express";
import multer from "multer";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import * as usersRepo from "../db/users.repository.js";
import * as otpRepo from "../db/otp.repository.js";
import { pool } from "../db/pool.js";
import { sendOtpEmail } from "../services/mail.service.js";
import * as avatarService from "../services/avatar.service.js";
import { config } from "../config.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const authRouter = Router();

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
  };
}

const googleConfigured = Boolean(config.googleClientId && config.googleClientSecret);

if (googleConfigured) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: config.googleClientId,
        clientSecret: config.googleClientSecret,
        callbackURL: config.googleCallbackUrl,
      },
      (accessToken, refreshToken, profile, done) => {
        done(null, profile);
      },
    ),
  );
}

const authIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

const otpRequestIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const otpRequestEmailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (email) return `otp-email:${email}`;
    return ipKeyGenerator(req.ip ?? "0.0.0.0", 56);
  },
});

const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

const avatarUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
});

const uploadAvatar = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.avatarMaxBytes },
  fileFilter(req, file, cb) {
    if (avatarService.extForMime(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPEG, PNG, WebP, or GIF images are allowed"));
    }
  },
});

authRouter.get(
  "/me",
  asyncHandler(async (req, res) => {
    const uid = Number(req.session?.userId);
    if (!Number.isFinite(uid) || uid <= 0) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const user = await usersRepo.findUserById(uid);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    res.json(publicUser(user));
  }),
);

authRouter.patch(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const uid = Number(req.session.userId);
    const body = req.body || {};
    if (!Object.prototype.hasOwnProperty.call(body, "displayName")) {
      const user = await usersRepo.findUserById(uid);
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      return res.json(publicUser(user));
    }
    const user = await usersRepo.updateProfile(uid, { displayName: body.displayName });
    if (!user) return res.status(404).json({ error: "Not found" });
    res.json(publicUser(user));
  }),
);

authRouter.post(
  "/me/avatar",
  requireAuth,
  avatarUploadLimiter,
  (req, res, next) => {
    uploadAvatar.single("avatar")(req, res, (err) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({ error: "Image too large" });
        }
        return res.status(400).json({ error: err.message || "Upload failed" });
      }
      next();
    });
  },
  asyncHandler(async (req, res) => {
    const uid = Number(req.session.userId);
    if (!req.file?.buffer) {
      return res.status(400).json({ error: "Missing file" });
    }
    const url = await avatarService.storeUploadedAvatar(uid, req.file.buffer, req.file.mimetype);
    const user = await usersRepo.setAvatarUrl(uid, url);
    if (!user) return res.status(404).json({ error: "Not found" });
    res.json(publicUser(user));
  }),
);

authRouter.delete(
  "/me/avatar",
  requireAuth,
  asyncHandler(async (req, res) => {
    const uid = Number(req.session.userId);
    const prev = await usersRepo.findUserById(uid);
    if (!prev) return res.status(404).json({ error: "Not found" });
    await avatarService.deleteStoredAvatar(uid);
    const user = await usersRepo.setAvatarUrl(uid, null);
    res.json(publicUser(user));
  }),
);

function destroySession(req) {
  return new Promise((resolve, reject) => {
    req.session.destroy((err) => (err ? reject(err) : resolve()));
  });
}

authRouter.delete(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const uid = Number(req.session.userId);

    const user = await usersRepo.findUserById(uid);
    if (!user) return res.status(404).json({ error: "Not found" });

    // Best-effort cleanup of uploaded avatars (local disk / S3). Safe if user had no upload.
    await avatarService.deleteStoredAvatar(uid);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Email OTP challenges are not FK-linked; remove any leftovers for this email.
      await client.query(`DELETE FROM email_otp_challenges WHERE lower(email) = $1`, [
        String(user.email || "").trim().toLowerCase(),
      ]);

      // Cascades take care of courses/workbooks/vocabulary/pins/etc.
      const del = await client.query(`DELETE FROM users WHERE id = $1 RETURNING id`, [uid]);
      if (del.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Not found" });
      }

      await client.query("COMMIT");
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw e;
    } finally {
      client.release();
    }

    await destroySession(req);
    res.clearCookie(config.sessionCookieName, { path: "/" });
    res.status(204).end();
  }),
);

authRouter.post(
  "/logout",
  authIpLimiter,
  (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: "Could not log out" });
      }
      res.clearCookie(config.sessionCookieName, { path: "/" });
      res.status(204).end();
    });
  },
);

authRouter.get(
  "/google",
  authIpLimiter,
  (req, res, next) => {
    if (!googleConfigured) {
      return res.status(503).json({ error: "Google sign-in is not configured" });
    }
    passport.authenticate("google", {
      scope: ["profile", "email"],
      session: false,
    })(req, res, next);
  },
);

authRouter.get(
  "/google/callback",
  authIpLimiter,
  (req, res, next) => {
    if (!googleConfigured) {
      return res.redirect(`${config.frontendUrl}/login?error=config`);
    }
    passport.authenticate("google", {
      session: false,
      failureRedirect: `${config.frontendUrl}/login?error=google`,
    })(req, res, next);
  },
  asyncHandler(async (req, res) => {
    const profile = req.user;
    const googleSub = profile?.id != null ? String(profile.id) : "";
    const email = profile?.emails?.[0]?.value;
    if (!googleSub || !email) {
      return res.redirect(`${config.frontendUrl}/login?error=email`);
    }
    const displayName = profile.displayName || [profile.name?.givenName, profile.name?.familyName].filter(Boolean).join(" ");
    const avatarUrl = profile.photos?.[0]?.value || null;
    const user = await usersRepo.upsertGoogleUser({
      googleSub,
      email,
      displayName: displayName || null,
      avatarUrl,
    });
    await regenerateSession(req);
    req.session.userId = user.id;
    res.redirect(`${config.frontendUrl}/app`);
  }),
);

function isValidEmail(s) {
  if (typeof s !== "string") return false;
  const t = s.trim();
  if (t.length < 3 || t.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

authRouter.post(
  "/email/request",
  otpRequestIpLimiter,
  otpRequestEmailLimiter,
  asyncHandler(async (req, res) => {
    const email = req.body?.email;
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Invalid email" });
    }
    const { plainCode } = await otpRepo.saveOtpChallenge(email);
    try {
      await sendOtpEmail(email.trim(), plainCode);
    } catch (e) {
      console.error("[DueNote] Failed to send OTP email:", e?.message || e);
      return res.status(500).json({ error: "Could not send email" });
    }
    res.json({ ok: true });
  }),
);

authRouter.post(
  "/email/verify",
  otpVerifyLimiter,
  asyncHandler(async (req, res) => {
    const email = req.body?.email;
    const code = req.body?.code;
    if (!isValidEmail(email) || typeof code !== "string" || code.trim().length < 4) {
      return res.status(400).json({ error: "Invalid request" });
    }
    const result = await otpRepo.verifyOtpChallenge(email, code);
    if (!result.ok) {
      return res.status(401).json({ error: "Invalid or expired code" });
    }
    const user = await usersRepo.ensureUserAfterEmailOtp(email.trim());
    await regenerateSession(req);
    req.session.userId = user.id;
    res.json({ user: publicUser(user) });
  }),
);
