<script setup>
import { ref, watch, onMounted, onUnmounted } from "vue";
import { XMarkIcon } from "@heroicons/vue/20/solid";
import { apiFetch } from "../api/client.js";
import "@vueup/vue-quill/dist/vue-quill.snow.css";

const props = defineProps({
  workbookId: { type: Number, required: true },
  sectionId: { type: String, required: true },
  /** Pin label shown in the dialog title */
  label: { type: String, default: "" },
});

const emit = defineEmits(["close", "open-in-workbook"]);

const loading = ref(true);
const error = ref("");
const workbookTitle = ref("");
const section = ref(null);
/** Resolved vocabulary rows when section.type === 'vocabulary' */
const vocabRows = ref([]);

let abortController = null;

const TYPE_LABELS = {
  header: "Header",
  translation: "Translation",
  vocabulary: "Vocabulary",
  grammar: "Grammar",
  video: "Video",
};

function sectionTypeLabel(sec) {
  if (!sec?.type) return "Section";
  return (
    TYPE_LABELS[sec.type] ||
    sec.type.charAt(0).toUpperCase() + sec.type.slice(1)
  );
}

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

function toYouTubeEmbed(raw) {
  const u = normalizeUrl(raw);
  if (!u || !/^https?:\/\//i.test(u)) return null;
  let url;
  try {
    url = new URL(u);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./i, "").toLowerCase();
  let id = null;
  if (host === "youtu.be") {
    id = url.pathname.replace(/^\//, "") || null;
  } else if (host === "youtube.com" || host === "m.youtube.com") {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else if (url.pathname.startsWith("/embed/"))
      id = url.pathname.split("/")[2] || null;
    else if (url.pathname.startsWith("/shorts/"))
      id = url.pathname.split("/")[2] || null;
  }

  if (!id) return null;
  id = id.split("?")[0].split("&")[0].trim();
  if (!/^[A-Za-z0-9_-]{6,}$/.test(id)) return null;

  const start = url.searchParams.get("t") || url.searchParams.get("start");
  const embed = new URL(`https://www.youtube-nocookie.com/embed/${id}`);
  if (start && /^\d+$/.test(String(start)))
    embed.searchParams.set("start", String(start));
  return embed.toString();
}

async function load() {
  loading.value = true;
  error.value = "";
  section.value = null;
  workbookTitle.value = "";
  if (abortController) abortController.abort();
  abortController = new AbortController();
  const { signal } = abortController;
  try {
    const r = await apiFetch(`/api/workbooks/${props.workbookId}`, { signal });
    if (!r.ok) throw new Error(`Failed to load workbook (${r.status}).`);
    const w = await r.json();
    if (signal.aborted) return;
    workbookTitle.value = w.title || "Untitled";
    const list = Array.isArray(w.sections) ? w.sections : [];
    const sec = list.find((s) => s.id === props.sectionId);
    if (!sec) {
      error.value = "This section no longer exists in that workbook.";
      return;
    }
    section.value = sec;
    vocabRows.value = [];
    if (sec.type === "vocabulary" && w.courseId) {
      const ids = Array.isArray(sec.entryIds)
        ? sec.entryIds.map((x) => Number(x)).filter((x) => Number.isFinite(x))
        : [];
      if (ids.length > 0) {
        const r2 = await apiFetch(
          `/api/courses/${w.courseId}/vocabulary-entries?ids=${ids.join(",")}`,
          { signal },
        );
        if (r2.ok) {
          const d2 = await r2.json();
          const list = Array.isArray(d2.entries) ? d2.entries : [];
          const byId = new Map(list.map((e) => [e.id, e]));
          vocabRows.value = ids.map((id) => byId.get(id)).filter(Boolean);
        }
      }
    }
  } catch (e) {
    if (e.name === "AbortError") return;
    error.value = e.message || "Could not load section.";
  } finally {
    if (!signal.aborted) loading.value = false;
  }
}

watch(
  () => [props.workbookId, props.sectionId],
  () => {
    load();
  },
  { immediate: true },
);

function onKeydown(e) {
  if (e.key === "Escape") emit("close");
}

function openInWorkbook() {
  emit("open-in-workbook", {
    workbookId: props.workbookId,
    sectionId: props.sectionId,
  });
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
  if (abortController) abortController.abort();
});
</script>

<template>
  <div
    class="fixed inset-0 z-102 flex items-center justify-center bg-black/40 p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="pin-preview-title"
    @click.self="emit('close')"
  >
    <div
      class="flex max-h-[min(90vh,720px)] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      @click.stop
    >
      <div
        class="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-700"
      >
        <div class="min-w-0">
          <h2
            id="pin-preview-title"
            class="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
          >
            {{ label || "Quick access" }}
          </h2>
          <p class="mt-0.5 truncate text-sm text-zinc-500 dark:text-zinc-400">
            {{ workbookTitle }}
            <span v-if="section" class="text-zinc-400 dark:text-zinc-500">
              · {{ sectionTypeLabel(section) }}
            </span>
          </p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-md p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          aria-label="Close"
          @click="emit('close')"
        >
          <XMarkIcon class="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <p
          v-if="loading"
          class="text-center text-sm text-zinc-500 dark:text-zinc-400"
        >
          Loading…
        </p>
        <p
          v-else-if="error"
          class="text-sm text-red-600 dark:text-red-400"
          role="alert"
        >
          {{ error }}
        </p>

        <template v-else-if="section">
          <div
            v-if="section.type === 'header'"
            class="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-base font-semibold text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          >
            {{ section.text || "-" }}
          </div>

          <div
            v-else-if="section.type === 'translation'"
            class="grid gap-4 sm:grid-cols-2"
          >
            <div>
              <p
                class="mb-1 text-xs font-medium uppercase text-zinc-500 dark:text-zinc-400"
              >
                Source
                <span
                  v-if="section.sourceLang"
                  class="font-normal normal-case text-zinc-400"
                >
                  ({{ section.sourceLang }})
                </span>
              </p>
              <pre
                class="whitespace-pre-wrap wrap-break-word rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                >{{ section.sourceText || "-" }}</pre
              >
            </div>
            <div>
              <p
                class="mb-1 text-xs font-medium uppercase text-zinc-500 dark:text-zinc-400"
              >
                Translation
                <span
                  v-if="section.targetLang"
                  class="font-normal normal-case text-zinc-400"
                >
                  ({{ section.targetLang }})
                </span>
              </p>
              <pre
                class="whitespace-pre-wrap wrap-break-word rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                >{{ section.translationText || "-" }}</pre
              >
            </div>
          </div>

          <div
            v-else-if="section.type === 'vocabulary'"
            class="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900"
          >
            <table class="w-full min-w-[280px] border-collapse text-sm">
              <thead>
                <tr
                  class="border-b border-zinc-200 text-left text-xs font-medium uppercase text-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
                >
                  <th class="px-3 py-2">Word</th>
                  <th class="px-3 py-2">Meaning</th>
                </tr>
              </thead>
              <tbody>
                <template v-if="vocabRows.length === 0">
                  <tr>
                    <td
                      colspan="2"
                      class="px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400"
                    >
                      No words in this section.
                    </td>
                  </tr>
                </template>
                <template v-else>
                  <tr
                    v-for="(row, i) in vocabRows"
                    :key="row.id || i"
                    class="border-b border-zinc-100 last:border-0 dark:border-zinc-800"
                  >
                    <td
                      class="px-3 py-2 align-top text-zinc-900 dark:text-zinc-100"
                    >
                      {{ row.word || "-" }}
                    </td>
                    <td
                      class="px-3 py-2 align-top text-zinc-900 dark:text-zinc-100"
                    >
                      {{ row.meaning || "-" }}
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>

          <div v-else-if="section.type === 'video'">
            <div
              class="overflow-hidden rounded-xl border border-zinc-200 bg-black dark:border-zinc-700"
            >
              <div
                v-if="toYouTubeEmbed(section.url)"
                class="aspect-video w-full"
              >
                <iframe
                  class="h-full w-full"
                  :src="toYouTubeEmbed(section.url)"
                  title="YouTube video"
                  frameborder="0"
                  allow="
                    accelerometer;
                    autoplay;
                    clipboard-write;
                    encrypted-media;
                    gyroscope;
                    picture-in-picture;
                    web-share;
                  "
                  referrerpolicy="strict-origin-when-cross-origin"
                  allowfullscreen
                />
              </div>
              <div
                v-else
                class="flex aspect-video w-full items-center justify-center bg-zinc-900 px-4 text-sm text-zinc-200"
              >
                Video link is missing or invalid.
              </div>
            </div>
          </div>

          <div
            v-else
            class="grammar-quill rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <div class="ql-snow">
              <div
                class="ql-editor max-w-none text-sm text-zinc-900 dark:text-zinc-100"
                v-html="section.text || '<p>-</p>'"
              />
            </div>
          </div>
        </template>
      </div>

      <div
        class="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-zinc-200 px-4 py-3 dark:border-zinc-700"
      >
        <button
          type="button"
          class="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          @click="openInWorkbook"
        >
          Open in workbook
        </button>
        <button
          type="button"
          class="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          @click="emit('close')"
        >
          Close
        </button>
      </div>
    </div>
  </div>
</template>
