/**
 * Requires an authenticated session with `userId`. Use after `express-session`.
 */
export function requireAuth(req, res, next) {
  const raw = req.session?.userId;
  const uid = Number(raw);
  if (!Number.isFinite(uid) || uid <= 0) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}
