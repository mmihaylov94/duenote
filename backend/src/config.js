import "dotenv/config";

const NODE_ENV = process.env.NODE_ENV || "development";

/**
 * CORS: omit or `*` / empty → reflect request origin (same as cors({ origin: true })).
 * Comma-separated list → only those origins (e.g. `https://app.example.com`).
 */
function parseCorsOrigin(raw) {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (v === "" || v === "*") return true;
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

export const config = {
  nodeEnv: NODE_ENV,
  isProd: NODE_ENV === "production",
  port: Number(process.env.PORT) || 3000,
  corsOrigin: parseCorsOrigin(process.env.CORS_ORIGIN),
  deeplApiUrl: (process.env.DEEPL_API_URL || "https://api-free.deepl.com").replace(/\/$/, ""),
  jsonLimit: process.env.JSON_LIMIT || "2mb",
};
