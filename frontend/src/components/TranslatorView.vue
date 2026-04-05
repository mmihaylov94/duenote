<script setup>
import { ref, watch, onUnmounted, nextTick } from "vue";
import { TrashIcon } from "@heroicons/vue/20/solid";
import TranslationSection from "./TranslationSection.vue";
import HeaderSection from "./HeaderSection.vue";
import VocabularySection from "./VocabularySection.vue";
import SimpleTextSection from "./SimpleTextSection.vue";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";

const props = defineProps({
  workbookId: { type: Number, required: true },
});

const emit = defineEmits(["loaded", "saved", "meta"]);

const sourceLang = defineModel("sourceLang", { type: String, default: "EN" });
const targetLang = defineModel("targetLang", { type: String, default: "DE" });

const sections = ref([]);
const loadError = ref("");
const isHydrating = ref(false);
let loadAbort = null;
let saveAbort = null;
let saveTimer = null;

const SAVE_DEBOUNCE_MS = 1000;

function workbookTitleFromSections(list) {
  const line = (list[0]?.text ?? "").trim().split(/\n/)[0];
  return line || "Untitled";
}

function newSection(kind) {
  const id = crypto.randomUUID();
  if (kind === "translation") {
    return {
      id,
      type: "translation",
      sourceLang: sourceLang.value,
      targetLang: targetLang.value,
      sourceText: "",
      translationText: "",
    };
  }
  if (kind === "vocabulary") {
    return {
      id,
      type: "vocabulary",
      rows: [{ id: crypto.randomUUID(), word: "", meaning: "" }],
    };
  }
  return { id, type: kind, text: "" };
}

function ensureSectionShape(list) {
  return list.map((s) => {
    const id = s.id || crypto.randomUUID();
    if (s.type === "translation") {
      return {
        id,
        type: "translation",
        sourceLang: s.sourceLang ?? sourceLang.value,
        targetLang: s.targetLang ?? targetLang.value,
        sourceText: s.sourceText ?? "",
        translationText: s.translationText ?? "",
      };
    }
    if (s.type === "vocabulary") {
      const rows = Array.isArray(s.rows) && s.rows.length > 0 ? s.rows : [{}];
      return {
        id,
        type: "vocabulary",
        rows: rows.map((r) => ({
          id: r.id || crypto.randomUUID(),
          word: r.word ?? "",
          meaning: r.meaning ?? "",
        })),
      };
    }
    return {
      id,
      type: s.type,
      text: s.text ?? "",
    };
  });
}

function syncLangsIntoTranslationSections() {
  const sl = sourceLang.value;
  const tl = targetLang.value;
  for (const s of sections.value) {
    if (s.type === "translation") {
      s.sourceLang = sl;
      s.targetLang = tl;
    }
  }
}

onUnmounted(() => {
  if (loadAbort) loadAbort.abort();
  if (saveAbort) saveAbort.abort();
  if (saveTimer) clearTimeout(saveTimer);
});

async function loadWorkbook() {
  const id = props.workbookId;
  if (!id) return;
  if (loadAbort) loadAbort.abort();
  loadAbort = new AbortController();
  const signal = loadAbort.signal;
  isHydrating.value = true;
  loadError.value = "";
  try {
    const res = await fetch(`${API_BASE}/api/workbooks/${id}`, { signal });
    if (!res.ok) throw new Error("Failed to load workbook");
    const w = await res.json();
    if (id !== props.workbookId) return;
    sourceLang.value = w.sourceLang ?? "EN";
    targetLang.value = w.targetLang ?? "DE";
    const raw = Array.isArray(w.sections) ? w.sections : [];
    sections.value = ensureSectionShape(raw.length ? raw : [newSection("header")]);
    syncLangsIntoTranslationSections();
    emit("loaded", { title: w.title ?? "Untitled" });
    emit("meta", { title: workbookTitleFromSections(sections.value) });
  } catch (e) {
    if (e.name === "AbortError") return;
    loadError.value = e.message || "Could not load workbook";
  } finally {
    await nextTick();
    isHydrating.value = false;
  }
}

watch(
  () => props.workbookId,
  () => {
    loadWorkbook();
  },
  { immediate: true },
);

watch([sourceLang, targetLang], () => {
  syncLangsIntoTranslationSections();
  schedulePersist();
});

function schedulePersist() {
  if (isHydrating.value) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persistWorkbook();
  }, SAVE_DEBOUNCE_MS);
}

async function persistWorkbook() {
  const id = props.workbookId;
  if (!id || isHydrating.value) return;
  syncLangsIntoTranslationSections();
  if (saveAbort) saveAbort.abort();
  saveAbort = new AbortController();
  const signal = saveAbort.signal;
  try {
    const res = await fetch(`${API_BASE}/api/workbooks/${id}`, {
      method: "PATCH",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sections: sections.value,
        sourceLang: sourceLang.value,
        targetLang: targetLang.value,
      }),
    });
    if (!res.ok) return;
    if (id !== props.workbookId) return;
    emit("saved");
  } catch (e) {
    if (e.name === "AbortError") return;
  }
}

watch(
  () => sections.value,
  () => {
    if (!isHydrating.value) {
      emit("meta", { title: workbookTitleFromSections(sections.value) });
    }
    schedulePersist();
  },
  { deep: true },
);

function addSection(kind) {
  sections.value.push(newSection(kind));
}

function isPinnedFirst(idx) {
  return idx === 0;
}

function removeSection(idx) {
  if (sections.value.length <= 1) return;
  if (isPinnedFirst(idx)) return;
  sections.value.splice(idx, 1);
}

const dragFrom = ref(null);
const dragOverIdx = ref(null);

function onDragStart(e, idx) {
  if (isPinnedFirst(idx)) {
    e.preventDefault();
    return;
  }
  dragFrom.value = idx;
  dragOverIdx.value = null;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", String(idx));
}

function onDragEnd() {
  dragFrom.value = null;
  dragOverIdx.value = null;
}

function onDragOver(idx) {
  if (dragFrom.value === null) return;
  dragOverIdx.value = idx;
}

function onDrop(toIdx) {
  const from = dragFrom.value;
  dragFrom.value = null;
  dragOverIdx.value = null;
  if (from === null || from === toIdx) return;
  if (isPinnedFirst(from)) return;
  const list = [...sections.value];
  const [moved] = list.splice(from, 1);
  let insert = toIdx;
  if (insert === 0) {
    insert = 1;
  }
  list.splice(insert, 0, moved);
  sections.value = list;
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
    <div class="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-4 p-4">
      <p
        v-if="loadError"
        class="shrink-0 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
      >
        {{ loadError }}
      </p>

      <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        <div
          v-for="(sec, idx) in sections"
          :key="sec.id"
          class="flex items-start gap-2 rounded-lg transition-colors"
          :class="
            dragOverIdx === idx && dragFrom !== null && dragFrom !== idx
              ? 'bg-indigo-50/90 ring-1 ring-indigo-200 dark:bg-indigo-950/40 dark:ring-indigo-800'
              : ''
          "
          @dragover.prevent="onDragOver(idx)"
          @drop.prevent="onDrop(idx)"
        >
          <div class="flex shrink-0 flex-col items-center gap-1.5 pt-2">
            <span
              role="button"
              tabindex="0"
              :aria-label="
                isPinnedFirst(idx) ? 'Primary header — order is fixed' : 'Drag to reorder section'
              "
              :draggable="!isPinnedFirst(idx)"
              class="flex size-8 shrink-0 touch-none select-none items-center justify-center rounded-md text-zinc-400 dark:text-zinc-500"
              :class="
                isPinnedFirst(idx)
                  ? 'cursor-default opacity-40'
                  : 'cursor-grab hover:text-zinc-600 active:cursor-grabbing dark:hover:text-zinc-400'
              "
              @dragstart="onDragStart($event, idx)"
              @dragend="onDragEnd"
            >
              <svg
                class="size-5 shrink-0"
                viewBox="0 0 8 20"
                fill="currentColor"
                preserveAspectRatio="xMidYMid meet"
                aria-hidden="true"
              >
                <circle cx="2" cy="4" r="1.5" />
                <circle cx="6" cy="4" r="1.5" />
                <circle cx="2" cy="10" r="1.5" />
                <circle cx="6" cy="10" r="1.5" />
                <circle cx="2" cy="16" r="1.5" />
                <circle cx="6" cy="16" r="1.5" />
              </svg>
            </span>
            <button
              v-if="sections.length > 1 && !isPinnedFirst(idx)"
              type="button"
              class="flex size-8 shrink-0 items-center justify-center rounded-md p-0 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800 dark:hover:text-red-400"
              aria-label="Remove section"
              @click="removeSection(idx)"
            >
              <TrashIcon class="size-4 shrink-0" aria-hidden="true" />
            </button>
          </div>
          <div class="min-w-0 flex-1">
            <HeaderSection v-if="sec.type === 'header'" v-model="sections[idx]" />
            <VocabularySection v-else-if="sec.type === 'vocabulary'" v-model="sections[idx]" />
            <TranslationSection
              v-else-if="sec.type === 'translation'"
              v-model="sections[idx]"
              :source-lang="sourceLang"
              :target-lang="targetLang"
            />
            <SimpleTextSection v-else v-model="sections[idx]" />
          </div>
        </div>
      </div>

      <div
        class="flex shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-2 border-t border-zinc-200 pt-4 dark:border-zinc-800"
      >
        <span class="text-xs font-medium text-zinc-500">Add section:</span>
        <button
          type="button"
          class="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          @click="addSection('translation')"
        >
          Translation
        </button>
        <button
          type="button"
          class="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          @click="addSection('header')"
        >
          Header
        </button>
        <button
          type="button"
          class="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          @click="addSection('vocabulary')"
        >
          Vocabulary
        </button>
        <button
          type="button"
          class="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          @click="addSection('grammar')"
        >
          Grammar
        </button>
      </div>
    </div>
  </div>
</template>
