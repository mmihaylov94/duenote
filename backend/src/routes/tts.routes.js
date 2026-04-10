import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { config } from "../config.js";

export const ttsRouter = Router();
ttsRouter.use(requireAuth);
ttsRouter.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const uid = req.session?.userId;
      if (uid != null) return `uid:${uid}`;
      return ipKeyGenerator(req);
    },
    handler: (_req, res) => res.status(429).json({ error: "Too many TTS requests. Please slow down." }),
  }),
);

function normalizeLang(code) {
  const v = String(code || "").trim().toLowerCase();
  if (!v) return "en";
  // Expect BCP-47-ish (en, en-US) from frontend; accept app short codes too.
  const map = {
    en: "en-US",
    de: "de-DE",
    fr: "fr-FR",
    es: "es-ES",
    it: "it-IT",
    pt: "pt-PT",
    nl: "nl-NL",
    pl: "pl-PL",
    ru: "ru-RU",
    uk: "uk-UA",
    ja: "ja-JP",
    ko: "ko-KR",
    zh: "zh-CN",
    tr: "tr-TR",
    sv: "sv-SE",
    no: "nb-NO",
    da: "da-DK",
    fi: "fi-FI",
    cs: "cs-CZ",
    el: "el-GR",
    hu: "hu-HU",
    ro: "ro-RO",
    sk: "sk-SK",
    sl: "sl-SI",
    et: "et-EE",
    lv: "lv-LV",
    lt: "lt-LT",
    id: "id-ID",
    bg: "bg-BG",
  };
  if (map[v]) return map[v];
  const short = v.split("-")[0];
  if (map[short]) return map[short];
  // Best-effort: titlecase region if present
  if (v.includes("-")) {
    const [a, b] = v.split("-", 2);
    return `${a}-${String(b || "").toUpperCase()}`;
  }
  return v;
}

function escapeXml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function defaultVoiceForLocale(locale) {
  // Simple defaults.
  const base = String(locale || "").toLowerCase();
  const by = {
    "en-us": "en-US-JennyNeural",
    "en-gb": "en-GB-SoniaNeural",
    "de-de": "de-DE-KatjaNeural",
    "fr-fr": "fr-FR-DeniseNeural",
    "es-es": "es-ES-ElviraNeural",
    "it-it": "it-IT-ElsaNeural",
    "pt-pt": "pt-PT-RaquelNeural",
    "pt-br": "pt-BR-FranciscaNeural",
    "nl-nl": "nl-NL-FennaNeural",
    "pl-pl": "pl-PL-AgnieszkaNeural",
    "ru-ru": "ru-RU-SvetlanaNeural",
    "uk-ua": "uk-UA-PolinaNeural",
    "ja-jp": "ja-JP-NanamiNeural",
    "ko-kr": "ko-KR-SunHiNeural",
    "zh-cn": "zh-CN-XiaoxiaoNeural",
    "tr-tr": "tr-TR-EmelNeural",
    "sv-se": "sv-SE-SofieNeural",
    "nb-no": "nb-NO-PernilleNeural",
    "da-dk": "da-DK-ChristelNeural",
    "fi-fi": "fi-FI-NooraNeural",
    "cs-cz": "cs-CZ-VlastaNeural",
    "el-gr": "el-GR-AthinaNeural",
    "hu-hu": "hu-HU-NoemiNeural",
    "ro-ro": "ro-RO-AlinaNeural",
    "sk-sk": "sk-SK-ViktoriaNeural",
    "sl-si": "sl-SI-PetraNeural",
    "et-ee": "et-EE-AnuNeural",
    "lv-lv": "lv-LV-EveritaNeural",
    "lt-lt": "lt-LT-OnaNeural",
    "id-id": "id-ID-GadisNeural",
    "bg-bg": "bg-BG-KalinaNeural",
  };
  return by[base] || "en-US-JennyNeural";
}

ttsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    if (!config.azureSpeechKey || !config.azureSpeechRegion) {
      return res.status(501).json({
        error:
          "TTS fallback is not configured. Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in backend .env.",
      });
    }
    const body = req.body || {};
    const rawText = typeof body.text === "string" ? body.text : "";
    const text = rawText.trim().slice(0, 5000);
    if (!text) return res.status(400).json({ error: "Missing text" });
    const locale = normalizeLang(body.lang);
    const voice = defaultVoiceForLocale(locale);

    const ssml = `<?xml version="1.0" encoding="utf-8"?>` +
      `<speak version="1.0" xml:lang="${escapeXml(locale)}">` +
      `<voice name="${escapeXml(voice)}">${escapeXml(text)}</voice>` +
      `</speak>`;

    const url = `https://${config.azureSpeechRegion}.tts.speech.microsoft.com/cognitiveservices/v1`;
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": config.azureSpeechKey,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-16khz-128kbitrate-mono-mp3",
        "User-Agent": "duenote",
      },
      body: ssml,
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      return res.status(502).json({
        error: `Azure TTS failed (HTTP ${r.status})`,
        detail: detail ? detail.slice(0, 500) : undefined,
      });
    }

    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(buf);
  }),
);

