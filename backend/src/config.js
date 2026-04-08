import "dotenv/config";

const NODE_ENV = process.env.NODE_ENV || "development";

/**
 * CORS: omit or `*` / empty → reflect request origin (same as cors({ origin: true })).
 * Comma-separated list → only those origins (e.g. `https://app.example.com`).
 * With credentials, use explicit origins in production.
 */
function parseCorsOrigin(raw) {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (v === "" || v === "*") return true;
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

function trim(v) {
  return typeof v === "string" ? v.trim() : "";
}

function sessionSecret() {
  const s = trim(process.env.SESSION_SECRET);
  if (NODE_ENV === "production") {
    if (!s || s.length < 32) {
      throw new Error("SESSION_SECRET is required in production (min 32 characters).");
    }
    return s;
  }
  return s || "dev-insecure-duenote-session-do-not-use-in-prod";
}

const PUBLIC_API_URL = trim(process.env.PUBLIC_API_URL) || "http://localhost:3000";
const FRONTEND_URL = trim(process.env.FRONTEND_URL) || "http://localhost:5173";

export const config = {
  nodeEnv: NODE_ENV,
  isProd: NODE_ENV === "production",
  port: Number(process.env.PORT) || 3000,
  corsOrigin: parseCorsOrigin(process.env.CORS_ORIGIN),
  deeplApiUrl: (process.env.DEEPL_API_URL || "https://api-free.deepl.com").replace(/\/$/, ""),
  jsonLimit: process.env.JSON_LIMIT || "2mb",
  sessionSecret: sessionSecret(),
  cookieSecure: process.env.COOKIE_SECURE === "true" || (process.env.COOKIE_SECURE !== "false" && NODE_ENV === "production"),
  frontendUrl: FRONTEND_URL.replace(/\/$/, ""),
  publicApiUrl: PUBLIC_API_URL.replace(/\/$/, ""),
  googleClientId: trim(process.env.GOOGLE_CLIENT_ID) || "",
  googleClientSecret: trim(process.env.GOOGLE_CLIENT_SECRET) || "",
  googleCallbackUrl:
    trim(process.env.GOOGLE_CALLBACK_URL) ||
    `${PUBLIC_API_URL.replace(/\/$/, "")}/auth/google/callback`,
  smtpHost: trim(process.env.SMTP_HOST),
  smtpPort: Number(process.env.SMTP_PORT) || 587,
  smtpSecure: process.env.SMTP_SECURE === "true",
  smtpUser: trim(process.env.SMTP_USER),
  smtpPass: trim(process.env.SMTP_PASS),
  smtpFrom: trim(process.env.SMTP_FROM) || '"DueNote" <noreply@localhost>',
  sessionCookieName: "duenote.sid",
  /** Directory for locally uploaded avatars (created on first upload). */
  avatarLocalDir: trim(process.env.AVATAR_UPLOAD_DIR) || "./data/uploads/avatars",
  avatarMaxBytes: Math.min(Number(process.env.AVATAR_MAX_BYTES) || 2 * 1024 * 1024, 5 * 1024 * 1024),
  /** Directory for locally uploaded course materials (created on first upload). */
  materialsLocalDir: trim(process.env.MATERIALS_UPLOAD_DIR) || "./data/uploads/materials",
  /** Max upload size for materials (bytes). */
  materialsMaxBytes: Math.min(Number(process.env.MATERIALS_MAX_BYTES) || 25 * 1024 * 1024, 250 * 1024 * 1024),
  /** When set with region, new avatar uploads go to S3 instead of disk. */
  s3Bucket: trim(process.env.S3_BUCKET),
  s3Region: trim(process.env.S3_REGION),
  /** Optional prefix for keys, e.g. `prod/` */
  s3KeyPrefix: trim(process.env.S3_KEY_PREFIX || "").replace(/^\/+|\/+$/g, ""),
  /** Public base URL for avatar objects (e.g. CloudFront). If unset, virtual-hosted–style S3 URL is used. */
  s3PublicBaseUrl: trim(process.env.S3_PUBLIC_BASE_URL).replace(/\/$/, ""),
  awsAccessKeyId: trim(process.env.AWS_ACCESS_KEY_ID),
  awsSecretAccessKey: trim(process.env.AWS_SECRET_ACCESS_KEY),
};
