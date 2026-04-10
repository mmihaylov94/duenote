<script setup>
import { ref, watch, onUnmounted, onMounted, nextTick } from "vue";
import { apiFetch } from "../api/client.js";

const section = defineModel({ type: Object, required: true });

const props = defineProps({
  sourceLang: { type: String, required: true },
  targetLang: { type: String, required: true },
});

const error = ref("");
const loadingSide = ref(null);
const leftTa = ref(null);
const rightTa = ref(null);

let leftSnap = { blocks: null, translated: null };
let rightSnap = { blocks: null, translated: null };

let leftTimer = null;
let rightTimer = null;
let langRetranslateTimer = null;

const DEBOUNCE_MS = 1000;
const LANG_RETRANSLATE_MS = 3000;

function normalizeForTranslate(s) {
  return s.replace(/\s+/g, " ").trim();
}

function parseBlocks(text) {
  const parts = text.split(/(\n\n+)/);
  const blocks = [];
  const seps = [];
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) blocks.push(parts[i]);
    else seps.push(parts[i]);
  }
  return { blocks, seps };
}

function joinBlocks(blocks, seps) {
  if (blocks.length === 0) return "";
  let out = blocks[0];
  for (let i = 0; i < seps.length; i++) {
    out += seps[i] + (blocks[i + 1] ?? "");
  }
  return out;
}

function allBlocksMeaningless(blocks) {
  return blocks.every((b) => normalizeForTranslate(b) === "");
}

function blocksEqualNormalized(a, b) {
  return normalizeForTranslate(a) === normalizeForTranslate(b);
}

function blocksArraysMatchNormalized(a, b) {
  if (a.length !== b.length) return false;
  return a.every((blk, i) => blocksEqualNormalized(blk, b[i]));
}

function reuseTranslatedWhenOnlyEmptyBlocksAdded(blocks, prev, pTr) {
  if (!prev.length || blocks.length <= prev.length) return null;

  const prefix = blocks.slice(0, prev.length);
  if (blocksArraysMatchNormalized(prefix, prev)) {
    const tail = blocks.slice(prev.length);
    if (tail.length > 0 && tail.every((b) => normalizeForTranslate(b) === "")) {
      return [...pTr, ...tail.map(() => "")];
    }
  }

  for (let k = 1; k < blocks.length; k++) {
    const head = blocks.slice(0, k);
    const rest = blocks.slice(k);
    if (!head.every((b) => normalizeForTranslate(b) === "")) continue;
    if (blocksArraysMatchNormalized(rest, prev)) {
      return [...head.map(() => ""), ...pTr];
    }
  }

  return null;
}

function resetBlockSnapshots() {
  leftSnap = { blocks: null, translated: null };
  rightSnap = { blocks: null, translated: null };
}

function clearLangRetranslateTimer() {
  if (langRetranslateTimer) {
    clearTimeout(langRetranslateTimer);
    langRetranslateTimer = null;
  }
}

function scheduleLanguageRetranslate() {
  clearLangRetranslateTimer();
  langRetranslateTimer = setTimeout(async () => {
    langRetranslateTimer = null;
    error.value = "";
    const { blocks: lb } = parseBlocks(section.value.sourceText);
    const { blocks: rb } = parseBlocks(section.value.translationText);
    const leftHas = lb.length > 0 && !allBlocksMeaningless(lb);
    const rightHas = rb.length > 0 && !allBlocksMeaningless(rb);
    if (leftHas) {
      await runLeftToRight();
    } else if (rightHas) {
      await runRightToLeft();
    }
  }, LANG_RETRANSLATE_MS);
}

watch(
  () => [props.sourceLang, props.targetLang],
  () => {
    resetBlockSnapshots();
    scheduleLanguageRetranslate();
  },
);

function clearTimers() {
  if (leftTimer) clearTimeout(leftTimer);
  if (rightTimer) clearTimeout(rightTimer);
  leftTimer = null;
  rightTimer = null;
  clearLangRetranslateTimer();
}

onUnmounted(clearTimers);

onMounted(() => {
  nextTick(() => {
    autoGrow(leftTa.value);
    autoGrow(rightTa.value);
  });
});

function autoGrow(el) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

async function translate(text, sourceLang, targetLang) {
  const res = await apiFetch("/api/translate", {
    method: "POST",
    body: JSON.stringify({ text, sourceLang, targetLang }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data.translatedText ?? "";
}

async function translateBlock(text, sourceLang, targetLang) {
  if (normalizeForTranslate(text) === "") return "";
  return translate(text, sourceLang, targetLang);
}

async function buildTranslatedBlocks(
  blocks,
  prevBlocks,
  prevTranslated,
  sourceLang,
  targetLang,
) {
  const prev = prevBlocks;
  const pTr = prevTranslated;

  if (!prev || !pTr) {
    return Promise.all(
      blocks.map((b) => translateBlock(b, sourceLang, targetLang)),
    );
  }

  if (prev.length === blocks.length) {
    return Promise.all(
      blocks.map((b, i) => {
        if (normalizeForTranslate(b) === normalizeForTranslate(prev[i])) {
          return Promise.resolve(pTr[i]);
        }
        return translateBlock(b, sourceLang, targetLang);
      }),
    );
  }

  const reused = reuseTranslatedWhenOnlyEmptyBlocksAdded(blocks, prev, pTr);
  if (reused) {
    return reused;
  }

  return Promise.all(
    blocks.map((b) => translateBlock(b, sourceLang, targetLang)),
  );
}

async function runLeftToRight() {
  const { blocks, seps } = parseBlocks(section.value.sourceText);

  if (blocks.length === 0 || allBlocksMeaningless(blocks)) {
    section.value.translationText = "";
    leftSnap = { blocks: null, translated: null };
    await nextTick();
    autoGrow(leftTa.value);
    autoGrow(rightTa.value);
    return;
  }

  loadingSide.value = "right";
  try {
    const translated = await buildTranslatedBlocks(
      blocks,
      leftSnap.blocks,
      leftSnap.translated,
      props.sourceLang,
      props.targetLang,
    );
    section.value.translationText = joinBlocks(translated, seps);
    leftSnap = { blocks: blocks.slice(), translated: translated.slice() };
    await nextTick();
    autoGrow(rightTa.value);
  } catch (e) {
    error.value = e.message || "Translation failed";
  } finally {
    loadingSide.value = null;
  }
}

async function runRightToLeft() {
  const { blocks, seps } = parseBlocks(section.value.translationText);

  if (blocks.length === 0 || allBlocksMeaningless(blocks)) {
    section.value.sourceText = "";
    rightSnap = { blocks: null, translated: null };
    await nextTick();
    autoGrow(leftTa.value);
    autoGrow(rightTa.value);
    return;
  }

  loadingSide.value = "left";
  try {
    const translated = await buildTranslatedBlocks(
      blocks,
      rightSnap.blocks,
      rightSnap.translated,
      props.targetLang,
      props.sourceLang,
    );
    section.value.sourceText = joinBlocks(translated, seps);
    rightSnap = { blocks: blocks.slice(), translated: translated.slice() };
    await nextTick();
    autoGrow(leftTa.value);
  } catch (e) {
    error.value = e.message || "Translation failed";
  } finally {
    loadingSide.value = null;
  }
}

watch(
  () => [section.value.sourceText, section.value.translationText],
  () => {
    nextTick(() => {
      autoGrow(leftTa.value);
      autoGrow(rightTa.value);
    });
  },
);

function onLeftInput(e) {
  error.value = "";
  clearLangRetranslateTimer();
  if (rightTimer) {
    clearTimeout(rightTimer);
    rightTimer = null;
  }
  if (leftTimer) clearTimeout(leftTimer);
  leftTimer = setTimeout(async () => {
    leftTimer = null;
    await runLeftToRight();
  }, DEBOUNCE_MS);
  autoGrow(e.target);
}

function onRightInput(e) {
  error.value = "";
  clearLangRetranslateTimer();
  if (leftTimer) {
    clearTimeout(leftTimer);
    leftTimer = null;
  }
  if (rightTimer) clearTimeout(rightTimer);
  rightTimer = setTimeout(async () => {
    rightTimer = null;
    await runRightToLeft();
  }, DEBOUNCE_MS);
  autoGrow(e.target);
}
</script>

<template>
  <div
    data-dictionary-host
    :data-tts-source-lang="props.sourceLang"
    :data-tts-target-lang="props.targetLang"
    class="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
  >
    <div class="p-3">
      <p
        v-if="error"
        class="mb-3 rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
      >
        {{ error }}
      </p>
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div class="flex min-h-0 flex-col gap-2">
          <textarea
            ref="leftTa"
            data-tts-lang="sourceLang"
            v-model="section.sourceText"
            class="min-h-30 w-full resize-none overflow-hidden rounded-md border border-zinc-300 bg-white p-3 font-sans text-base leading-relaxed shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-950 field-sizing-content"
            placeholder="Type here…"
            :disabled="loadingSide === 'left'"
            @input="onLeftInput"
          />
          <p v-if="loadingSide === 'left'" class="text-xs text-zinc-500">
            Translating…
          </p>
        </div>
        <div class="flex min-h-0 flex-col gap-2">
          <textarea
            ref="rightTa"
            data-tts-lang="targetLang"
            data-disable-dictionary
            v-model="section.translationText"
            class="min-h-30 w-full resize-none overflow-hidden rounded-md border border-zinc-300 bg-white p-3 font-sans text-base leading-relaxed shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-950 field-sizing-content"
            placeholder="Translation appears here…"
            :disabled="loadingSide === 'right'"
            @input="onRightInput"
          />
          <p v-if="loadingSide === 'right'" class="text-xs text-zinc-500">
            Translating…
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
