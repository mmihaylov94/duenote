<script setup>
import { ref, watch, onMounted, onUnmounted, computed } from "vue";
import { XMarkIcon } from "@heroicons/vue/20/solid";
import { apiFetch } from "../api/client.js";

const props = defineProps({
  course: { type: Object, required: true },
});

const emit = defineEmits(["close"]);

const materials = ref([]);
const loading = ref(false);
const loadError = ref("");

const pendingFile = ref(null);
const uploading = ref(false);
const uploadError = ref("");

const deletingId = ref(null);
const actionError = ref("");

function formatBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return "-";
  if (v < 1024) return `${v} B`;
  const kb = v / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(1)} GB`;
}

function formatDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}

async function load() {
  loading.value = true;
  loadError.value = "";
  try {
    const r = await apiFetch(`/api/courses/${props.course.id}/materials`);
    if (!r.ok) {
      loadError.value = `Could not load materials (HTTP ${r.status}).`;
      materials.value = [];
      return;
    }
    const data = await r.json();
    materials.value = Array.isArray(data.materials) ? data.materials : [];
  } catch {
    loadError.value = "Cannot reach the API.";
    materials.value = [];
  } finally {
    loading.value = false;
  }
}

defineExpose({ reload: load });

watch(
  () => props.course.id,
  () => {
    pendingFile.value = null;
    uploadError.value = "";
    actionError.value = "";
    deletingId.value = null;
    load();
  },
  { immediate: true },
);

function onFileChange(e) {
  const input = e.target;
  const f = input?.files?.[0];
  pendingFile.value = f || null;
  uploadError.value = "";
  actionError.value = "";
  if (input) input.value = "";
}

const canUpload = computed(() => Boolean(pendingFile.value) && !uploading.value);

async function upload() {
  if (!pendingFile.value || uploading.value) return;
  uploading.value = true;
  uploadError.value = "";
  actionError.value = "";
  try {
    const fd = new FormData();
    fd.append("file", pendingFile.value);
    const r = await apiFetch(`/api/courses/${props.course.id}/materials`, {
      method: "POST",
      body: fd,
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      uploadError.value = j.error || `Upload failed (${r.status})`;
      return;
    }
    pendingFile.value = null;
    await load();
  } catch {
    uploadError.value = "Cannot reach the server.";
  } finally {
    uploading.value = false;
  }
}

function downloadUrl(m) {
  return `/api/courses/${props.course.id}/materials/${m.id}/download`;
}

async function removeMaterial(m) {
  if (!m?.id || deletingId.value != null) return;
  const name = String(m.title || "this file").trim() || "this file";
  const ok = window.confirm(
    `Delete "${name}"? Any document sections in this course that use this file will be removed. This cannot be undone.`,
  );
  if (!ok) return;
  deletingId.value = m.id;
  actionError.value = "";
  try {
    const r = await apiFetch(`/api/courses/${props.course.id}/materials/${m.id}`, { method: "DELETE" });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      actionError.value = j.error || `Could not delete (HTTP ${r.status}).`;
      return;
    }
    await load();
  } catch {
    actionError.value = "Cannot reach the server.";
  } finally {
    deletingId.value = null;
  }
}

function onKeydown(e) {
  if (e.key === "Escape") emit("close");
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <div
    class="fixed inset-0 z-[101] flex items-center justify-center bg-black/40 p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="course-materials-title"
    @click.self="emit('close')"
  >
    <div
      class="flex max-h-[min(90vh,720px)] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      @click.stop
    >
      <div class="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <div class="min-w-0">
          <h2 id="course-materials-title" class="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Materials
          </h2>
          <p class="mt-0.5 truncate text-sm text-zinc-500 dark:text-zinc-400">
            {{ course.title || "Course" }} - PDFs, docs, and other reference files
          </p>
        </div>
        <button
          type="button"
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:border-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          aria-label="Close"
          @click="emit('close')"
        >
          <XMarkIcon class="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div class="flex shrink-0 flex-col gap-3 border-b border-zinc-200 px-5 py-3 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex min-w-0 flex-1 items-center gap-2">
          <label
            class="cursor-pointer rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Choose file
            <input
              type="file"
              class="sr-only"
              accept=".pdf,.doc,.docx,.txt"
              @change="onFileChange"
            />
          </label>
          <p class="min-w-0 truncate text-sm text-zinc-600 dark:text-zinc-300">
            {{ pendingFile ? pendingFile.name : "No file selected" }}
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <button
            type="button"
            class="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
            :disabled="!canUpload"
            @click="upload"
          >
            {{ uploading ? "Uploading…" : "Upload" }}
          </button>
        </div>
      </div>

      <div v-if="uploadError || actionError" class="shrink-0 px-5 pt-3">
        <p
          class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/50 dark:text-red-100"
          role="alert"
        >
          {{ uploadError || actionError }}
        </p>
      </div>

      <div class="min-h-0 flex-1 overflow-auto px-5 py-3">
        <p v-if="loading" class="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
        <p v-else-if="loadError" class="text-sm text-red-600 dark:text-red-400">{{ loadError }}</p>
        <p v-else-if="materials.length === 0" class="text-sm text-zinc-500 dark:text-zinc-400">
          No materials yet. Upload a PDF or document for this course.
        </p>

        <div v-else class="overflow-x-auto">
          <table class="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr class="border-b border-zinc-200 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                <th class="pb-2 pr-3">File</th>
                <th class="pb-2 pr-3">Type</th>
                <th class="pb-2 pr-3">Size</th>
                <th class="pb-2 pr-3">Uploaded</th>
                <th class="pb-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in materials" :key="m.id" class="border-b border-zinc-100 dark:border-zinc-800">
                <td class="max-w-[320px] py-2 pr-3 align-top text-zinc-900 dark:text-zinc-100">
                  <span class="whitespace-pre-wrap break-words">{{ m.title || "-" }}</span>
                </td>
                <td class="max-w-[220px] py-2 pr-3 align-top text-zinc-500 dark:text-zinc-400">
                  <span class="whitespace-pre-wrap break-words">{{ m.mimeType || "-" }}</span>
                </td>
                <td class="py-2 pr-3 align-top text-zinc-500 dark:text-zinc-400 tabular-nums">
                  {{ formatBytes(m.byteSize) }}
                </td>
                <td class="py-2 pr-3 align-top text-zinc-500 dark:text-zinc-400">
                  {{ formatDate(m.createdAt) }}
                </td>
                <td class="py-2 align-top text-right">
                  <div class="inline-flex items-center gap-2">
                    <a
                      class="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                      :href="downloadUrl(m)"
                    >
                      Download
                    </a>
                    <button
                      type="button"
                      class="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:bg-zinc-900 dark:text-red-300 dark:hover:bg-red-950/40"
                      :disabled="deletingId === m.id"
                      @click="removeMaterial(m)"
                    >
                      {{ deletingId === m.id ? "Deleting…" : "Delete" }}
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

