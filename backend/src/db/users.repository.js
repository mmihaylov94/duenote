import { pool } from "./pool.js";

function nowIso() {
  return new Date().toISOString();
}

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    emailVerifiedAt: row.email_verified_at,
    googleSub: row.google_sub,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function findUserById(id) {
  const { rows } = await pool.query(
    `SELECT id, email, email_verified_at, google_sub, display_name, avatar_url, created_at, updated_at
     FROM users WHERE id = $1`,
    [id],
  );
  return rowToUser(rows[0]);
}

export async function findUserByEmail(email) {
  const normalized = String(email).trim().toLowerCase();
  const { rows } = await pool.query(
    `SELECT id, email, email_verified_at, google_sub, display_name, avatar_url, created_at, updated_at
     FROM users WHERE lower(email) = $1`,
    [normalized],
  );
  return rowToUser(rows[0]);
}

export async function findUserByGoogleSub(googleSub) {
  const { rows } = await pool.query(
    `SELECT id, email, email_verified_at, google_sub, display_name, avatar_url, created_at, updated_at
     FROM users WHERE google_sub = $1`,
    [googleSub],
  );
  return rowToUser(rows[0]);
}

export async function createUser({ email, googleSub = null, displayName = null, avatarUrl = null, emailVerified = false }) {
  const normalized = String(email).trim().toLowerCase();
  const t = nowIso();
  const { rows } = await pool.query(
    `INSERT INTO users (email, email_verified_at, google_sub, display_name, avatar_url, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $6::timestamptz)
     RETURNING id, email, email_verified_at, google_sub, display_name, avatar_url, created_at, updated_at`,
    [
      normalized,
      emailVerified ? t : null,
      googleSub,
      displayName,
      avatarUrl,
      t,
    ],
  );
  return rowToUser(rows[0]);
}

export async function upsertGoogleUser({ googleSub, email, displayName, avatarUrl }) {
  const normalized = String(email).trim().toLowerCase();
  const t = nowIso();
  const existing = await findUserByGoogleSub(googleSub);
  if (existing) {
    const { rows } = await pool.query(
      `UPDATE users SET email = $1, display_name = COALESCE($2, display_name), avatar_url = COALESCE($3, avatar_url),
         email_verified_at = COALESCE(email_verified_at, $4::timestamptz), updated_at = $5::timestamptz
       WHERE id = $6
       RETURNING id, email, email_verified_at, google_sub, display_name, avatar_url, created_at, updated_at`,
      [normalized, displayName, avatarUrl, t, t, existing.id],
    );
    return rowToUser(rows[0]);
  }
  const byEmail = await findUserByEmail(normalized);
  if (byEmail) {
    const { rows } = await pool.query(
      `UPDATE users SET google_sub = $1, display_name = COALESCE($2, display_name), avatar_url = COALESCE($3, avatar_url),
         email_verified_at = COALESCE(email_verified_at, $4::timestamptz), updated_at = $5::timestamptz
       WHERE id = $6
       RETURNING id, email, email_verified_at, google_sub, display_name, avatar_url, created_at, updated_at`,
      [googleSub, displayName, avatarUrl, t, t, byEmail.id],
    );
    return rowToUser(rows[0]);
  }
  return createUser({
    email: normalized,
    googleSub,
    displayName,
    avatarUrl,
    emailVerified: true,
  });
}

export async function markEmailVerified(userId) {
  const t = nowIso();
  await pool.query(
    `UPDATE users SET email_verified_at = COALESCE(email_verified_at, $1::timestamptz), updated_at = $1::timestamptz WHERE id = $2`,
    [t, userId],
  );
  return findUserById(userId);
}

const MAX_DISPLAY_NAME = 200;

/**
 * @param {number} userId
 * @param {{ displayName?: string | null }} fields
 */
export async function updateProfile(userId, fields) {
  const uid = Number(userId);
  if (!Number.isFinite(uid) || uid <= 0) return null;
  const existing = await findUserById(uid);
  if (!existing) return null;

  if (!Object.prototype.hasOwnProperty.call(fields, "displayName")) {
    return existing;
  }

  const raw = fields.displayName;
  const d = raw == null || String(raw).trim() === "" ? null : String(raw).trim().slice(0, MAX_DISPLAY_NAME);

  await pool.query(
    `UPDATE users SET display_name = $1, updated_at = $2::timestamptz WHERE id = $3`,
    [d, nowIso(), uid],
  );
  return findUserById(uid);
}

/** Set avatar URL after upload or OAuth (any https URL). */
export async function setAvatarUrl(userId, avatarUrl) {
  const uid = Number(userId);
  if (!Number.isFinite(uid) || uid <= 0) return null;
  await pool.query(`UPDATE users SET avatar_url = $1, updated_at = $2::timestamptz WHERE id = $3`, [
    avatarUrl,
    nowIso(),
    uid,
  ]);
  return findUserById(uid);
}

/** After a valid email OTP: create user or mark existing email as verified. */
export async function ensureUserAfterEmailOtp(email) {
  const normalized = String(email).trim().toLowerCase();
  let user = await findUserByEmail(normalized);
  if (user) {
    return markEmailVerified(user.id);
  }
  return createUser({
    email: normalized,
    emailVerified: true,
  });
}
