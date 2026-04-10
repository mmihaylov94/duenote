<script setup>
import { ref, onMounted, onUnmounted, watch } from "vue";
import {
  BookOpenIcon,
  SpeakerWaveIcon,
  SpeakerXMarkIcon,
} from "@heroicons/vue/24/outline";
import { apiFetch } from "../api/client.js";

const props = defineProps({
  courseId: { type: Number, default: null },
  sourceLang: { type: String, default: "EN" },
  targetLang: { type: String, default: "DE" },
  /** (word, meaning) => Promise<void> */
  addEntry: { type: Function, default: null },
  /** Workbook default language (e.g. EN) */
  defaultLang: { type: String, default: "EN" },
});

const visible = ref(false);
const panelStyle = ref({ top: "0px", left: "0px" });

const selectionText = ref("");
const langHint = ref("");
const dictionaryAllowed = ref(true);

const dictLoading = ref(false);
const ttsLoading = ref(false);
const speaking = ref(false);
const err = ref("");
const activeAudio = ref(null);
const ttsAbort = ref(null);
const ttsRequestId = ref(0);

const HOST = "[data-dictionary-host]";

function normalizeLang(code) {
  const v = String(code || "")
    .trim()
    .toUpperCase();
  if (!v) return "";
  // Minimal mapping for the app's common codes; can be extended later.
  const map = {
    EN: "en",
    DE: "de",
    FR: "fr",
    ES: "es",
    IT: "it",
    PT: "pt",
    NL: "nl",
    PL: "pl",
    RU: "ru",
    UK: "uk",
    JA: "ja",
    KO: "ko",
    ZH: "zh",
    TR: "tr",
    SV: "sv",
    NO: "no",
    DA: "da",
    FI: "fi",
    CS: "cs",
    EL: "el",
    HU: "hu",
    RO: "ro",
    SK: "sk",
    SL: "sl",
    ET: "et",
    LV: "lv",
    LT: "lt",
    ID: "id",
    BG: "bg",
  };
  return map[v] || v.toLowerCase();
}

function resolveSelectionLang(activeEl) {
  if (!(activeEl instanceof Element)) return normalizeLang(props.defaultLang);
  const raw = activeEl.getAttribute("data-tts-lang") || "";
  if (raw === "sourceLang" || raw === "targetLang") {
    // TranslatorView stamps resolved codes on the container.
    const host = activeEl.closest(HOST);
    const fromHost =
      raw === "sourceLang"
        ? host?.getAttribute?.("data-tts-source-lang")
        : host?.getAttribute?.("data-tts-target-lang");
    return normalizeLang(fromHost || props.defaultLang);
  }
  return normalizeLang(raw || props.defaultLang);
}

function readSelection() {
  const active = document.activeElement;
  if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) {
    const start = active.selectionStart;
    const end = active.selectionEnd;
    if (start == null || end == null || start === end) {
      return { text: "", host: null, lang: "" };
    }
    const host = active.closest(HOST);
    if (!host) return { text: "", host: null, lang: "" };
    const raw = active.value.slice(start, end);
    const allowDict =
      !active.closest?.("[data-disable-dictionary]") &&
      !host.closest?.("[data-disable-dictionary]");
    return {
      text: raw.trim(),
      host,
      lang: resolveSelectionLang(active),
      allowDict,
    };
  }
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
    return { text: "", host: null, lang: "", allowDict: true };
  }
  const node = sel.anchorNode;
  if (!node) return { text: "", host: null, lang: "", allowDict: true };
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  const host = el?.closest?.(HOST);
  if (!host) return { text: "", host: null, lang: "", allowDict: true };
  const raw = sel.toString();
  const lang =
    resolveSelectionLang(el) ||
    normalizeLang(
      host?.getAttribute?.("data-tts-source-lang") || props.defaultLang,
    );
  const allowDict = !(
    el?.closest?.("[data-disable-dictionary]") ||
    host.closest?.("[data-disable-dictionary]")
  );
  return { text: raw.trim(), host, lang, allowDict };
}

function placePanel(host) {
  const sel = window.getSelection();
  let r = null;
  if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
    r = sel.getRangeAt(0).getBoundingClientRect();
  }
  if (!r || (r.width === 0 && r.height === 0)) {
    r = host.getBoundingClientRect();
  }
  const pad = 8;
  const top = Math.max(4, r.top - pad);
  const left = r.left + r.width / 2;
  panelStyle.value = {
    top: `${top}px`,
    left: `${left}px`,
  };
}

function syncFromSelection() {
  err.value = "";
  const s = readSelection();
  if (!s.text || !s.host) {
    visible.value = false;
    selectionText.value = "";
    langHint.value = "";
    dictionaryAllowed.value = true;
    return;
  }
  selectionText.value = s.text.slice(0, 5000);
  langHint.value = s.lang || normalizeLang(props.defaultLang);
  dictionaryAllowed.value = s.allowDict !== false;
  placePanel(s.host);
  visible.value = true;
}

function stopSpeaking() {
  const ac = ttsAbort.value;
  if (ac instanceof AbortController) {
    try {
      ac.abort();
    } catch {
      /* ignore */
    }
  }
  ttsAbort.value = null;

  const a = activeAudio.value;
  if (a instanceof HTMLAudioElement) {
    try {
      a.pause();
      a.currentTime = 0;
      a.src = "";
    } catch {
      /* ignore */
    }
  }
  activeAudio.value = null;
  speaking.value = false;
}

async function onAddToDictionary() {
  const w = selectionText.value.trim().slice(0, 2000);
  if (!w || dictLoading.value) return;
  if (props.courseId == null || typeof props.addEntry !== "function") return;
  dictLoading.value = true;
  err.value = "";
  try {
    const tr = await apiFetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: w,
        sourceLang: props.sourceLang,
        targetLang: props.targetLang,
      }),
    });
    if (!tr.ok) {
      const j = await tr.json().catch(() => ({}));
      err.value = j.error || `Translation failed (${tr.status})`;
      return;
    }
    const data = await tr.json();
    const meaning = String(data.translatedText ?? "").trim();
    await props.addEntry(w, meaning);
    visible.value = false;
    selectionText.value = "";
    window.getSelection()?.removeAllRanges?.();
  } catch (e) {
    err.value = e instanceof Error ? e.message : "Something went wrong";
  } finally {
    dictLoading.value = false;
  }
}

async function speakWithApi() {
  const t = selectionText.value.trim();
  if (!t) return;
  const lang = langHint.value || normalizeLang(props.defaultLang);
  const myId = ++ttsRequestId.value;
  const ac = new AbortController();
  ttsAbort.value = ac;

  const r = await apiFetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: t, lang }),
    signal: ac.signal,
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.error || `TTS failed (HTTP ${r.status})`);
  }
  const blob = await r.blob();
  if (myId !== ttsRequestId.value) return;
  const url = URL.createObjectURL(blob);
  try {
    const a = new Audio(url);
    if (myId !== ttsRequestId.value) return;
    activeAudio.value = a;
    speaking.value = true;
    await a.play();
    await new Promise((resolve) => {
      a.addEventListener("ended", resolve, { once: true });
      a.addEventListener("error", resolve, { once: true });
    });
  } finally {
    if (myId === ttsRequestId.value) {
      speaking.value = false;
      activeAudio.value = null;
      ttsAbort.value = null;
    }
    URL.revokeObjectURL(url);
  }
}

async function onSpeak() {
  if (ttsLoading.value) return;
  const t = selectionText.value.trim();
  if (!t) return;
  ttsLoading.value = true;
  err.value = "";
  try {
    stopSpeaking();
    await speakWithApi();
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      // User hit Stop or started a new request.
      return;
    }
    err.value = e instanceof Error ? e.message : "Text-to-speech failed.";
  } finally {
    ttsLoading.value = false;
    speaking.value = false;
  }
}

function onMouseUp() {
  requestAnimationFrame(syncFromSelection);
}

function onScroll() {
  if (visible.value) visible.value = false;
}

function onDocMouseDown(e) {
  if (!visible.value) return;
  const t = e.target;
  if (t.closest?.(".selection-actions-panel")) return;
  visible.value = false;
}

let selTimer = null;
function onSelectionChange() {
  clearTimeout(selTimer);
  selTimer = setTimeout(() => {
    syncFromSelection();
  }, 80);
}

watch(
  () => [props.courseId, props.sourceLang, props.targetLang, props.defaultLang],
  () => {
    visible.value = false;
  },
);

onMounted(() => {
  document.addEventListener("mouseup", onMouseUp, true);
  document.addEventListener("selectionchange", onSelectionChange);
  document.addEventListener("mousedown", onDocMouseDown, true);
  window.addEventListener("scroll", onScroll, true);
});

onUnmounted(() => {
  clearTimeout(selTimer);
  stopSpeaking();
  document.removeEventListener("mouseup", onMouseUp, true);
  document.removeEventListener("selectionchange", onSelectionChange);
  document.removeEventListener("mousedown", onDocMouseDown, true);
  window.removeEventListener("scroll", onScroll, true);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-show="visible"
      class="selection-actions-panel pointer-events-none fixed z-100 -translate-x-1/2 -translate-y-full"
      :style="panelStyle"
    >
      <div
        class="pointer-events-auto flex flex-col gap-1 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs shadow-lg dark:border-zinc-600 dark:bg-zinc-900"
      >
        <div class="flex items-center gap-1.5">
          <button
            v-if="dictionaryAllowed"
            type="button"
            class="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400"
            :disabled="
              dictLoading || courseId == null || typeof addEntry !== 'function'
            "
            aria-label="Add to dictionary"
            title="Add to dictionary"
            @mousedown.prevent
            @click="onAddToDictionary"
          >
            <BookOpenIcon class="h-4 w-4" aria-hidden="true" />
          </button>

          <button
            v-if="speaking || ttsLoading"
            type="button"
            class="flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            aria-label="Stop reading"
            title="Stop"
            @mousedown.prevent
            @click="stopSpeaking"
          >
            <SpeakerXMarkIcon class="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            v-else
            type="button"
            class="flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            :disabled="ttsLoading"
            aria-label="Read aloud"
            title="Read aloud"
            @mousedown.prevent
            @click="onSpeak"
          >
            <SpeakerWaveIcon class="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <p v-if="err" class="max-w-64 text-red-600 dark:text-red-400">
          {{ err }}
        </p>
      </div>
    </div>
  </Teleport>
</template>
