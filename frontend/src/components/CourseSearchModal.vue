<script setup>
import { ref, watch, onMounted, onUnmounted } from "vue";
import { MagnifyingGlassIcon, XMarkIcon } from "@heroicons/vue/20/solid";
import { apiFetch } from "../api/client.js";

const props = defineProps({
  course: { type: Object, required: true },
});

const emit = defineEmits(["close", "select-result"]);

const query = ref("");
const results = ref([]);
const loading = ref(false);
const error = ref("");
let debounceTimer = null;
let abortController = null;

const DEBOUNCE_MS = 320;

async function runSearch(q) {
  const trimmed = q.trim();
  if (trimmed.length < 2) {
    results.value = [];
    error.value = "";
    return;
  }
  if (abortController) abortController.abort();
  abortController = new AbortController();
  const signal = abortController.signal;
  loading.value = true;
  error.value = "";
  try {
    const params = new URLSearchParams({ q: trimmed });
    const r = await apiFetch(
      `/api/courses/${props.course.id}/search?${params}`,
      {
        signal,
      },
    );
    if (!r.ok) {
      error.value = `Search failed (${r.status}).`;
      results.value = [];
      return;
    }
    const data = await r.json();
    results.value = Array.isArray(data.results) ? data.results : [];
  } catch (e) {
    if (e.name === "AbortError") return;
    error.value = "Cannot reach the API.";
    results.value = [];
  } finally {
    loading.value = false;
  }
}

function scheduleSearch() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    runSearch(query.value);
  }, DEBOUNCE_MS);
}

watch(query, () => {
  scheduleSearch();
});

watch(
  () => props.course.id,
  () => {
    query.value = "";
    results.value = [];
    error.value = "";
  },
);

function onKeydown(e) {
  if (e.key === "Escape") emit("close");
}

function pickResult(row) {
  emit("select-result", {
    workbookId: row.workbookId,
    sectionId: row.sectionId,
  });
  emit("close");
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
  if (debounceTimer) clearTimeout(debounceTimer);
  if (abortController) abortController.abort();
});
</script>

<template>
  <div
    class="fixed inset-0 z-101 flex items-center justify-center bg-black/40 p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="course-search-title"
    @click.self="emit('close')"
  >
    <div
      class="flex max-h-[min(90vh,640px)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      @click.stop
    >
      <div
        class="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-700"
      >
        <h2
          id="course-search-title"
          class="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
        >
          Search course
        </h2>
        <button
          type="button"
          class="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          aria-label="Close"
          @click="emit('close')"
        >
          <XMarkIcon class="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      <div
        class="shrink-0 border-b border-zinc-200 px-4 py-3 dark:border-zinc-700"
      >
        <label class="sr-only" for="course-search-input">Search</label>
        <div class="relative">
          <MagnifyingGlassIcon
            class="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-400"
            aria-hidden="true"
          />
          <input
            id="course-search-input"
            v-model="query"
            type="search"
            autocomplete="off"
            class="w-full rounded-lg border border-zinc-300 bg-white py-2.5 pl-10 pr-3 text-sm text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
            placeholder="Type at least 2 characters…"
            autofocus
          />
        </div>
        <p class="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          Searches section text across all workbooks in
          <span class="font-medium text-zinc-700 dark:text-zinc-300">{{
            course.title || "this course"
          }}</span
          >.
        </p>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <p
          v-if="error"
          class="px-2 py-2 text-sm text-red-600 dark:text-red-400"
          role="alert"
        >
          {{ error }}
        </p>
        <p
          v-else-if="query.trim().length > 0 && query.trim().length < 2"
          class="px-2 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400"
        >
          Enter at least 2 characters.
        </p>
        <p
          v-else-if="
            !loading && query.trim().length >= 2 && results.length === 0
          "
          class="px-2 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400"
        >
          No sections match.
        </p>
        <ul v-else class="divide-y divide-zinc-100 dark:divide-zinc-800">
          <li
            v-for="(row, i) in results"
            :key="`${row.workbookId}-${row.sectionId}-${i}`"
          >
            <button
              type="button"
              class="flex w-full flex-col gap-1 rounded-lg px-3 py-3 text-left text-sm transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
              @click="pickResult(row)"
            >
              <span class="font-medium text-zinc-900 dark:text-zinc-100">{{
                row.workbookTitle || "Workbook"
              }}</span>
              <span
                class="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
                >{{ row.sectionType }}</span
              >
              <span class="line-clamp-2 text-zinc-600 dark:text-zinc-300">{{
                row.snippet
              }}</span>
            </button>
          </li>
        </ul>
        <p v-if="loading" class="px-2 py-4 text-center text-sm text-zinc-500">
          Searching…
        </p>
      </div>
    </div>
  </div>
</template>
