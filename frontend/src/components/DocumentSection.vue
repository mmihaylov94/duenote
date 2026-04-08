<script setup>
import { ref, watch, computed, onUnmounted, onMounted, nextTick } from "vue";
import { apiFetch } from "../api/client.js";
// Custom icons used for page view toggle.

import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const props = defineProps({
  courseId: { type: Number, default: null },
});

const section = defineModel({ type: Object, required: true });

const loading = ref(false);
const error = ref("");
const numPages = ref(null);
const renderedPages = ref([]);
/** Selected note (move mode) */
const selectedNoteId = ref(null);
/** Note currently being edited (text mode) */
const editingNoteId = ref(null);
const annotateEnabled = ref(false);

/** @type {Map<string, HTMLInputElement>} */
const noteInputEls = new Map();
/** @type {Map<number, HTMLElement>} */
const pageEls = new Map();
/** @type {Map<number, ResizeObserver>} */
const pageResizeObservers = new Map();
const drag = ref(null);

function setNoteInputEl(id, el) {
  if (!id) return;
  if (el) {
    noteInputEls.set(id, el);
    autosizeTextarea(el);
  } else {
    noteInputEls.delete(id);
  }
}

function setPageEl(pageNumber, el) {
  const p = Number(pageNumber);
  if (!Number.isFinite(p)) return;
  if (el) {
    pageEls.set(p, el);
    const ro = new ResizeObserver((entries) => {
      const entry = entries?.[0];
      const w = entry?.contentRect?.width;
      if (!Number.isFinite(w) || w <= 0) return;
      // Used to scale note font sizes relative to the page size.
      el.style.setProperty("--page-w", `${w}px`);
    });
    ro.observe(el);
    pageResizeObservers.set(p, ro);
    // Initialize immediately (in case ResizeObserver is slow to fire).
    const w0 = el.getBoundingClientRect?.().width;
    if (Number.isFinite(w0) && w0 > 0) el.style.setProperty("--page-w", `${w0}px`);
  } else {
    const ro = pageResizeObservers.get(p);
    if (ro) {
      try {
        ro.disconnect();
      } catch {
        /* ignore */
      }
    }
    pageResizeObservers.delete(p);
    pageEls.delete(p);
  }
}

function getPageElForNote(note) {
  const p = Number(note?.page);
  if (!Number.isFinite(p)) return null;
  return pageEls.get(p) || null;
}

function suppressSyntheticClickOnce() {
  // After a drag ends, browsers often emit a synthetic click.
  // We capture and cancel the very next click so it doesn't create a new note.
  const onClickCapture = (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Best effort; not all browsers allow this.
    try {
      e.stopImmediatePropagation();
    } catch {
      /* ignore */
    }
    window.removeEventListener("click", onClickCapture, true);
  };
  window.addEventListener("click", onClickCapture, true);
}

async function focusNote(id) {
  if (!id) return;
  await nextTick();
  requestAnimationFrame(() => {
    const el = noteInputEls.get(id);
    if (el) {
      el.focus();
      // Place caret at end for fast typing.
      const len = el.value?.length ?? 0;
      try {
        el.setSelectionRange(len, len);
      } catch {
        /* ignore */
      }
    }
  });
}

let cancelled = false;

const hasPdf = computed(() => Number.isFinite(Number(section.value?.materialId)));
const notes = computed(() => (Array.isArray(section.value?.notes) ? section.value.notes : []));
const docTitle = computed(() => {
  const t = typeof section.value?.materialTitle === "string" ? section.value.materialTitle.trim() : "";
  const id = section.value?.materialId;
  if (t) return t;
  if (Number.isFinite(Number(id))) return `PDF #${Number(id)}`;
  return "Document";
});

async function ensureMaterialTitle() {
  const cid = Number(props.courseId);
  const mid = Number(section.value?.materialId);
  const existing = typeof section.value?.materialTitle === "string" ? section.value.materialTitle.trim() : "";
  if (existing) return;
  if (!Number.isFinite(cid) || cid <= 0) return;
  if (!Number.isFinite(mid) || mid <= 0) return;
  try {
    const r = await apiFetch(`/api/courses/${cid}/materials`);
    if (!r.ok) return;
    const data = await r.json();
    const list = Array.isArray(data.materials) ? data.materials : [];
    const found = list.find((m) => Number(m.id) === mid);
    const title = found?.title ? String(found.title).trim() : "";
    if (title) section.value.materialTitle = title;
  } catch {
    /* ignore */
  }
}

const pageRangeLabel = computed(() => {
  const from = section.value?.pagesFrom != null ? Number(section.value.pagesFrom) : null;
  const to = section.value?.pagesTo != null ? Number(section.value.pagesTo) : null;
  const fromOk = Number.isFinite(from) && from > 0;
  const toOk = Number.isFinite(to) && to > 0;
  if (!fromOk && !toOk) return "[all]";
  const start = fromOk ? from : to;
  const end = toOk ? to : from;
  if (start === end) return `[${start}]`;
  return `[${start}-${end}]`;
});

const availablePages = computed(() => {
  const total = numPages.value;
  if (!Number.isFinite(total) || total <= 0) return [];
  return pageRangeToRender(total);
});

const activeIdx = ref(0);
const activePageNumber = computed(() => availablePages.value[activeIdx.value] ?? null);
const activePageNumbersLabel = computed(() => {
  const list = availablePages.value;
  if (!list.length) return "-";
  const p1 = list[activeIdx.value];
  const p2 = list[activeIdx.value + 1] ?? null;
  if (Number.isFinite(p1) && Number.isFinite(p2)) return `${p1}-${p2}`;
  if (Number.isFinite(p1)) return String(p1);
  return "-";
});

const viewMode = computed(() => (section.value?.viewMode === "single" ? "single" : "spread"));
const stepSize = computed(() => (viewMode.value === "single" ? 1 : 2));

let pdfDoc = null;
let lastRenderedKey = "";
const singleScrollerEl = ref(null);

let scrollCooldownId = null;
let lastScrollTop = 0;
function maybeFlipPageFromSingleScroll(direction) {
  if (viewMode.value !== "single") return;
  if (scrollCooldownId != null) return;
  const el = singleScrollerEl.value;
  if (!el) return;
  const atTop = el.scrollTop <= 0;
  const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
  if (direction > 0 && atBottom) {
    scrollCooldownId = window.setTimeout(() => (scrollCooldownId = null), 200);
    goNext();
    nextTick(() => {
      const s = singleScrollerEl.value;
      if (s) s.scrollTop = 0;
    });
  } else if (direction < 0 && atTop) {
    scrollCooldownId = window.setTimeout(() => (scrollCooldownId = null), 200);
    goPrev();
    nextTick(() => {
      const s = singleScrollerEl.value;
      if (s) s.scrollTop = 0;
    });
  }
}

function onSingleScroll() {
  if (viewMode.value !== "single") return;
  const el = singleScrollerEl.value;
  if (!el) return;
  const dir = el.scrollTop > lastScrollTop ? 1 : el.scrollTop < lastScrollTop ? -1 : 0;
  lastScrollTop = el.scrollTop;
  if (dir) maybeFlipPageFromSingleScroll(dir);
}

function onSingleWheel(e) {
  if (viewMode.value !== "single") return;
  const el = singleScrollerEl.value;
  if (!el) return;
  const atTop = el.scrollTop <= 0;
  const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
  if ((e.deltaY > 0 && atBottom) || (e.deltaY < 0 && atTop)) {
    e.preventDefault();
    maybeFlipPageFromSingleScroll(e.deltaY > 0 ? 1 : -1);
  }
}

function ensureNotesArray() {
  if (!Array.isArray(section.value.notes)) section.value.notes = [];
}

function clamp01(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function addNoteAt(pageNumber, xNorm, yNorm) {
  ensureNotesArray();
  const id = crypto.randomUUID();
  const note = {
    id,
    page: pageNumber,
    x: clamp01(xNorm, 0.1),
    y: clamp01(yNorm, 0.1),
    text: "",
    // Store as percentage of page width so it scales between single/spread view.
    // 16px at ~700px page width ≈ 2.3%.
    fontSizePct: 2.3,
    color: "black",
  };
  section.value.notes.push(note);
  selectedNoteId.value = id;
  editingNoteId.value = id; // new notes start in text mode
  focusNote(id);
}

function removeNote(id) {
  ensureNotesArray();
  section.value.notes = section.value.notes.filter((n) => n.id !== id);
  if (selectedNoteId.value === id) selectedNoteId.value = null;
  if (editingNoteId.value === id) editingNoteId.value = null;
}

function beginNoteDragCandidate(e, note) {
  if (!annotateEnabled.value) return;
  if (!note?.id) return;
  // Only drag notes that are not currently being edited.
  if (editingNoteId.value === note.id) return;

  const pageEl = getPageElForNote(note);
  const box = pageEl?.getBoundingClientRect?.();
  if (!box || !box.width || !box.height) return;

  selectedNoteId.value = note.id;
  drag.value = {
    id: note.id,
    box,
    startClientX: e.clientX,
    startClientY: e.clientY,
    startX: clamp01(note.x, 0.1),
    startY: clamp01(note.y, 0.1),
    moved: false,
  };

  window.addEventListener("pointermove", onNoteDragMove, true);
  window.addEventListener("pointerup", endNoteDrag, true);
  window.addEventListener("pointercancel", endNoteDrag, true);
}

function onNoteDragMove(e) {
  const d = drag.value;
  if (!d) return;
  const list = Array.isArray(section.value?.notes) ? section.value.notes : [];
  const n = list.find((x) => x?.id === d.id);
  if (!n) return;

  const dxPx = e.clientX - d.startClientX;
  const dyPx = e.clientY - d.startClientY;
  const dist2 = dxPx * dxPx + dyPx * dyPx;

  // Only start dragging after a small movement threshold so a normal click can edit.
  if (!d.moved && dist2 < 16) return; // 4px
  if (!d.moved) {
    d.moved = true;
    selectedNoteId.value = d.id;
    editingNoteId.value = null;
    // Ensure we don't end up in edit mode on mouseup.
    try {
      document.activeElement?.blur?.();
    } catch {
      /* ignore */
    }
  }

  const dx = dxPx / d.box.width;
  const dy = dyPx / d.box.height;
  n.x = clamp01(d.startX + dx, 0);
  n.y = clamp01(d.startY + dy, 0);
  e.preventDefault();
}

function endNoteDrag() {
  const moved = Boolean(drag.value?.moved);
  drag.value = null;
  window.removeEventListener("pointermove", onNoteDragMove, true);
  window.removeEventListener("pointerup", endNoteDrag, true);
  window.removeEventListener("pointercancel", endNoteDrag, true);
  if (moved) suppressSyntheticClickOnce();
}

function noteStyle(n) {
  const t = typeof n.text === "string" ? n.text : "";
  const longestLine = t
    .split("\n")
    .reduce((m, s) => Math.max(m, (typeof s === "string" ? s.length : 0)), 0);
  const ch = Math.max(10, Math.min(90, longestLine + 4));
  return {
    left: `${clamp01(n.x, 0.1) * 100}%`,
    top: `${clamp01(n.y, 0.1) * 100}%`,
    width: `${ch}ch`,
  };
}

function autosizeTextarea(el) {
  if (!el) return;
  // On first mount (especially for empty notes) scrollHeight can be wrong until layout.
  // So we measure on the next frame and enforce at least one visible line.
  requestAnimationFrame(() => {
    if (!el?.isConnected) return;
    const cs = window.getComputedStyle(el);
    const lh = Number.parseFloat(cs.lineHeight);
    const fs = Number.parseFloat(cs.fontSize);
    const lineHeight = Number.isFinite(lh) ? lh : Math.max(12, fs * 1.2);
    const padY = (Number.parseFloat(cs.paddingTop) || 0) + (Number.parseFloat(cs.paddingBottom) || 0);
    const borderY =
      (Number.parseFloat(cs.borderTopWidth) || 0) + (Number.parseFloat(cs.borderBottomWidth) || 0);
    const minH = Math.ceil(lineHeight + padY + borderY);

    el.style.height = "0px";
    const target = Math.max(minH, el.scrollHeight || 0);
    el.style.height = `${target}px`;
  });
}

function selectedNote() {
  const id = selectedNoteId.value;
  if (!id) return null;
  const list = Array.isArray(section.value?.notes) ? section.value.notes : [];
  return list.find((n) => n?.id === id) || null;
}

function toggleSelectedColor() {
  const n = selectedNote();
  if (!n) return;
  n.color = n.color === "light" ? "black" : "light";
}

function changeSelectedFontSize(delta) {
  const n = selectedNote();
  if (!n) return;
  const cur = Number.isFinite(Number(n.fontSizePct)) ? Number(n.fontSizePct) : 2.3;
  // delta is in "steps" – translate to percentage points.
  // 0.15% is a small, controllable increment.
  const next = cur + delta * 0.15;
  n.fontSizePct = Math.max(1.0, Math.min(4.0, next));
}

function onPageClick(e, pageNumber) {
  if (!annotateEnabled.value) return;
  // Do not add a new note when clicking an existing note.
  if (e.target instanceof HTMLElement && e.target.closest?.("[data-note]")) return;
  // If a note is currently selected/being edited, a click on the page should
  // only unfocus (exit editing) and NOT create a new note.
  if (selectedNoteId.value || editingNoteId.value) {
    selectedNoteId.value = null;
    editingNoteId.value = null;
    return;
  }
  const box = e.currentTarget?.getBoundingClientRect?.();
  if (!box) return;
  const x = (e.clientX - box.left) / box.width;
  const y = (e.clientY - box.top) / box.height;
  addNoteAt(pageNumber, x, y);
}

function onNoteBlur(note) {
  // When leaving a note, remove it if empty.
  const t = typeof note?.text === "string" ? note.text.trim() : "";
  if (!t) {
    removeNote(note.id);
    // If the blur was caused by a click on the page, that same click would otherwise
    // create a new note immediately after removing this empty one.
    suppressSyntheticClickOnce();
  }
}

function canHandleGlobalKeys() {
  const el = document.activeElement;
  if (!el) return true;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return false;
  if (el.isContentEditable) return false;
  return true;
}

function goToIdx(nextIdx) {
  const list = availablePages.value;
  if (!list.length) return;
  const idx = Math.max(0, Math.min(nextIdx, list.length - 1));
  if (idx === activeIdx.value) return;
  activeIdx.value = idx;
  renderActivePages();
}

function goNext() {
  goToIdx(activeIdx.value + stepSize.value);
}

function goPrev() {
  goToIdx(activeIdx.value - stepSize.value);
}

let wheelCooldownId = null;
function onWheel(e) {
  if (!availablePages.value.length) return;
  if (wheelCooldownId != null) return;
  const dy = e.deltaY;
  if (Math.abs(dy) < 8) return;
  if (dy > 0) goNext();
  else goPrev();
  wheelCooldownId = window.setTimeout(() => {
    wheelCooldownId = null;
  }, 180);
}

function onKeydown(e) {
  // Delete selected note in move mode.
  if (
    annotateEnabled.value &&
    selectedNoteId.value &&
    !editingNoteId.value &&
    (e.key === "Delete" || e.key === "Backspace")
  ) {
    e.preventDefault();
    removeNote(selectedNoteId.value);
    return;
  }
  if (!canHandleGlobalKeys()) return;
  if (e.key === "ArrowRight") {
    e.preventDefault();
    goNext();
  } else if (e.key === "ArrowLeft") {
    e.preventDefault();
    goPrev();
  }
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
});

function pageRangeToRender(total) {
  const from = section.value?.pagesFrom != null ? Number(section.value.pagesFrom) : null;
  const to = section.value?.pagesTo != null ? Number(section.value.pagesTo) : null;
  const fromOk = Number.isFinite(from) && from > 0;
  const toOk = Number.isFinite(to) && to > 0;
  // If only one bound is set, treat it as a single page.
  const start = fromOk ? from : toOk ? to : 1;
  const end = toOk ? to : fromOk ? from : total;
  const a = Math.max(1, Math.min(start, total));
  const b = Math.max(1, Math.min(end, total));
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const pages = [];
  for (let p = lo; p <= hi; p += 1) pages.push(p);
  return pages;
}

async function render() {
  error.value = "";
  renderedPages.value = [];
  numPages.value = null;
  pdfDoc = null;
  lastRenderedKey = "";
  activeIdx.value = 0;

  const materialId = Number(section.value?.materialId);
  if (!Number.isFinite(materialId) || materialId <= 0) return;
  const cid = Number(props.courseId);
  if (!Number.isFinite(cid) || cid <= 0) {
    error.value = "Document requires a course context.";
    return;
  }

  loading.value = true;
  try {
    const r = await apiFetch(`/api/courses/${cid}/materials/${materialId}/download`);
    if (!r.ok) {
      error.value = `Could not load PDF (HTTP ${r.status}).`;
      return;
    }
    const buf = await r.arrayBuffer();
    if (cancelled) return;

    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    if (cancelled) return;

    pdfDoc = pdf;
    numPages.value = pdf.numPages;
    activeIdx.value = 0;
    await renderActivePages();
  } catch (e) {
    if (cancelled) return;
    error.value = e?.message || "Could not render PDF.";
  } finally {
    loading.value = false;
  }
}

async function renderActivePages() {
  if (cancelled) return;
  const pdf = pdfDoc;
  const list = availablePages.value;
  if (!pdf || !list.length) return;
  const p1 = list[activeIdx.value];
  const p2 = viewMode.value === "spread" ? (list[activeIdx.value + 1] ?? null) : null;
  if (!Number.isFinite(p1)) return;

  const key = `${p1}-${p2 ?? ""}`;
  if (key === lastRenderedKey && renderedPages.value.length) return;
  lastRenderedKey = key;

  const toRender = [p1, p2].filter((x) => Number.isFinite(x));
  const out = [];
  for (const p of toRender) {
    const page = await pdf.getPage(p);
    if (cancelled) return;
    const viewport = page.getViewport({ scale: 1.25 });
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    out.push({ page: p, dataUrl: canvas.toDataURL("image/png") });
  }
  renderedPages.value = out;
}

watch(
  () => [section.value?.materialId, section.value?.pagesFrom, section.value?.pagesTo, section.value?.viewMode],
  () => {
    render();
  },
  { immediate: true },
);

watch(
  () => [props.courseId, section.value?.materialId],
  () => {
    ensureMaterialTitle();
  },
  { immediate: true },
);

onUnmounted(async () => {
  cancelled = true;
  window.removeEventListener("keydown", onKeydown);
  if (wheelCooldownId != null) window.clearTimeout(wheelCooldownId);
  wheelCooldownId = null;
  if (scrollCooldownId != null) window.clearTimeout(scrollCooldownId);
  scrollCooldownId = null;

  for (const ro of pageResizeObservers.values()) {
    try {
      ro.disconnect();
    } catch {
      /* ignore */
    }
  }
  pageResizeObservers.clear();

  // Best-effort cleanup of pdf.js resources.
  try {
    await pdfDoc?.destroy?.();
  } catch {
    /* ignore */
  }
  pdfDoc = null;
});
</script>

<template>
  <div
    class="flex h-[calc(var(--workbook-scroll-h,100dvh)-2rem)] flex-col rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900"
  >
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {{ docTitle }} {{ pageRangeLabel }}
        </p>
        <p class="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          {{ hasPdf ? "" : "Choose a PDF from Materials using the Add document button." }}
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <button
          type="button"
          class="flex h-7 w-7 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-700 shadow-sm hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          :title="viewMode === 'single' ? 'Switch to 2-page view' : 'Switch to 1-page view'"
          :aria-label="viewMode === 'single' ? 'Switch to 2-page view' : 'Switch to 1-page view'"
          @click="section.viewMode = viewMode === 'single' ? 'spread' : 'single'"
        >
          <!-- Single page: vertical rectangle -->
          <svg
            v-if="viewMode === 'single'"
            class="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <!-- A4-like page with a folded corner -->
            <path d="M8 3h7l3 3v15a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
            <path d="M15 3v3h3" />
          </svg>
          <!-- Spread: open-book style (two rectangles sharing a side) -->
          <svg
            v-else
            class="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M12 6v14" />
            <path d="M6 5h6v15H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
            <path d="M18 5h-6v15h6a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Z" />
          </svg>
        </button>
        <button
          type="button"
          class="flex h-7 w-7 items-center justify-center rounded-md border text-sm font-semibold shadow-sm"
          :class="
            annotateEnabled
              ? 'border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200 dark:hover:bg-indigo-950/70'
              : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800'
          "
          :title="annotateEnabled ? 'Disable text notes' : 'Enable text notes'"
          :aria-label="annotateEnabled ? 'Disable text notes' : 'Enable text notes'"
          @click="annotateEnabled = !annotateEnabled"
        >
          A
        </button>
        <div
          v-if="annotateEnabled && selectedNoteId"
          class="ml-1 flex items-center gap-1 rounded-md border border-zinc-200 bg-white p-0.5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
          role="group"
          aria-label="Text formatting"
        >
          <button
            type="button"
            class="flex h-6 w-6 items-center justify-center rounded text-xs font-semibold text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40"
            title="Delete text box"
            aria-label="Delete text box"
            @click="removeNote(selectedNoteId)"
          >
            ×
          </button>
          <button
            type="button"
            class="flex h-6 w-6 items-center justify-center rounded text-xs font-semibold text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            :title="selectedNote()?.color === 'light' ? 'Switch to black text' : 'Switch to light text'"
            :aria-label="selectedNote()?.color === 'light' ? 'Switch to black text' : 'Switch to light text'"
            @click="toggleSelectedColor"
          >
            <span
              class="h-3 w-3 rounded-sm border border-zinc-300"
              :class="selectedNote()?.color === 'light' ? 'bg-zinc-100' : 'bg-zinc-900'"
            />
          </button>
          <button
            type="button"
            class="flex h-6 w-6 items-center justify-center rounded text-xs font-semibold text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            title="Smaller"
            aria-label="Smaller"
            @click="changeSelectedFontSize(-1)"
          >
            −
          </button>
          <button
            type="button"
            class="flex h-6 w-6 items-center justify-center rounded text-xs font-semibold text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            title="Larger"
            aria-label="Larger"
            @click="changeSelectedFontSize(1)"
          >
            +
          </button>
        </div>
        <p v-if="availablePages.length" class="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
          Page {{ viewMode === "single" ? String(activePageNumber ?? '-') : activePageNumbersLabel }} /
          {{ availablePages[availablePages.length - 1] }}
        </p>
      </div>
    </div>

    <p v-if="error" class="mt-3 text-sm text-red-600 dark:text-red-400">{{ error }}</p>
    <p v-else-if="loading" class="mt-3 text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>

    <div v-if="renderedPages.length" class="mt-4 min-h-0 flex-1">
      <div
        v-if="viewMode === 'single'"
        ref="singleScrollerEl"
        class="h-full overflow-y-auto overscroll-contain rounded-md"
        @scroll="onSingleScroll"
        @wheel="onSingleWheel"
      >
        <div
          v-for="p in renderedPages"
          :key="p.page"
          class="relative w-full overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-700"
          data-pdf-page
          :ref="(el) => setPageEl(p.page, el)"
          @click="onPageClick($event, p.page)"
        >
          <img :src="p.dataUrl" alt="" class="block w-full select-none" draggable="false" />

        <div
          v-for="n in notes.filter((x) => Number(x.page) === p.page)"
          :key="n.id"
          class="absolute"
          :style="noteStyle(n)"
        >
          <div
            class="pointer-events-auto"
            data-note
            @pointerdown.stop
            @click.stop
            style="touch-action: none"
          >
            <textarea
              v-model="n.text"
              rows="1"
              class="w-full resize-none overflow-hidden whitespace-pre-wrap border border-dashed border-zinc-400 bg-transparent px-1.5 py-0.5 text-zinc-900 outline-none dark:border-zinc-500"
              :readonly="editingNoteId !== n.id"
              :class="
                (selectedNoteId === n.id ? 'ring-1 ring-indigo-500 ' : '') +
                (editingNoteId === n.id ? 'cursor-text ' : 'cursor-move ')
              "
              :style="{
                fontSize: `clamp(10px, calc(var(--page-w, 700px) * ${
                  Number.isFinite(Number(n.fontSizePct)) ? Number(n.fontSizePct) / 100 : 0.023
                }), 28px)`,
                color: n.color === 'light' ? 'rgb(244 244 245)' : 'rgb(9 9 11)',
              }"
              placeholder="Type…"
              :ref="(el) => setNoteInputEl(n.id, el)"
              @pointerdown.capture="beginNoteDragCandidate($event, n)"
              @pointerdown.stop="
                annotateEnabled = true;
                selectedNoteId = n.id;
              "
              @click.stop="
                annotateEnabled = true;
                selectedNoteId = n.id;
                editingNoteId = n.id;
              "
              @focus="
                annotateEnabled = true;
                selectedNoteId = n.id;
              "
              @input="autosizeTextarea($event.target)"
              @keydown.enter.stop
              @blur="onNoteBlur(n)"
            ></textarea>
          </div>
        </div>
        </div>
      </div>

      <div
        v-else
        class="grid gap-3"
        :class="viewMode === 'spread' ? 'sm:grid-cols-2' : 'grid-cols-1'"
      >
        <div
          v-for="p in renderedPages"
          :key="p.page"
          class="relative w-full overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-700"
          data-pdf-page
          :ref="(el) => setPageEl(p.page, el)"
          @click="onPageClick($event, p.page)"
          @wheel.prevent="onWheel"
        >
          <img :src="p.dataUrl" alt="" class="block w-full select-none" draggable="false" />

          <div
            v-for="n in notes.filter((x) => Number(x.page) === p.page)"
            :key="n.id"
            class="absolute"
            :style="noteStyle(n)"
          >
            <div class="pointer-events-auto" data-note @pointerdown.stop @click.stop style="touch-action: none">
              <textarea
                v-model="n.text"
                rows="1"
                class="w-full resize-none overflow-hidden whitespace-pre-wrap border border-dashed border-zinc-400 bg-transparent px-1.5 py-0.5 text-zinc-900 outline-none dark:border-zinc-500"
                :readonly="editingNoteId !== n.id"
                :class="
                  (selectedNoteId === n.id ? 'ring-1 ring-indigo-500 ' : '') +
                  (editingNoteId === n.id ? 'cursor-text ' : 'cursor-move ')
                "
                :style="{
                  fontSize: `clamp(10px, calc(var(--page-w, 700px) * ${
                    Number.isFinite(Number(n.fontSizePct)) ? Number(n.fontSizePct) / 100 : 0.023
                  }), 28px)`,
                  color: n.color === 'light' ? 'rgb(244 244 245)' : 'rgb(9 9 11)',
                }"
                placeholder="Type…"
                :ref="(el) => setNoteInputEl(n.id, el)"
                @pointerdown.capture="beginNoteDragCandidate($event, n)"
                @pointerdown.stop="
                  annotateEnabled = true;
                  selectedNoteId = n.id;
                "
                @click.stop="
                  annotateEnabled = true;
                  selectedNoteId = n.id;
                  editingNoteId = n.id;
                "
                @focus="
                  annotateEnabled = true;
                  selectedNoteId = n.id;
                "
                @input="autosizeTextarea($event.target)"
                @keydown.enter.stop
                @blur="onNoteBlur(n)"
              ></textarea>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

