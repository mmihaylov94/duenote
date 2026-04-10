<script setup>
import { ref, watch, onUnmounted, nextTick } from "vue";
import {
  BookmarkIcon as BookmarkSolid,
  TrashIcon,
} from "@heroicons/vue/20/solid";
import {
  BookmarkIcon as BookmarkOutline,
  Bars3Icon,
} from "@heroicons/vue/24/outline";
import TranslationSection from "./TranslationSection.vue";
import HeaderSection from "./HeaderSection.vue";
import VocabularySection from "./VocabularySection.vue";
import SimpleTextSection from "./SimpleTextSection.vue";
import SelectionActionsFloater from "./SelectionActionsFloater.vue";
import VideoSection from "./VideoSection.vue";
import DocumentSection from "./DocumentSection.vue";
import { apiFetch } from "../api/client.js";

const props = defineProps({
  workbookId: { type: Number, required: true },
  courseId: { type: Number, default: null },
  pinnedSectionIds: { type: Array, default: () => [] },
  pendingSectionScrollId: { type: String, default: null },
  /** When true, show the quick-access column (same scroll context as sections). */
  quickAccessEnabled: { type: Boolean, default: false },
});

const emit = defineEmits([
  "loaded",
  "saved",
  "meta",
  "pending-scroll-done",
  "pin-click",
  "vocabulary-changed",
]);

const sourceLang = defineModel("sourceLang", { type: String, default: "EN" });
const targetLang = defineModel("targetLang", { type: String, default: "DE" });

const sections = ref([]);
const loadError = ref("");
const isHydrating = ref(false);
let loadAbort = null;
let saveAbort = null;
let saveTimer = null;

const SAVE_DEBOUNCE_MS = 1000;

const videoUrlModalOpen = ref(false);
const videoUrlDraft = ref("");
const videoUrlError = ref("");

const documentModalOpen = ref(false);
const documentModalError = ref("");
const pdfMaterials = ref([]);
const pdfMaterialIdDraft = ref("");
const pdfPagesFromDraft = ref("");
const pdfPagesToDraft = ref("");
const pdfPageCount = ref(null);
const pdfPageCountLoading = ref(false);
const pdfPageCountError = ref("");

function normalizeUrl(s) {
  let v = String(s ?? "").trim();
  if (!v) return "";
  if (/^www\./i.test(v)) v = `https://${v}`;
  if (!/^https?:\/\//i.test(v)) return v;
  try {
    return new URL(v).toString();
  } catch {
    return v;
  }
}

function isValidYouTubeUrl(raw) {
  const u = normalizeUrl(raw);
  if (!u || !/^https?:\/\//i.test(u)) return false;
  let url;
  try {
    url = new URL(u);
  } catch {
    return false;
  }
  const host = url.hostname.replace(/^www\./i, "").toLowerCase();
  if (host === "youtu.be") return Boolean(url.pathname.replace(/^\//, ""));
  if (host === "youtube.com" || host === "m.youtube.com") {
    if (url.pathname === "/watch") return Boolean(url.searchParams.get("v"));
    if (url.pathname.startsWith("/embed/"))
      return Boolean(url.pathname.split("/")[2]);
    if (url.pathname.startsWith("/shorts/"))
      return Boolean(url.pathname.split("/")[2]);
  }
  return false;
}

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
      entryIds: [],
    };
  }
  if (kind === "video") {
    return {
      id,
      type: "video",
      url: "",
    };
  }
  if (kind === "document") {
    return {
      id,
      type: "document",
      materialId: null,
      materialTitle: "",
      pagesFrom: null,
      pagesTo: null,
      viewMode: "spread",
      notes: [],
      drawings: [],
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
      const ids = Array.isArray(s.entryIds)
        ? s.entryIds.map((x) => Number(x)).filter((x) => Number.isFinite(x))
        : [];
      return {
        id,
        type: "vocabulary",
        entryIds: ids,
      };
    }
    if (s.type === "video") {
      return {
        id,
        type: "video",
        url: typeof s.url === "string" ? s.url : "",
      };
    }
    if (s.type === "document") {
      const materialId = s.materialId != null ? Number(s.materialId) : null;
      const materialTitle =
        typeof s.materialTitle === "string" ? s.materialTitle : "";
      const pagesFrom = s.pagesFrom != null ? Number(s.pagesFrom) : null;
      const pagesTo = s.pagesTo != null ? Number(s.pagesTo) : null;
      const viewModeRaw = typeof s.viewMode === "string" ? s.viewMode : "";
      const viewMode = viewModeRaw === "single" ? "single" : "spread";
      const notes = Array.isArray(s.notes) ? s.notes : [];
      const drawings = Array.isArray(s.drawings) ? s.drawings : [];
      return {
        id,
        type: "document",
        materialId: Number.isFinite(materialId) ? materialId : null,
        materialTitle,
        pagesFrom: Number.isFinite(pagesFrom) ? pagesFrom : null,
        pagesTo: Number.isFinite(pagesTo) ? pagesTo : null,
        viewMode,
        notes: notes
          .filter((n) => n && typeof n === "object")
          .map((n) => ({
            id: n.id || crypto.randomUUID(),
            page: Number.isFinite(Number(n.page)) ? Number(n.page) : 1,
            x: Number.isFinite(Number(n.x)) ? Number(n.x) : 0.1,
            y: Number.isFinite(Number(n.y)) ? Number(n.y) : 0.1,
            text: typeof n.text === "string" ? n.text : "",
            fontSizePct: Number.isFinite(Number(n.fontSizePct))
              ? Number(n.fontSizePct)
              : 2.3,
            color: n.color === "light" ? "light" : "black",
          })),
        drawings: drawings
          .filter((d) => d && typeof d === "object")
          .map((d) => ({
            id: d.id || crypto.randomUUID(),
            page: Number.isFinite(Number(d.page)) ? Number(d.page) : 1,
            tool: d.tool === "highlighter" ? "highlighter" : "pen",
            color: d.color === "light" ? "light" : "black",
            sizePct: Number.isFinite(Number(d.sizePct))
              ? Number(d.sizePct)
              : 0.35,
            x: Number.isFinite(Number(d.x)) ? Number(d.x) : 0,
            y: Number.isFinite(Number(d.y)) ? Number(d.y) : 0,
            points: Array.isArray(d.points)
              ? d.points
                  .filter((p) => p && typeof p === "object")
                  .map((p) => ({
                    x: Number.isFinite(Number(p.x)) ? Number(p.x) : 0,
                    y: Number.isFinite(Number(p.y)) ? Number(p.y) : 0,
                  }))
              : [],
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
    const res = await apiFetch(`/api/workbooks/${id}`, { signal });
    if (!res.ok) throw new Error("Failed to load workbook");
    const w = await res.json();
    if (id !== props.workbookId) return;
    sourceLang.value = w.sourceLang ?? "EN";
    targetLang.value = w.targetLang ?? "DE";
    const raw = Array.isArray(w.sections) ? w.sections : [];
    sections.value = ensureSectionShape(
      raw.length ? raw : [newSection("header")],
    );
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

function isSectionPinned(sectionId) {
  const s = String(sectionId ?? "");
  return props.pinnedSectionIds.some((id) => String(id) === s);
}

function onPinButtonClick(sectionId) {
  emit("pin-click", {
    sectionId: String(sectionId),
    isPinned: isSectionPinned(sectionId),
  });
}

async function tryPendingScroll() {
  const id = props.pendingSectionScrollId;
  if (!id) return;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await nextTick();
    const el = document.querySelector(`[data-section-id="${CSS.escape(id)}"]`);
    if (el) {
      el.scrollIntoView({ block: "start", behavior: "smooth" });
      emit("pending-scroll-done", { found: true });
      return;
    }
    await new Promise((r) => requestAnimationFrame(r));
  }
  emit("pending-scroll-done", { found: false });
}

watch(
  () => [
    props.pendingSectionScrollId,
    sections.value.map((s) => s.id).join(","),
  ],
  () => {
    tryPendingScroll();
  },
);

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
    const res = await apiFetch(`/api/workbooks/${id}`, {
      method: "PATCH",
      signal,
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

/** Save immediately (e.g. before deleting a vocabulary entry that must be unreferenced in DB) */
async function flushPersist() {
  if (isHydrating.value) return;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  await persistWorkbook();
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

function openVideoUrlModal() {
  videoUrlError.value = "";
  videoUrlDraft.value = "";
  videoUrlModalOpen.value = true;
}

function closeVideoUrlModal() {
  videoUrlModalOpen.value = false;
  videoUrlError.value = "";
  videoUrlDraft.value = "";
}

function confirmVideoUrl() {
  const cleaned = normalizeUrl(videoUrlDraft.value);
  if (!isValidYouTubeUrl(cleaned)) {
    videoUrlError.value =
      "Paste a valid YouTube URL (watch, shorts, youtu.be, or embed).";
    return;
  }
  const sec = newSection("video");
  sec.url = cleaned;
  sections.value = [...sections.value, sec];
  closeVideoUrlModal();
}

async function openDocumentModal() {
  documentModalError.value = "";
  pdfPageCount.value = null;
  pdfPageCountLoading.value = false;
  pdfPageCountError.value = "";
  pdfMaterials.value = [];
  pdfMaterialIdDraft.value = "";
  pdfPagesFromDraft.value = "";
  pdfPagesToDraft.value = "";

  const cid = props.courseId;
  if (cid == null) {
    documentModalError.value = "Documents require a course context.";
    documentModalOpen.value = true;
    return;
  }

  documentModalOpen.value = true;
  try {
    const r = await apiFetch(`/api/courses/${cid}/materials`);
    if (!r.ok) {
      documentModalError.value = `Could not load materials (HTTP ${r.status}).`;
      return;
    }
    const data = await r.json();
    const list = Array.isArray(data.materials) ? data.materials : [];
    pdfMaterials.value = list.filter(
      (m) =>
        String(m.mimeType || "")
          .toLowerCase()
          .includes("pdf") ||
        String(m.title || "")
          .toLowerCase()
          .endsWith(".pdf"),
    );
    // Default to first PDF if present so we can show page count.
    if (pdfMaterials.value.length && !pdfMaterialIdDraft.value) {
      pdfMaterialIdDraft.value = String(pdfMaterials.value[0].id);
    }
  } catch {
    documentModalError.value = "Cannot reach the API.";
  }
}

function closeDocumentModal() {
  if (!documentModalOpen.value) return;
  documentModalOpen.value = false;
  documentModalError.value = "";
  pdfPageCount.value = null;
  pdfPageCountLoading.value = false;
  pdfPageCountError.value = "";
  pdfMaterialIdDraft.value = "";
  pdfPagesFromDraft.value = "";
  pdfPagesToDraft.value = "";
  pdfMaterials.value = [];
}

async function loadPdfPageCount() {
  pdfPageCount.value = null;
  pdfPageCountError.value = "";
  const cid = props.courseId;
  const mid = Number(pdfMaterialIdDraft.value);
  if (cid == null || !Number.isFinite(mid) || mid <= 0) return;
  pdfPageCountLoading.value = true;
  try {
    const r = await apiFetch(`/api/courses/${cid}/materials/${mid}/meta`);
    if (!r.ok) {
      let detail = `HTTP ${r.status}`;
      try {
        const j = await r.json();
        if (j?.error) detail = String(j.error);
      } catch {
        /* ignore */
      }
      pdfPageCountError.value = `Could not load PDF info (${detail}).`;
      return;
    }
    const j = await r.json();
    const n = Number(j?.pageCount);
    pdfPageCount.value = Number.isFinite(n) && n > 0 ? n : null;
    if (pdfPageCount.value == null) {
      pdfPageCountError.value = "Could not read PDF page count.";
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    pdfPageCountError.value = msg ? `Could not read PDF page count: ${msg}` : "Could not read PDF page count.";
  } finally {
    pdfPageCountLoading.value = false;
  }
}

watch(
  () => [documentModalOpen.value, props.courseId, pdfMaterialIdDraft.value],
  ([open]) => {
    if (!open) return;
    loadPdfPageCount();
  },
);

function confirmDocument() {
  const cid = props.courseId;
  if (cid == null) {
    documentModalError.value = "Documents require a course context.";
    return;
  }
  const mid = Number(pdfMaterialIdDraft.value);
  if (!Number.isFinite(mid) || mid <= 0) {
    documentModalError.value = "Choose a PDF material.";
    return;
  }
  const pageCount = pdfPageCount.value != null ? Number(pdfPageCount.value) : null;
  if (pageCount == null) {
    documentModalError.value = pdfPageCountLoading.value
      ? "Loading page count…"
      : pdfPageCountError.value || "Could not determine PDF page count.";
    return;
  }
  const fromRaw = pdfPagesFromDraft.value.trim();
  const toRaw = pdfPagesToDraft.value.trim();
  const from = fromRaw ? Number(fromRaw) : null;
  const to = toRaw ? Number(toRaw) : null;
  if (
    (from != null && (!Number.isFinite(from) || from <= 0)) ||
    (to != null && (!Number.isFinite(to) || to <= 0))
  ) {
    documentModalError.value = "Pages must be positive numbers.";
    return;
  }
  if ((from != null && from > pageCount) || (to != null && to > pageCount)) {
    documentModalError.value = `Page range must be within 1-${pageCount}.`;
    return;
  }
  if (from != null && to != null && to < from) {
    documentModalError.value = "Page to must be ≥ page from.";
    return;
  }

  const sec = newSection("document");
  sec.materialId = mid;
  // If only one bound is provided, treat it as a single-page view.
  if (from != null && to == null) {
    sec.pagesFrom = from;
    sec.pagesTo = from;
  } else if (to != null && from == null) {
    sec.pagesFrom = to;
    sec.pagesTo = to;
  } else {
    sec.pagesFrom = from;
    sec.pagesTo = to;
  }
  const picked = pdfMaterials.value.find((m) => Number(m.id) === mid);
  sec.materialTitle = picked?.title ? String(picked.title) : "";
  sections.value = [...sections.value, sec];
  closeDocumentModal();
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

async function addSelectionToVocabulary(word, meaning) {
  const cid = props.courseId;
  if (!cid || !word) return;
  const r = await apiFetch(`/api/courses/${cid}/vocabulary-entries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ word, meaning }),
  });
  if (!r.ok) return;
  const data = await r.json();
  const id = Number(data.id);
  if (!Number.isFinite(id)) return;

  let vIdx = sections.value.findIndex((s) => s.type === "vocabulary");
  if (vIdx === -1) {
    sections.value.push(newSection("vocabulary"));
    vIdx = sections.value.length - 1;
  }
  const sec = sections.value[vIdx];
  if (!Array.isArray(sec.entryIds)) sec.entryIds = [];
  if (sec.entryIds.includes(id)) return;
  sec.entryIds.push(id);
  emit("vocabulary-changed");
}
</script>

<template>
  <div
    class="w-full min-w-0 bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100"
  >
    <div
      class="sr-only"
      data-dictionary-host
      :data-tts-source-lang="sourceLang"
      :data-tts-target-lang="targetLang"
      aria-hidden="true"
    />
    <div
      v-if="videoUrlModalOpen"
      class="fixed inset-0 z-103 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Add video"
      @click.self="closeVideoUrlModal"
    >
      <div
        class="w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        @click.stop
      >
        <h2
          class="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
        >
          Add video
        </h2>
        <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Paste a YouTube link.
        </p>

        <div class="mt-4">
          <label class="text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >Video URL</label
          >
          <input
            v-model="videoUrlDraft"
            type="url"
            class="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
            placeholder="https://www.youtube.com/watch?v=…"
            autocomplete="off"
            @keydown.enter.prevent="confirmVideoUrl"
          />
          <p
            v-if="videoUrlError"
            class="mt-2 text-sm text-red-600 dark:text-red-400"
          >
            {{ videoUrlError }}
          </p>
        </div>

        <div class="mt-5 flex justify-end gap-2">
          <button
            type="button"
            class="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            @click="closeVideoUrlModal"
          >
            Cancel
          </button>
          <button
            type="button"
            class="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500"
            @click="confirmVideoUrl"
          >
            Add video
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="documentModalOpen"
      class="fixed inset-0 z-103 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Add document"
      @click.self="closeDocumentModal"
    >
      <div
        class="w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        @click.stop
      >
        <h2
          class="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
        >
          Add document
        </h2>
        <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Choose a PDF from course materials and optionally limit the page
          range.
        </p>

        <div class="mt-4">
          <label class="text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >PDF material</label
          >
          <select
            v-model="pdfMaterialIdDraft"
            class="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
          >
            <option value="">Select a PDF…</option>
            <option v-for="m in pdfMaterials" :key="m.id" :value="String(m.id)">
              {{ m.title || `PDF #${m.id}` }}
            </option>
          </select>
          <p v-if="pdfPageCountLoading" class="mt-2 text-sm text-zinc-500 dark:text-zinc-400">Reading pages…</p>
          <p v-else-if="pdfPageCountError" class="mt-2 text-sm text-red-600 dark:text-red-400">
            {{ pdfPageCountError }}
          </p>
          <p
            v-if="!documentModalError && pdfMaterials.length === 0"
            class="mt-2 text-sm text-zinc-500 dark:text-zinc-400"
          >
            No PDFs found in this course’s Materials yet.
          </p>
        </div>

        <div class="mt-4 grid grid-cols-2 gap-3">
          <div>
            <label class="text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >Page from</label
            >
            <input
              v-model="pdfPagesFromDraft"
              type="text"
              inputmode="numeric"
              placeholder="1"
              class="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
              @keydown.enter.prevent="confirmDocument"
            />
          </div>
          <div>
            <label class="text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >Page to</label
            >
            <input
              v-model="pdfPagesToDraft"
              type="text"
              inputmode="numeric"
              :placeholder="pdfPageCount != null ? String(pdfPageCount) : ''"
              class="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
              @keydown.enter.prevent="confirmDocument"
            />
          </div>
        </div>

        <p
          v-if="documentModalError"
          class="mt-3 text-sm text-red-600 dark:text-red-400"
        >
          {{ documentModalError }}
        </p>

        <div class="mt-5 flex justify-end gap-2">
          <button
            type="button"
            class="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            @click="closeDocumentModal"
          >
            Cancel
          </button>
          <button
            type="button"
            class="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="pdfPageCountLoading || pdfPageCount == null"
            @click="confirmDocument"
          >
            Add document
          </button>
        </div>
      </div>
    </div>

    <div
      class="flex w-full flex-col gap-4 lg:flex-row lg:items-stretch lg:gap-6"
    >
      <div class="flex min-w-0 flex-1 flex-col gap-4 px-4 pb-4 pt-4 lg:pr-0">
        <div class="mx-auto w-full max-w-6xl">
          <p
            v-if="loadError"
            class="shrink-0 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
          >
            {{ loadError }}
          </p>

          <div class="flex flex-col gap-4">
            <div
              v-for="(sec, idx) in sections"
              :key="sec.id"
              :data-section-id="sec.id"
              class="scroll-mt-4 flex items-start gap-2 rounded-lg transition-colors"
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
                  v-if="!(idx === 0 && sec.type === 'header')"
                  role="button"
                  tabindex="0"
                  :aria-label="
                    isPinnedFirst(idx)
                      ? 'Primary header - order is fixed'
                      : 'Drag to reorder section'
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
                  <Bars3Icon class="size-5 shrink-0" aria-hidden="true" />
                </span>
                <div v-else class="size-8 shrink-0" aria-hidden="true" />
                <button
                  v-if="courseId != null && sec.type !== 'header'"
                  type="button"
                  class="flex size-8 shrink-0 items-center justify-center rounded-md p-0 text-zinc-400 hover:bg-zinc-100 hover:text-indigo-600 dark:hover:bg-zinc-800 dark:hover:text-indigo-400"
                  :aria-label="
                    isSectionPinned(sec.id)
                      ? 'Remove from quick access'
                      : 'Add to quick access'
                  "
                  :title="
                    isSectionPinned(sec.id)
                      ? 'Remove from quick access'
                      : 'Add to quick access'
                  "
                  @click="onPinButtonClick(sec.id)"
                >
                  <BookmarkSolid
                    v-if="isSectionPinned(sec.id)"
                    class="size-4 shrink-0 text-indigo-600 dark:text-indigo-400"
                    aria-hidden="true"
                  />
                  <BookmarkOutline
                    v-else
                    class="size-4 shrink-0"
                    aria-hidden="true"
                  />
                </button>
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
                <HeaderSection
                  v-if="sec.type === 'header'"
                  v-model="sections[idx]"
                />
                <VocabularySection
                  v-else-if="sec.type === 'vocabulary' && courseId != null"
                  v-model="sections[idx]"
                  :course-id="courseId"
                  :source-lang="sourceLang"
                  :target-lang="targetLang"
                  :all-sections="sections"
                  :persist-workbook="flushPersist"
                  :on-vocabulary-changed="() => emit('vocabulary-changed')"
                />
                <p
                  v-else-if="sec.type === 'vocabulary'"
                  class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
                >
                  Vocabulary requires a course context.
                </p>
                <TranslationSection
                  v-else-if="sec.type === 'translation'"
                  v-model="sections[idx]"
                  :source-lang="sourceLang"
                  :target-lang="targetLang"
                />
                <VideoSection
                  v-else-if="sec.type === 'video'"
                  v-model="sections[idx]"
                />
                <DocumentSection
                  v-else-if="sec.type === 'document'"
                  v-model="sections[idx]"
                  :course-id="courseId"
                />
                <SimpleTextSection v-else v-model="sections[idx]" />
              </div>
            </div>
          </div>

          <SelectionActionsFloater
            :course-id="courseId"
            :source-lang="sourceLang"
            :target-lang="targetLang"
            :add-entry="addSelectionToVocabulary"
            :default-lang="sourceLang"
          />

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
              @click="openVideoUrlModal"
            >
              Video
            </button>
            <button
              type="button"
              class="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              @click="openDocumentModal"
            >
              Document
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

      <aside
        v-if="quickAccessEnabled"
        class="flex min-h-0 w-full shrink-0 flex-col border-t border-zinc-200 px-4 pb-4 pt-4 dark:border-zinc-800 lg:sticky lg:top-0 lg:z-10 lg:h-[calc(var(--workbook-scroll-h))] lg:max-h-[calc(var(--workbook-scroll-h))] lg:w-[min(18rem,calc(100%-1rem))] lg:min-h-0 lg:shrink-0 lg:overflow-hidden lg:self-start lg:border-t-0 lg:px-0 lg:pb-4 lg:pt-4 lg:pl-0 lg:pr-3"
        aria-label="Quick access and vocabulary"
      >
        <div class="flex h-full min-h-0 flex-1 flex-col gap-2">
          <div class="flex min-h-0 flex-1 basis-0 flex-col overflow-hidden">
            <slot name="quick-access" />
          </div>
          <div class="flex min-h-0 flex-1 basis-0 flex-col overflow-hidden">
            <slot name="course-vocabulary" />
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>
