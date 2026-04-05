<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { MagnifyingGlassIcon, XMarkIcon } from "@heroicons/vue/20/solid";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";

const props = defineProps({
  course: { type: Object, required: true },
});

const emit = defineEmits(["close"]);

const entries = ref([]);
const loadError = ref("");
const loading = ref(false);
const searchQuery = ref("");
/** empty string = all workbooks */
const workbookFilter = ref("");

async function load() {
  loading.value = true;
  loadError.value = "";
  try {
    const r = await fetch(`${API_BASE}/api/courses/${props.course.id}/vocabulary`);
    if (!r.ok) {
      loadError.value = `Could not load vocabulary (HTTP ${r.status}).`;
      entries.value = [];
      return;
    }
    const data = await r.json();
    entries.value = Array.isArray(data.entries) ? data.entries : [];
  } catch {
    loadError.value = "Cannot reach the API.";
    entries.value = [];
  } finally {
    loading.value = false;
  }
}

defineExpose({ reload: load });

watch(
  () => props.course.id,
  () => {
    workbookFilter.value = "";
    searchQuery.value = "";
    load();
  },
  { immediate: true },
);

const workbookOptions = computed(() => {
  const seen = new Map();
  for (const e of entries.value) {
    if (!seen.has(e.workbookId)) {
      seen.set(e.workbookId, e.workbookTitle);
    }
  }
  return [...seen.entries()].map(([id, title]) => ({ id, title }));
});

const filteredEntries = computed(() => {
  let list = entries.value;
  if (workbookFilter.value !== "") {
    const wid = Number(workbookFilter.value);
    list = list.filter((e) => e.workbookId === wid);
  }
  const q = searchQuery.value.trim().toLowerCase();
  if (q) {
    list = list.filter(
      (e) => e.word.toLowerCase().includes(q) || e.meaning.toLowerCase().includes(q),
    );
  }
  return list;
});

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
    aria-labelledby="course-vocab-title"
    @click.self="emit('close')"
  >
    <div
      class="flex max-h-[min(90vh,720px)] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      @click.stop
    >
      <div
        class="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800"
      >
        <div class="min-w-0">
          <h2
            id="course-vocab-title"
            class="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
          >
            Vocabulary
          </h2>
          <p class="mt-0.5 truncate text-sm text-zinc-500 dark:text-zinc-400">
            {{ course.title || "Course" }} — words from all vocabulary sections, in order added
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

      <div
        class="flex shrink-0 flex-col gap-3 border-b border-zinc-200 px-5 py-3 dark:border-zinc-800 sm:flex-row sm:flex-wrap sm:items-center"
      >
        <div class="relative min-w-0 flex-1 sm:max-w-xs">
          <MagnifyingGlassIcon
            class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
            aria-hidden="true"
          />
          <input
            v-model="searchQuery"
            type="search"
            placeholder="Search word or meaning…"
            class="w-full rounded-lg border border-zinc-300 bg-white py-2 pl-9 pr-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
            autocomplete="off"
          />
        </div>
        <div class="flex min-w-0 items-center gap-2 sm:w-56">
          <label for="vocab-workbook-filter" class="sr-only">Filter by workbook</label>
          <select
            id="vocab-workbook-filter"
            v-model="workbookFilter"
            class="w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-2 py-2 text-sm text-zinc-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
          >
            <option value="">All workbooks</option>
            <option v-for="w in workbookOptions" :key="w.id" :value="String(w.id)">
              {{ w.title }}
            </option>
          </select>
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-auto px-5 py-3">
        <p v-if="loading" class="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
        <p v-else-if="loadError" class="text-sm text-red-600 dark:text-red-400">{{ loadError }}</p>
        <p
          v-else-if="entries.length === 0"
          class="text-sm text-zinc-500 dark:text-zinc-400"
        >
          No vocabulary yet. Add vocabulary sections to workbooks in this course.
        </p>
        <div v-else class="overflow-x-auto">
          <table class="w-full min-w-[480px] border-collapse text-sm">
            <thead>
              <tr
                class="border-b border-zinc-200 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
              >
                <th class="w-12 pb-2 pr-3">#</th>
                <th class="pb-2 pr-3">Word</th>
                <th class="pb-2 pr-3">Meaning</th>
                <th class="pb-2">Workbook</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in filteredEntries"
                :key="row.order"
                class="border-b border-zinc-100 dark:border-zinc-800"
              >
                <td class="py-2 pr-3 align-top text-zinc-400 tabular-nums dark:text-zinc-500">
                  {{ row.order + 1 }}
                </td>
                <td class="max-w-[200px] py-2 pr-3 align-top text-zinc-900 dark:text-zinc-100">
                  <span class="whitespace-pre-wrap break-words">{{ row.word || "—" }}</span>
                </td>
                <td class="max-w-[240px] py-2 pr-3 align-top text-zinc-800 dark:text-zinc-200">
                  <span class="whitespace-pre-wrap break-words">{{ row.meaning || "—" }}</span>
                </td>
                <td class="max-w-[160px] py-2 align-top text-zinc-500 dark:text-zinc-400">
                  <span class="line-clamp-2 break-words" :title="row.workbookTitle">{{
                    row.workbookTitle
                  }}</span>
                </td>
              </tr>
            </tbody>
          </table>
          <p
            v-if="!loading && !loadError && filteredEntries.length === 0 && entries.length > 0"
            class="mt-3 text-sm text-zinc-500 dark:text-zinc-400"
          >
            No entries match your search or filter.
          </p>
        </div>
      </div>

      <div
        v-if="entries.length > 0 && !loading"
        class="shrink-0 border-t border-zinc-200 px-5 py-2 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400"
      >
        Showing {{ filteredEntries.length }} of {{ entries.length }} entries
      </div>
    </div>
  </div>
</template>
