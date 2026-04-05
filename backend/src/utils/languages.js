/** Supported language codes for courses / DeepL routes */
export const ALLOWED_LANGS = new Set(["EN", "BG", "IT", "DE", "ES"]);

export function normalizeLangOrDefault(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") return null;
  const u = value.trim().toUpperCase();
  return ALLOWED_LANGS.has(u) ? u : null;
}

export function normalizeLangRequired(value) {
  if (typeof value !== "string") return null;
  const u = value.trim().toUpperCase();
  return ALLOWED_LANGS.has(u) ? u : null;
}
