<script setup>
import { ref, onMounted, onUnmounted, watch } from "vue";
import { apiFetch } from "../api/client.js";

const props = defineProps({
  courseId: { type: Number, required: true },
  sourceLang: { type: String, required: true },
  targetLang: { type: String, required: true },
  /** (word, meaning) => Promise<void> */
  addEntry: { type: Function, required: true },
});

const visible = ref(false);
const loading = ref(false);
const err = ref("");
const word = ref("");
const panelStyle = ref({ top: "0px", left: "0px" });

const HOST = "[data-dictionary-host]";

function readSelection() {
  const active = document.activeElement;
  if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) {
    const start = active.selectionStart;
    const end = active.selectionEnd;
    if (start == null || end == null || start === end) {
      return { text: "", host: null };
    }
    const host = active.closest(HOST);
    if (!host) return { text: "", host: null };
    const raw = active.value.slice(start, end);
    return { text: raw.trim(), host };
  }
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
    return { text: "", host: null };
  }
  const node = sel.anchorNode;
  if (!node) return { text: "", host: null };
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  const host = el?.closest?.(HOST);
  if (!host) return { text: "", host: null };
  const raw = sel.toString();
  return { text: raw.trim(), host };
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
  const { text, host } = readSelection();
  if (!text || !host) {
    visible.value = false;
    word.value = "";
    return;
  }
  word.value = text.slice(0, 2000);
  placePanel(host);
  visible.value = true;
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
  if (t.closest?.(".selection-dict-panel")) return;
  visible.value = false;
}

async function onAdd() {
  const w = word.value.trim();
  if (!w || loading.value) return;
  loading.value = true;
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
    word.value = "";
    window.getSelection()?.removeAllRanges?.();
  } catch (e) {
    err.value = e instanceof Error ? e.message : "Something went wrong";
  } finally {
    loading.value = false;
  }
}

watch(
  () => [props.courseId, props.sourceLang, props.targetLang],
  () => {
    visible.value = false;
  },
);

let selTimer = null;
function onSelectionChange() {
  clearTimeout(selTimer);
  selTimer = setTimeout(() => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) syncFromSelection();
  }, 80);
}

onMounted(() => {
  document.addEventListener("mouseup", onMouseUp, true);
  document.addEventListener("selectionchange", onSelectionChange);
  document.addEventListener("mousedown", onDocMouseDown, true);
  window.addEventListener("scroll", onScroll, true);
});

onUnmounted(() => {
  clearTimeout(selTimer);
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
      class="selection-dict-panel pointer-events-none fixed z-[100] -translate-x-1/2 -translate-y-full"
      :style="panelStyle"
    >
      <div
        class="pointer-events-auto flex flex-col gap-1 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs shadow-lg dark:border-zinc-600 dark:bg-zinc-900"
      >
        <button
          type="button"
          class="rounded-md bg-indigo-600 px-2.5 py-1 font-medium text-white hover:bg-indigo-500 disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400"
          :disabled="loading"
          @mousedown.prevent
          @click="onAdd"
        >
          {{ loading ? "…" : "Add to dictionary" }}
        </button>
        <p v-if="err" class="max-w-[14rem] text-red-600 dark:text-red-400">{{ err }}</p>
      </div>
    </div>
  </Teleport>
</template>
