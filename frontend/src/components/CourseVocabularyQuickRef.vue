<script setup>
import { ref, computed, watch } from "vue";
import { apiFetch } from "../api/client.js";

const props = defineProps({
  courseId: { type: Number, required: true },
});

const PAGE_SIZE = 14;

const entries = ref([]);
const loadError = ref("");
const loading = ref(false);
const searchQuery = ref("");
const page = ref(1);

async function load() {
  loading.value = true;
  loadError.value = "";
  try {
    const r = await apiFetch(`/api/courses/${props.courseId}/vocabulary`);
    if (!r.ok) {
      loadError.value = `Could not load (${r.status})`;
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
  () => props.courseId,
  () => {
    searchQuery.value = "";
    page.value = 1;
    load();
  },
  { immediate: true },
);

watch(searchQuery, () => {
  page.value = 1;
});

const filtered = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  let list = entries.value;
  if (q) {
    list = list.filter(
      (e) =>
        (e.word || "").toLowerCase().includes(q) ||
        (e.meaning || "").toLowerCase().includes(q),
    );
  }
  return list;
});

const totalPages = computed(() =>
  Math.max(1, Math.ceil(filtered.value.length / PAGE_SIZE)),
);

const pageSlice = computed(() => {
  const p = Math.min(page.value, totalPages.value);
  const start = (p - 1) * PAGE_SIZE;
  return filtered.value.slice(start, start + PAGE_SIZE);
});

watch(totalPages, (tp) => {
  if (page.value > tp) page.value = tp;
});

function prevPage() {
  page.value = Math.max(1, page.value - 1);
}

function nextPage() {
  page.value = Math.min(totalPages.value, page.value + 1);
}
</script>

<template>
  <div
    class="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-2xl border border-zinc-200/90 bg-white/95 shadow-lg shadow-zinc-900/10 ring-1 ring-black/5 backdrop-blur-md dark:border-zinc-600/80 dark:bg-zinc-900/95 dark:shadow-black/40 dark:ring-white/10"
    role="region"
    aria-label="Course vocabulary"
  >
    <div
      class="shrink-0 border-b border-zinc-200/80 px-2 py-2 dark:border-zinc-700/80"
    >
      <h2
        class="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
      >
        Vocabulary
      </h2>
      <label class="sr-only" for="qa-vocab-search">Search vocabulary</label>
      <input
        id="qa-vocab-search"
        v-model="searchQuery"
        type="search"
        autocomplete="off"
        placeholder="Search…"
        class="mt-1.5 w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-[11px] text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
      />
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-1 py-1">
      <p
        v-if="loadError"
        class="px-1 py-2 text-[11px] text-red-600 dark:text-red-400"
        role="alert"
      >
        {{ loadError }}
      </p>
      <p
        v-else-if="loading"
        class="px-1 py-3 text-center text-[11px] text-zinc-500 dark:text-zinc-400"
      >
        Loading…
      </p>
      <p
        v-else-if="filtered.length === 0"
        class="px-1 py-3 text-center text-[11px] leading-snug text-zinc-500 dark:text-zinc-400"
      >
        No vocabulary rows yet.
      </p>
      <table v-else class="w-full border-collapse text-left text-[11px]">
        <thead>
          <tr
            class="border-b border-zinc-200 text-[10px] font-medium uppercase text-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
          >
            <th class="w-[45%] py-1 pl-1 pr-0.5">Word</th>
            <th class="py-1 pr-1">Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, i) in pageSlice"
            :key="`${row.entryId ?? 'e'}-${i}`"
            class="border-b border-zinc-100 last:border-0 dark:border-zinc-800"
          >
            <td
              class="max-w-0 py-0.5 pl-1 pr-0.5 align-top text-zinc-900 dark:text-zinc-100"
            >
              <span class="line-clamp-3 break-words">{{
                row.word || "-"
              }}</span>
            </td>
            <td
              class="max-w-0 py-0.5 pr-1 align-top text-zinc-700 dark:text-zinc-300"
            >
              <span class="line-clamp-3 break-words">{{
                row.meaning || "-"
              }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div
      v-if="!loading && !loadError && totalPages > 1"
      class="flex shrink-0 items-center justify-between gap-1 border-t border-zinc-200/80 px-1.5 py-1 dark:border-zinc-700/80"
    >
      <button
        type="button"
        class="rounded px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 enabled:hover:underline disabled:opacity-30 dark:text-indigo-400"
        :disabled="page <= 1"
        @click="prevPage"
      >
        Prev
      </button>
      <span
        class="min-w-0 truncate text-center text-[10px] text-zinc-500 dark:text-zinc-400"
      >
        {{ page }} / {{ totalPages }}
      </span>
      <button
        type="button"
        class="rounded px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 enabled:hover:underline disabled:opacity-30 dark:text-indigo-400"
        :disabled="page >= totalPages"
        @click="nextPage"
      >
        Next
      </button>
    </div>
  </div>
</template>
