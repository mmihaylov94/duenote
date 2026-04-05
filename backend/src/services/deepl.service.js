import { config } from "../config.js";
import { ALLOWED_LANGS } from "../utils/languages.js";

function toDeepLTarget(lang) {
  if (lang === "EN") return "EN-US";
  return lang;
}

function toDeepLSource(lang) {
  return lang === "EN" ? "EN" : lang;
}

/**
 * @returns {{ translatedText: string }}
 */
export async function translateText({ text, sourceLang, targetLang }) {
  const key = process.env.DEEPL_AUTH_KEY;
  if (!key) {
    const err = new Error("Server missing DEEPL_AUTH_KEY");
    err.statusCode = 500;
    throw err;
  }

  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!trimmed) {
    const err = new Error("text is required");
    err.statusCode = 400;
    throw err;
  }
  if (typeof sourceLang !== "string" || typeof targetLang !== "string") {
    const err = new Error("sourceLang and targetLang are required");
    err.statusCode = 400;
    throw err;
  }

  const src = sourceLang.toUpperCase();
  const tgt = targetLang.toUpperCase();
  if (!ALLOWED_LANGS.has(src) || !ALLOWED_LANGS.has(tgt)) {
    const err = new Error("Unsupported language pair");
    err.statusCode = 400;
    throw err;
  }
  if (src === tgt) {
    return { translatedText: trimmed };
  }

  const body = {
    text: [trimmed],
    source_lang: toDeepLSource(src),
    target_lang: toDeepLTarget(tgt),
  };

  let deeplRes;
  try {
    deeplRes = await fetch(`${config.deeplApiUrl}/v2/translate`, {
      method: "POST",
      headers: {
        Authorization: `DeepL-Auth-Key ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    const err = new Error("Translation service unreachable");
    err.statusCode = 502;
    throw err;
  }

  const raw = await deeplRes.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    const err = new Error("Invalid response from translation service");
    err.statusCode = 502;
    throw err;
  }

  if (!deeplRes.ok) {
    const msg =
      data.message || data.error?.message || `Translation failed (${deeplRes.status})`;
    const err = new Error(msg);
    err.statusCode = deeplRes.status === 403 || deeplRes.status === 401 ? 401 : 502;
    throw err;
  }

  const translated = data.translations?.[0]?.text;
  if (typeof translated !== "string") {
    const err = new Error("Unexpected translation response");
    err.statusCode = 502;
    throw err;
  }

  return { translatedText: translated };
}
