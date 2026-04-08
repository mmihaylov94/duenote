<script setup>
import { ref, watch, computed, onUnmounted, onMounted, nextTick } from "vue";
import { apiFetch } from "../api/client.js";
// Custom icons used for page view toggle.
import iro from "@jaames/iro";
import { Pencil as LucidePencil, Highlighter as LucideHighlighter, Eraser as LucideEraser } from "lucide-vue-next";

import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

let sharedPdfWorker = null;
function ensurePdfWorker() {
  if (sharedPdfWorker) return;
  sharedPdfWorker = new Worker(pdfWorkerUrl, { type: "module" });
  pdfjsLib.GlobalWorkerOptions.workerPort = sharedPdfWorker;
}

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
/** Selected drawing (move mode) */
const selectedDrawingId = ref(null);
const annotateEnabled = ref(false);
/** @type {import('vue').Ref<'off'|'pen'|'highlighter'|'eraser'>} */
const pencilTool = ref("off");
const pencilColor = ref("#0a0a0a"); // default for new strokes
const pencilSizePct = ref(0.35); // default for new strokes; percent of page width
const drawingInProgress = ref(false);
const activeStrokeId = ref(null);
const drawingDrag = ref(null);
const erasingInProgress = ref(false);
const colorPickerOpen = ref(false);
const colorPickerTarget = ref(null); // 'pencil' | 'selected'
const colorPickerEl = ref(null);
const colorPickerPos = ref({ top: 0, left: 0 });
const colorPickerPlacement = ref("bottom"); // bottom | top
let iroPicker = null;

function getPageElByNumber(pageNumber) {
  const p = Number(pageNumber);
  if (!Number.isFinite(p)) return null;
  return pageEls.get(p) || null;
}

function setPencilTool(next) {
  pencilTool.value = next;
  // When switching tools, exit any text editing state.
  editingNoteId.value = null;
  if (next !== "off") {
    annotateEnabled.value = false;
  }
}

function togglePencilEnabled() {
  if (pencilTool.value === "off") setPencilTool("pen");
  else setPencilTool("off");
}

function toggleAnnotations() {
  annotateEnabled.value = !annotateEnabled.value;
  if (annotateEnabled.value) {
    // Switching to annotations disables pencil mode.
    pencilTool.value = "off";
  }
}

function applyPencilDefaultsFromSelected() {
  const d = selectedDrawing();
  if (!d) return;
  if (d.color === "light" || d.color === "black") pencilColor.value = d.color;
  if (Number.isFinite(Number(d.sizePct))) pencilSizePct.value = Number(d.sizePct);
  if (d.tool === "pen" || d.tool === "highlighter") pencilTool.value = d.tool;
}

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
const drawings = computed(() => (Array.isArray(section.value?.drawings) ? section.value.drawings : []));
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

function ensureDrawingsArray() {
  if (!Array.isArray(section.value.drawings)) section.value.drawings = [];
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

function selectedDrawing() {
  const id = selectedDrawingId.value;
  if (!id) return null;
  const list = Array.isArray(section.value?.drawings) ? section.value.drawings : [];
  return list.find((d) => d?.id === id) || null;
}

function removeDrawing(id) {
  ensureDrawingsArray();
  section.value.drawings = section.value.drawings.filter((d) => d.id !== id);
  if (selectedDrawingId.value === id) selectedDrawingId.value = null;
}

function drawingStyle(d) {
  const sizePct = Number.isFinite(Number(d?.sizePct)) ? Number(d.sizePct) : 0.35;
  const colorRaw = d?.color;
  const color =
    colorRaw === "light"
      ? "rgb(244 244 245)"
      : colorRaw === "black"
        ? "rgb(9 9 11)"
        : typeof colorRaw === "string" && colorRaw.trim()
          ? colorRaw
          : "rgb(9 9 11)";
  const opacity = d?.tool === "highlighter" ? 0.35 : 1;
  return {
    stroke: color,
    opacity,
    strokeWidth: `clamp(1px, calc(var(--page-w, 700px) * ${sizePct / 100}), 24px)`,
  };
}

function togglePencilColor() {
  if (selectedKind.value === "drawing") {
    const d = selectedDrawing();
    if (!d) return;
    if (d.color === "light" || d.color === "black") {
      d.color = d.color === "light" ? "black" : "light";
      pencilColor.value = d.color === "light" ? "#f4f4f5" : "#0a0a0a";
    } else {
      const cur = typeof d.color === "string" && d.color ? d.color : "#0a0a0a";
      d.color = cur.toLowerCase() === "#f4f4f5" ? "#0a0a0a" : "#f4f4f5";
      pencilColor.value = d.color;
    }
    return;
  }
  pencilColor.value = String(pencilColor.value || "#0a0a0a").toLowerCase() === "#f4f4f5" ? "#0a0a0a" : "#f4f4f5";
}

function changePencilThickness(delta) {
  const step = 0.06;
  if (selectedKind.value === "drawing") {
    const d = selectedDrawing();
    if (!d) return;
    const cur = Number.isFinite(Number(d.sizePct)) ? Number(d.sizePct) : pencilSizePct.value;
    const next = Math.max(0.15, Math.min(1.2, cur + delta * step));
    d.sizePct = next;
    pencilSizePct.value = next;
    return;
  }
  pencilSizePct.value = Math.max(0.15, Math.min(1.2, pencilSizePct.value + delta * step));
}

function colorForSelectedKind() {
  if (selectedKind.value === "note") {
    const n = selectedNote();
    if (!n) return "#0a0a0a";
    if (n.color === "light") return "#f4f4f5";
    if (n.color === "black") return "#0a0a0a";
    return typeof n.color === "string" && n.color ? n.color : "#0a0a0a";
  }
  if (selectedKind.value === "drawing") {
    const d = selectedDrawing();
    if (!d) return "#0a0a0a";
    if (d.color === "light") return "#f4f4f5";
    if (d.color === "black") return "#0a0a0a";
    return typeof d.color === "string" && d.color ? d.color : "#0a0a0a";
  }
  return "#0a0a0a";
}

function setColorForSelectedKind(hex) {
  if (!hex) return;
  if (selectedKind.value === "note") {
    const n = selectedNote();
    if (!n) return;
    n.color = hex;
  } else if (selectedKind.value === "drawing") {
    const d = selectedDrawing();
    if (!d) return;
    d.color = hex;
    pencilColor.value = hex;
  }
}

function noteTextColor(n) {
  const c = n?.color;
  if (c === "light") return "rgb(244 244 245)";
  if (c === "black") return "rgb(9 9 11)";
  if (typeof c === "string" && c.trim()) return c;
  return "rgb(9 9 11)";
}

function openColorPicker(target, e) {
  colorPickerTarget.value = target; // 'pencil' | 'selected'
  colorPickerOpen.value = true;
  if (e?.currentTarget instanceof Element) {
    const r = e.currentTarget.getBoundingClientRect();
    const popW = 220;
    const popH = 250;
    const margin = 8;
    let left = Math.min(window.innerWidth - popW - margin, Math.max(margin, r.left));
    let top = r.bottom + margin;
    let placement = "bottom";
    if (top + popH > window.innerHeight - margin) {
      top = Math.max(margin, r.top - popH - margin);
      placement = "top";
    }
    colorPickerPos.value = { top, left };
    colorPickerPlacement.value = placement;
  }
  nextTick(() => {
    if (!colorPickerEl.value) return;
    const initial = target === "pencil" ? pencilColor.value : colorForSelectedKind();
    // The popover container is created/destroyed by Vue (v-if), so we must
    // (re)mount the picker into the current element every time.
    try {
      iroPicker?.off?.();
    } catch {
      /* ignore */
    }
    iroPicker = null;
    try {
      colorPickerEl.value.innerHTML = "";
    } catch {
      /* ignore */
    }

    iroPicker = new iro.ColorPicker(colorPickerEl.value, {
      width: 200,
      color: initial,
      layout: [
        { component: iro.ui.Wheel },
        { component: iro.ui.Slider, options: { sliderType: "value" } },
      ],
    });
    iroPicker.on("color:change", (c) => {
      const hex = c?.hexString || "#0a0a0a";
      if (colorPickerTarget.value === "pencil") {
        pencilColor.value = hex;
        // If a drawing is selected, treat pencil color as editing it.
        if (selectedDrawingId.value) setColorForSelectedKind(hex);
      } else {
        setColorForSelectedKind(hex);
      }
    });
  });
}

function closeColorPicker() {
  colorPickerOpen.value = false;
  colorPickerTarget.value = null;
}

function onGlobalPointerDownForColorPicker(e) {
  if (!colorPickerOpen.value) return;
  if (e.target instanceof Element && e.target.closest?.("[data-color-picker-root]")) return;
  closeColorPicker();
}

function drawingPathD(d) {
  const pts = Array.isArray(d?.points) ? d.points : [];
  if (!pts.length) return "";
  const ox = Number.isFinite(Number(d?.x)) ? Number(d.x) : 0;
  const oy = Number.isFinite(Number(d?.y)) ? Number(d.y) : 0;
  const scale = 1000;
  const p0 = pts[0];
  let out = `M ${(clamp01(p0.x + ox, 0) * scale).toFixed(2)} ${(clamp01(p0.y + oy, 0) * scale).toFixed(2)}`;
  for (let i = 1; i < pts.length; i += 1) {
    const p = pts[i];
    out += ` L ${(clamp01(p.x + ox, 0) * scale).toFixed(2)} ${(clamp01(p.y + oy, 0) * scale).toFixed(2)}`;
  }
  return out;
}

const selectedKind = computed(() => {
  if (selectedNoteId.value) return "note";
  if (selectedDrawingId.value) return "drawing";
  return null;
});

function clearSelection() {
  selectedNoteId.value = null;
  editingNoteId.value = null;
  selectedDrawingId.value = null;
}

function pagePointFromEvent(pageNumber, e, preferCurrentTarget = false) {
  const targetEl =
    preferCurrentTarget && e?.currentTarget instanceof Element ? e.currentTarget : getPageElByNumber(pageNumber);
  const box = targetEl?.getBoundingClientRect?.();
  if (!box || !box.width || !box.height) return null;
  const x = (e.clientX - box.left) / box.width;
  const y = (e.clientY - box.top) / box.height;
  return { x: clamp01(x, 0), y: clamp01(y, 0), box };
}

function maybeAppendPoint(stroke, pt) {
  const pts = stroke.points;
  const last = pts[pts.length - 1];
  if (!last) {
    pts.push(pt);
    return;
  }
  const dx = pt.x - last.x;
  const dy = pt.y - last.y;
  if (dx * dx + dy * dy < 0.000004) return; // ~0.2% of page
  pts.push(pt);
}

function beginStroke(pageNumber, tool, e) {
  if (pencilTool.value === "off") return;
  ensureDrawingsArray();
  const p = pagePointFromEvent(pageNumber, e, true);
  if (!p) return;
  try {
    e.currentTarget?.setPointerCapture?.(e.pointerId);
  } catch {
    /* ignore */
  }
  const id = crypto.randomUUID();
  const baseSizePct = Number.isFinite(Number(pencilSizePct.value)) ? Number(pencilSizePct.value) : 0.35;
  const stroke = {
    id,
    page: pageNumber,
    tool,
    color: String(pencilColor.value || "#0a0a0a"),
    sizePct: baseSizePct,
    x: 0,
    y: 0,
    points: [{ x: p.x, y: p.y }],
  };
  section.value.drawings.push(stroke);
  activeStrokeId.value = id;
  drawingInProgress.value = true;
  selectedDrawingId.value = id;
  selectedNoteId.value = null;
  editingNoteId.value = null;
  e.preventDefault();
}

function updateStroke(pageNumber, e) {
  const id = activeStrokeId.value;
  if (!drawingInProgress.value || !id) return;
  const list = Array.isArray(section.value?.drawings) ? section.value.drawings : [];
  const stroke = list.find((d) => d?.id === id);
  if (!stroke) return;
  const p = pagePointFromEvent(pageNumber, e, true);
  if (!p) return;
  maybeAppendPoint(stroke, { x: p.x, y: p.y });
  e.preventDefault();
}

function endStroke() {
  if (!drawingInProgress.value) return;
  const id = activeStrokeId.value;
  drawingInProgress.value = false;
  activeStrokeId.value = null;
  if (!id) return;
  const list = Array.isArray(section.value?.drawings) ? section.value.drawings : [];
  const stroke = list.find((d) => d?.id === id);
  const ptsLen = stroke?.points?.length ?? 0;
  if (ptsLen < 2) removeDrawing(id);
  suppressSyntheticClickOnce();
}

function beginErase(pageNumber, e) {
  if (pencilTool.value !== "eraser") return;
  erasingInProgress.value = true;
  eraseAt(pageNumber, e);
}

function updateErase(pageNumber, e) {
  if (!erasingInProgress.value) return;
  eraseAt(pageNumber, e);
}

function endErase() {
  if (!erasingInProgress.value) return;
  erasingInProgress.value = false;
  suppressSyntheticClickOnce();
}

function eraseAt(pageNumber, e) {
  ensureDrawingsArray();
  const p = pagePointFromEvent(pageNumber, e, true);
  if (!p) return;
  const threshPx = 14;
  const thresh = threshPx / p.box.width;
  const thresh2 = thresh * thresh;
  const page = Number(pageNumber);
  section.value.drawings = section.value.drawings.filter((d) => {
    if (Number(d.page) !== page) return true;
    const pts = Array.isArray(d.points) ? d.points : [];
    const ox = Number.isFinite(Number(d.x)) ? Number(d.x) : 0;
    const oy = Number.isFinite(Number(d.y)) ? Number(d.y) : 0;
    for (const pt of pts) {
      const dx = (pt.x + ox) - p.x;
      const dy = (pt.y + oy) - p.y;
      if (dx * dx + dy * dy <= thresh2) return false;
    }
    return true;
  });
  if (selectedDrawingId.value && !section.value.drawings.some((d) => d.id === selectedDrawingId.value)) {
    selectedDrawingId.value = null;
  }
  e.preventDefault();
}

function beginDrawingDragCandidate(pageNumber, drawing, e) {
  // Allow moving drawings both in annotation mode and while pencil is enabled.
  if (!drawing?.id) return;
  if (drawingInProgress.value) return;
  if (editingNoteId.value) return;
  const pageEl = getPageElByNumber(pageNumber);
  const box = pageEl?.getBoundingClientRect?.();
  if (!box || !box.width || !box.height) return;
  selectedDrawingId.value = drawing.id;
  selectedNoteId.value = null;
  applyPencilDefaultsFromSelected();
  drawingDrag.value = {
    page: pageNumber,
    id: drawing.id,
    box,
    startClientX: e.clientX,
    startClientY: e.clientY,
    startX: Number.isFinite(Number(drawing.x)) ? Number(drawing.x) : 0,
    startY: Number.isFinite(Number(drawing.y)) ? Number(drawing.y) : 0,
    moved: false,
  };
  try {
    e.currentTarget?.setPointerCapture?.(e.pointerId);
  } catch {
    /* ignore */
  }
  window.addEventListener("pointermove", onDrawingDragMove, true);
  window.addEventListener("pointerup", endDrawingDrag, true);
  window.addEventListener("pointercancel", endDrawingDrag, true);
}

function clampDrawingOffset(stroke, nextX, nextY) {
  const pts = Array.isArray(stroke?.points) ? stroke.points : [];
  if (!pts.length) return { x: nextX, y: nextY };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    const x = Number(p?.x);
    const y = Number(p?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return { x: nextX, y: nextY };
  }
  const loX = -minX;
  const hiX = 1 - maxX;
  const loY = -minY;
  const hiY = 1 - maxY;
  return {
    x: Math.max(loX, Math.min(hiX, nextX)),
    y: Math.max(loY, Math.min(hiY, nextY)),
  };
}

function onDrawingDragMove(e) {
  const d = drawingDrag.value;
  if (!d) return;
  const list = Array.isArray(section.value?.drawings) ? section.value.drawings : [];
  const stroke = list.find((x) => x?.id === d.id);
  if (!stroke) return;
  const dxPx = e.clientX - d.startClientX;
  const dyPx = e.clientY - d.startClientY;
  const dist2 = dxPx * dxPx + dyPx * dyPx;
  if (!d.moved && dist2 < 16) return;
  if (!d.moved) {
    d.moved = true;
    try {
      document.activeElement?.blur?.();
    } catch {
      /* ignore */
    }
  }
  const dx = dxPx / d.box.width;
  const dy = dyPx / d.box.height;
  const nextX = (Number.isFinite(Number(d.startX)) ? Number(d.startX) : 0) + dx;
  const nextY = (Number.isFinite(Number(d.startY)) ? Number(d.startY) : 0) + dy;
  const clamped = clampDrawingOffset(stroke, nextX, nextY);
  stroke.x = clamped.x;
  stroke.y = clamped.y;
  e.preventDefault();
}

function endDrawingDrag() {
  const moved = Boolean(drawingDrag.value?.moved);
  drawingDrag.value = null;
  window.removeEventListener("pointermove", onDrawingDragMove, true);
  window.removeEventListener("pointerup", endDrawingDrag, true);
  window.removeEventListener("pointercancel", endDrawingDrag, true);
  if (moved) suppressSyntheticClickOnce();
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
  if (selectedKind.value === "note") {
    const n = selectedNote();
    if (!n) return;
    n.color = n.color === "light" ? "black" : "light";
  } else if (selectedKind.value === "drawing") {
    const d = selectedDrawing();
    if (!d) return;
    d.color = d.color === "light" ? "black" : "light";
  }
}

function changeSelectedSize(delta) {
  if (selectedKind.value === "note") {
    const n = selectedNote();
    if (!n) return;
    const cur = Number.isFinite(Number(n.fontSizePct)) ? Number(n.fontSizePct) : 2.3;
    const next = cur + delta * 0.15;
    n.fontSizePct = Math.max(1.0, Math.min(4.0, next));
  } else if (selectedKind.value === "drawing") {
    const d = selectedDrawing();
    if (!d) return;
    const cur = Number.isFinite(Number(d.sizePct)) ? Number(d.sizePct) : 0.35;
    const next = cur + delta * 0.06;
    d.sizePct = Math.max(0.15, Math.min(1.2, next));
  }
}

function onPageClick(e, pageNumber) {
  if (!annotateEnabled.value) return;
  if (pencilTool.value !== "off") return;
  // Do not add a new note when clicking an existing note.
  if (e.target instanceof HTMLElement && e.target.closest?.("[data-note]")) return;
  if (e.target instanceof HTMLElement && e.target.closest?.("[data-stroke]")) return;
  // If a note is currently selected/being edited, a click on the page should
  // only unfocus (exit editing) and NOT create a new note.
  if (selectedNoteId.value || editingNoteId.value || selectedDrawingId.value) {
    clearSelection();
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
  if (
    annotateEnabled.value &&
    selectedDrawingId.value &&
    (e.key === "Delete" || e.key === "Backspace")
  ) {
    e.preventDefault();
    removeDrawing(selectedDrawingId.value);
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
  window.addEventListener("pointerdown", onGlobalPointerDownForColorPicker, true);
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
    ensurePdfWorker();
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
  window.removeEventListener("pointerdown", onGlobalPointerDownForColorPicker, true);
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
          @click="toggleAnnotations"
        >
          A
        </button>
        <button
          type="button"
          class="flex h-7 w-7 items-center justify-center rounded-md border shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
          :class="
            pencilTool !== 'off'
              ? 'border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200 dark:hover:bg-indigo-950/70'
              : 'border-zinc-300 bg-white text-zinc-700 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200'
          "
          :title="pencilTool !== 'off' ? 'Disable pencil' : 'Enable pencil'"
          :aria-label="pencilTool !== 'off' ? 'Disable pencil' : 'Enable pencil'"
          @click="togglePencilEnabled"
        >
          <svg
            class="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5Z" />
          </svg>
        </button>

        <!-- Pencil menu (right side, like annotations controls) -->
        <div
          v-if="pencilTool !== 'off'"
          class="ml-1 flex items-center gap-1 rounded-md border border-zinc-200 bg-white p-0.5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
          role="group"
          aria-label="Pencil tools"
        >
          <button
            type="button"
            class="flex h-6 w-6 items-center justify-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
            :class="pencilTool === 'pen' ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200' : ''"
            title="Pen"
            aria-label="Pen"
            @click="setPencilTool('pen')"
          >
            <LucidePencil class="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="flex h-6 w-6 items-center justify-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
            :class="
              pencilTool === 'highlighter'
                ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200'
                : ''
            "
            title="Highlighter"
            aria-label="Highlighter"
            @click="setPencilTool('highlighter')"
          >
            <LucideHighlighter class="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="flex h-6 w-6 items-center justify-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
            :class="
              pencilTool === 'eraser' ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200' : ''
            "
            title="Eraser"
            aria-label="Eraser"
            @click="setPencilTool('eraser')"
          >
            <LucideEraser class="h-4 w-4" aria-hidden="true" />
          </button>
          <div class="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-700" />
          <button
            type="button"
            class="flex h-6 w-6 items-center justify-center rounded text-xs font-semibold text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            title="Choose color"
            aria-label="Choose color"
            @click="openColorPicker(selectedDrawingId ? 'selected' : 'pencil', $event)"
          >
            <span
              class="h-3 w-3 rounded-sm border border-zinc-300"
              :style="{ backgroundColor: pencilColor }"
            />
          </button>
          <button
            type="button"
            class="flex h-6 w-6 items-center justify-center rounded text-xs font-semibold text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            title="Thinner"
            aria-label="Thinner"
            @click="changePencilThickness(-1)"
          >
            −
          </button>
          <button
            type="button"
            class="flex h-6 w-6 items-center justify-center rounded text-xs font-semibold text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            title="Thicker"
            aria-label="Thicker"
            @click="changePencilThickness(1)"
          >
            +
          </button>
        </div>
        <div
          v-if="annotateEnabled && selectedKind"
          class="ml-1 flex items-center gap-1 rounded-md border border-zinc-200 bg-white p-0.5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
          role="group"
          aria-label="Text formatting"
        >
          <button
            type="button"
            class="flex h-6 w-6 items-center justify-center rounded text-xs font-semibold text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40"
            title="Delete text box"
            aria-label="Delete text box"
            @click="selectedKind === 'note' ? removeNote(selectedNoteId) : removeDrawing(selectedDrawingId)"
          >
            ×
          </button>
          <button
            type="button"
            class="flex h-6 w-6 items-center justify-center rounded text-xs font-semibold text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            title="Choose color"
            aria-label="Choose color"
            @click="openColorPicker('selected', $event)"
          >
            <span
              class="h-3 w-3 rounded-sm border border-zinc-300"
              :style="{ backgroundColor: colorForSelectedKind() }"
            />
          </button>
          <button
            type="button"
            class="flex h-6 w-6 items-center justify-center rounded text-xs font-semibold text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            title="Smaller"
            aria-label="Smaller"
            @click="changeSelectedSize(-1)"
          >
            −
          </button>
          <button
            type="button"
            class="flex h-6 w-6 items-center justify-center rounded text-xs font-semibold text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            title="Larger"
            aria-label="Larger"
            @click="changeSelectedSize(1)"
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

    <div
      v-if="colorPickerOpen"
      data-color-picker-root
      class="fixed z-50 w-[220px] rounded-md border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
      :style="{ top: colorPickerPos.top + 'px', left: colorPickerPos.left + 'px' }"
      @pointerdown.stop
    >
      <div class="flex items-center justify-between gap-2">
        <p class="text-xs font-medium text-zinc-600 dark:text-zinc-300">Color</p>
        <button
          type="button"
          class="rounded px-2 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
          @click="closeColorPicker"
        >
          Close
        </button>
      </div>
      <div ref="colorPickerEl" class="mt-2" />
    </div>

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

          <svg
            class="absolute inset-0"
            viewBox="0 0 1000 1000"
            preserveAspectRatio="none"
            :style="{ pointerEvents: annotateEnabled || pencilTool !== 'off' ? 'auto' : 'none' }"
            @pointerdown.stop.prevent="
              (e) => {
                if (pencilTool === 'pen' || pencilTool === 'highlighter') beginStroke(p.page, pencilTool, e);
                else if (pencilTool === 'eraser') beginErase(p.page, e);
              }
            "
            @pointermove.stop.prevent="
              (e) => {
                if (pencilTool === 'pen' || pencilTool === 'highlighter') updateStroke(p.page, e);
                else if (pencilTool === 'eraser') updateErase(p.page, e);
              }
            "
            @pointerup.stop.prevent="
              () => {
                endStroke();
                endErase();
              }
            "
            @pointercancel.stop.prevent="
              () => {
                endStroke();
                endErase();
              }
            "
          >
            <g v-for="d in drawings.filter((x) => Number(x.page) === p.page)" :key="d.id">
              <path
                v-if="selectedDrawingId === d.id"
                :d="drawingPathD(d)"
                fill="none"
                stroke="rgb(99 102 241)"
                :style="{ strokeWidth: `calc(${drawingStyle(d).strokeWidth} + 2px)`, opacity: 0.6 }"
                vector-effect="non-scaling-stroke"
                stroke-linecap="round"
                stroke-linejoin="round"
                pointer-events="none"
              />
              <!-- Wide invisible hit area for easier selection/drag -->
              <path
                :d="drawingPathD(d)"
                fill="none"
                stroke="transparent"
                :style="{ strokeWidth: `calc(${drawingStyle(d).strokeWidth} + 12px)` }"
                vector-effect="non-scaling-stroke"
                stroke-linecap="round"
                stroke-linejoin="round"
                pointer-events="stroke"
                @pointerdown.stop.prevent="
                  (e) => {
                    if (pencilTool === 'eraser') beginErase(p.page, e);
                    else beginDrawingDragCandidate(p.page, d, e);
                  }
                "
              />
              <path
                :d="drawingPathD(d)"
                fill="none"
                :style="drawingStyle(d)"
                vector-effect="non-scaling-stroke"
                stroke-linecap="round"
                stroke-linejoin="round"
                data-stroke
                @pointerdown.stop.prevent="
                  (e) => {
                    if (pencilTool === 'eraser') beginErase(p.page, e);
                    else beginDrawingDragCandidate(p.page, d, e);
                  }
                "
              />
            </g>
          </svg>

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
                  color: noteTextColor(n),
                }"
                placeholder="Type…"
                :ref="(el) => setNoteInputEl(n.id, el)"
                @pointerdown.capture="beginNoteDragCandidate($event, n)"
                @pointerdown.stop="
                  if (pencilTool !== 'off') pencilTool = 'off';
                  annotateEnabled = true;
                  selectedNoteId = n.id;
                  selectedDrawingId = null;
                "
                @click.stop="
                  if (pencilTool !== 'off') pencilTool = 'off';
                  annotateEnabled = true;
                  selectedNoteId = n.id;
                  selectedDrawingId = null;
                  editingNoteId = n.id;
                "
                @focus="
                  if (pencilTool !== 'off') pencilTool = 'off';
                  annotateEnabled = true;
                  selectedNoteId = n.id;
                  selectedDrawingId = null;
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

          <svg
            class="absolute inset-0"
            viewBox="0 0 1000 1000"
            preserveAspectRatio="none"
            :style="{ pointerEvents: annotateEnabled || pencilTool !== 'off' ? 'auto' : 'none' }"
            @pointerdown.stop.prevent="
              (e) => {
                if (pencilTool === 'pen' || pencilTool === 'highlighter') beginStroke(p.page, pencilTool, e);
                else if (pencilTool === 'eraser') beginErase(p.page, e);
              }
            "
            @pointermove.stop.prevent="
              (e) => {
                if (pencilTool === 'pen' || pencilTool === 'highlighter') updateStroke(p.page, e);
                else if (pencilTool === 'eraser') updateErase(p.page, e);
              }
            "
            @pointerup.stop.prevent="
              () => {
                endStroke();
                endErase();
              }
            "
            @pointercancel.stop.prevent="
              () => {
                endStroke();
                endErase();
              }
            "
          >
            <g v-for="d in drawings.filter((x) => Number(x.page) === p.page)" :key="d.id">
              <path
                v-if="selectedDrawingId === d.id"
                :d="drawingPathD(d)"
                fill="none"
                stroke="rgb(99 102 241)"
                :style="{ strokeWidth: `calc(${drawingStyle(d).strokeWidth} + 2px)`, opacity: 0.6 }"
                vector-effect="non-scaling-stroke"
                stroke-linecap="round"
                stroke-linejoin="round"
                pointer-events="none"
              />
            <path
              :d="drawingPathD(d)"
              fill="none"
              stroke="transparent"
              :style="{ strokeWidth: `calc(${drawingStyle(d).strokeWidth} + 12px)` }"
              vector-effect="non-scaling-stroke"
              stroke-linecap="round"
              stroke-linejoin="round"
              pointer-events="stroke"
              @pointerdown.stop.prevent="
                (e) => {
                  if (pencilTool === 'eraser') beginErase(p.page, e);
                  else beginDrawingDragCandidate(p.page, d, e);
                }
              "
            />
              <path
                :d="drawingPathD(d)"
                fill="none"
                :style="drawingStyle(d)"
                vector-effect="non-scaling-stroke"
                stroke-linecap="round"
                stroke-linejoin="round"
                data-stroke
                @pointerdown.stop.prevent="
                  (e) => {
                    if (pencilTool === 'eraser') beginErase(p.page, e);
                    else beginDrawingDragCandidate(p.page, d, e);
                  }
                "
              />
            </g>
          </svg>

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
                  color: noteTextColor(n),
                }"
                placeholder="Type…"
                :ref="(el) => setNoteInputEl(n.id, el)"
                @pointerdown.capture="beginNoteDragCandidate($event, n)"
                @pointerdown.stop="
                  if (pencilTool !== 'off') pencilTool = 'off';
                  annotateEnabled = true;
                  selectedNoteId = n.id;
                  selectedDrawingId = null;
                "
                @click.stop="
                  if (pencilTool !== 'off') pencilTool = 'off';
                  annotateEnabled = true;
                  selectedNoteId = n.id;
                  selectedDrawingId = null;
                  editingNoteId = n.id;
                "
                @focus="
                  if (pencilTool !== 'off') pencilTool = 'off';
                  annotateEnabled = true;
                  selectedNoteId = n.id;
                  selectedDrawingId = null;
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

