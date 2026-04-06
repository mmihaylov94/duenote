import { createHash, randomInt } from "node:crypto";
import { pool } from "./pool.js";

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function hashCode(email, code) {
  return createHash("sha256").update(`${email}:${code}:duenote-otp`).digest("hex");
}

export function generateOtpCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export async function saveOtpChallenge(email) {
  const normalized = String(email).trim().toLowerCase();
  const code = generateOtpCode();
  const codeHash = hashCode(normalized, code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  await pool.query(`DELETE FROM email_otp_challenges WHERE lower(email) = $1`, [normalized]);
  await pool.query(
    `INSERT INTO email_otp_challenges (email, code_hash, expires_at, attempts, created_at)
     VALUES ($1, $2, $3::timestamptz, 0, NOW())`,
    [normalized, codeHash, expiresAt.toISOString()],
  );
  return { plainCode: code, expiresAt };
}

export async function verifyOtpChallenge(email, code) {
  const normalized = String(email).trim().toLowerCase();
  const { rows } = await pool.query(
    `SELECT id, code_hash, expires_at, attempts FROM email_otp_challenges WHERE lower(email) = $1 ORDER BY created_at DESC LIMIT 1`,
    [normalized],
  );
  const row = rows[0];
  if (!row) return { ok: false, reason: "invalid" };
  if (row.attempts >= MAX_ATTEMPTS) {
    await pool.query(`DELETE FROM email_otp_challenges WHERE id = $1`, [row.id]);
    return { ok: false, reason: "locked" };
  }
  if (new Date(row.expires_at) < new Date()) {
    await pool.query(`DELETE FROM email_otp_challenges WHERE id = $1`, [row.id]);
    return { ok: false, reason: "expired" };
  }
  const expectedHash = hashCode(normalized, String(code).trim());
  await pool.query(`UPDATE email_otp_challenges SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
  if (expectedHash !== row.code_hash) {
    return { ok: false, reason: "invalid" };
  }
  await pool.query(`DELETE FROM email_otp_challenges WHERE id = $1`, [row.id]);
  return { ok: true };
}
