<script setup>
import { ref, watch, computed, onUnmounted } from "vue";
import { apiFetch } from "../api/client.js";
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
  materialId: { type: Number, default: null },
  pagesFrom: { type: Number, default: null },
  pagesTo: { type: Number, default: null },
});

/** @type {import('vue').Ref<{page: number, dataUrl: string}[]>} */
const pages = ref([]);
const totalPages = ref(0);
const loading = ref(false);
const error = ref("");

let loadToken = 0;
let componentCancelled = false;

async function loadPreview() {
  const token = ++loadToken;
  pages.value = [];
  totalPages.value = 0;
  error.value = "";

  const cid = Number(props.courseId);
  const mid = Number(props.materialId);
  if (!Number.isFinite(cid) || cid <= 0 || !Number.isFinite(mid) || mid <= 0) {
    loading.value = false;
    return;
  }

  loading.value = true;
  try {
    ensurePdfWorker();
    const r = await apiFetch(
      `/api/courses/${cid}/materials/${mid}/download`,
    );
    if (token !== loadToken || componentCancelled) return;
    if (!r.ok) {
      error.value = `Could not load PDF (HTTP ${r.status}).`;
      return;
    }
    const buf = await r.arrayBuffer();
    if (token !== loadToken || componentCancelled) return;
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    if (token !== loadToken || componentCancelled) return;
    totalPages.value = pdf.numPages;

    const out = [];
    for (let i = 1; i <= pdf.numPages; i += 1) {
      if (token !== loadToken || componentCancelled) return;
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 0.35 });
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      if (token !== loadToken || componentCancelled) return;
      out.push({ page: i, dataUrl: canvas.toDataURL("image/png") });
      pages.value = out.slice();
    }
  } catch (e) {
    if (token !== loadToken || componentCancelled) return;
    const msg = e instanceof Error ? e.message : String(e);
    error.value = msg || "Could not render PDF.";
  } finally {
    if (token === loadToken) loading.value = false;
  }
}

watch(
  () => [props.courseId, props.materialId],
  () => {
    loadPreview();
  },
  { immediate: true },
);

onUnmounted(() => {
  componentCancelled = true;
  loadToken += 1;
});

const range = computed(() => {
  const from = Number(props.pagesFrom);
  const to = Number(props.pagesTo);
  const fromOk = Number.isFinite(from) && from > 0;
  const toOk = Number.isFinite(to) && to > 0;
  if (!fromOk && !toOk) return null;
  const lo = fromOk ? from : to;
  const hi = toOk ? to : from;
  return { lo: Math.min(lo, hi), hi: Math.max(lo, hi) };
});

const visiblePages = computed(() => {
  const r = range.value;
  if (!r) return pages.value;
  return pages.value.filter((p) => p.page >= r.lo && p.page <= r.hi);
});

const statusLabel = computed(() => {
  const total = totalPages.value;
  if (!total) return "";
  const r = range.value;
  if (!r) return `${total} page${total === 1 ? "" : "s"}`;
  const lo = Math.max(1, Math.min(r.lo, total));
  const hi = Math.max(lo, Math.min(r.hi, total));
  const count = hi - lo + 1;
  return `Showing ${count} of ${total} page${total === 1 ? "" : "s"}`;
});

const hasMaterial = computed(() => {
  const mid = Number(props.materialId);
  return Number.isFinite(mid) && mid > 0;
});
</script>

<template>
  <div class="flex min-h-0 flex-col gap-2">
    <div
      class="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400"
    >
      <span class="font-medium">Preview</span>
      <span v-if="statusLabel">{{ statusLabel }}</span>
    </div>
    <div
      class="min-h-0 flex-1 overflow-y-auto rounded-md border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-950"
    >
      <div
        v-if="!hasMaterial"
        class="flex h-full items-center justify-center py-8 text-xs text-zinc-500 dark:text-zinc-400"
      >
        Select a PDF to see its pages here.
      </div>
      <div
        v-else-if="error"
        class="flex h-full items-center justify-center py-8 text-xs text-red-600 dark:text-red-400"
      >
        {{ error }}
      </div>
      <div
        v-else-if="loading && !pages.length"
        class="flex h-full items-center justify-center py-8 text-xs text-zinc-500 dark:text-zinc-400"
      >
        Loading preview…
      </div>
      <div v-else>
        <div
          v-if="!visiblePages.length && totalPages"
          class="flex items-center justify-center py-8 text-xs text-zinc-500 dark:text-zinc-400"
        >
          Selected page range doesn't match any pages.
        </div>
        <div
          v-else
          class="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4"
        >
          <div
            v-for="p in visiblePages"
            :key="p.page"
            class="flex flex-col items-center gap-1"
          >
            <img
              :src="p.dataUrl"
              :alt="`Page ${p.page}`"
              class="block w-full select-none rounded-sm border border-zinc-300 bg-white shadow-sm dark:border-zinc-600"
              draggable="false"
            />
            <span
              class="text-[10px] font-medium text-zinc-600 dark:text-zinc-300"
            >
              Page {{ p.page }}
            </span>
          </div>
        </div>
        <div
          v-if="loading"
          class="mt-2 text-center text-[11px] text-zinc-500 dark:text-zinc-400"
        >
          Rendering {{ pages.length }} / {{ totalPages }}…
        </div>
      </div>
    </div>
  </div>
</template>
