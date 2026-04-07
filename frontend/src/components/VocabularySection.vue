<script setup>
import { ref, watch, computed } from "vue";
import { XMarkIcon } from "@heroicons/vue/20/solid";
import { apiFetch } from "../api/client.js";

const section = defineModel({ type: Object, required: true });

const props = defineProps({
  courseId: { type: Number, required: true },
  /** Full workbook sections - used to count how many rows reference a vocabulary entry */
  allSections: { type: Array, default: () => [] },
  /** Save workbook immediately (clears debounce); used before deleting an unused DB entry */
  persistWorkbook: { type: Function, default: null },
  /** Called after a vocabulary entry is created/updated/deleted (to refresh right panel) */
  onVocabularyChanged: { type: Function, default: null },
});

/** How many vocabulary rows reference this entry (whole workbook, or this section if no workbook list) */
function countEntryRefs(entryId) {
  const eid = Number(entryId);
  if (!Number.isFinite(eid)) return 0;
  let n = 0;
  const globalList =
    Array.isArray(props.allSections) && props.allSections.length > 0
      ? props.allSections
      : null;
  if (globalList) {
    for (const s of globalList) {
      if (s.type !== "vocabulary") continue;
      const ids = Array.isArray(s.entryIds) ? s.entryIds : [];
      for (const id of ids) {
        if (Number(id) === eid) n++;
      }
    }
  } else {
    for (const id of entryIds.value) {
      if (Number(id) === eid) n++;
    }
  }
  return n;
}

function wordFieldTitle(entryId) {
  return countEntryRefs(entryId) > 1
    ? "This word is linked elsewhere - changing it only affects this row"
    : "Change the word for this course entry (only used in this workbook once)";
}

function notifyVocabularyChanged() {
  if (typeof props.onVocabularyChanged === "function") {
    try {
      props.onVocabularyChanged();
    } catch {
      /* ignore */
    }
  }
}

/** @type {import('vue').Ref<Map<number, { word: string, meaning: string }>>} */
const cache = ref(new Map());
/** Last saved server state per entry - meaning PATCH only when word matches snapshot */
const snapshot = ref(new Map());
const drafts = ref([]);

async function loadCache(ids) {
  const unique = [...new Set(ids.filter((x) => Number.isFinite(x)))];
  if (unique.length === 0) return;
  try {
    const r = await apiFetch(
      `/api/courses/${props.courseId}/vocabulary-entries?ids=${unique.join(",")}`,
    );
    if (!r.ok) return;
    const data = await r.json();
    const list = Array.isArray(data.entries) ? data.entries : [];
    const m = new Map(cache.value);
    const snap = new Map(snapshot.value);
    for (const e of list) {
      const row = { word: e.word ?? "", meaning: e.meaning ?? "" };
      m.set(e.id, row);
      snap.set(e.id, { ...row });
    }
    cache.value = m;
    snapshot.value = snap;
  } catch {
    /* ignore */
  }
}

watch(
  () => [...(section.value.entryIds || [])],
  (ids) => {
    loadCache(ids);
  },
  { immediate: true },
);

const entryIds = computed({
  get() {
    if (!Array.isArray(section.value.entryIds)) section.value.entryIds = [];
    return section.value.entryIds;
  },
  set(v) {
    section.value.entryIds = v;
  },
});

function addDraft() {
  drafts.value.push({
    key: crypto.randomUUID(),
    word: "",
    meaning: "",
    suggestions: [],
  });
}

async function removeAt(index) {
  const n = entryIds.value.length;
  if (index < n) {
    const entryId = entryIds.value[index];
    const refs = countEntryRefs(entryId);
    const idNum = Number(entryId);
    const prevTimer = meaningPatchTimers.get(idNum);
    if (prevTimer) clearTimeout(prevTimer);
    meaningPatchTimers.delete(idNum);

    const ids = [...entryIds.value];
    ids.splice(index, 1);
    entryIds.value = ids;

    if (refs === 1 && Number.isFinite(idNum)) {
      if (typeof props.persistWorkbook === "function") {
        await props.persistWorkbook();
      }
      try {
        const r = await apiFetch(
          `/api/courses/${props.courseId}/vocabulary-entries/${idNum}`,
          {
            method: "DELETE",
          },
        );
        if (r.ok) {
          const m = new Map(cache.value);
          m.delete(idNum);
          cache.value = m;
          const sn = new Map(snapshot.value);
          sn.delete(idNum);
          snapshot.value = sn;
          notifyVocabularyChanged();
        }
      } catch {
        /* ignore */
      }
    }
    if (refs > 1) notifyVocabularyChanged();
    return;
  }
  const d = index - n;
  if (d >= 0 && d < drafts.value.length) {
    drafts.value.splice(d, 1);
  }
}

let searchTimer = null;
function scheduleDraftSearch(draft) {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runDraftSearch(draft), 280);
}

async function runDraftSearch(draft) {
  const q = String(draft.word ?? "").trim();
  if (q.length < 1) {
    draft.suggestions = [];
    return;
  }
  try {
    const r = await apiFetch(
      `/api/courses/${props.courseId}/vocabulary-entries?q=${encodeURIComponent(q)}&limit=15`,
    );
    if (!r.ok) return;
    const data = await r.json();
    if (!drafts.value.includes(draft)) return;
    draft.suggestions = Array.isArray(data.entries) ? data.entries : [];
  } catch {
    if (drafts.value.includes(draft)) draft.suggestions = [];
  }
}

const meaningPatchTimers = new Map();
function scheduleMeaningPatch(entryId) {
  const prev = meaningPatchTimers.get(entryId);
  if (prev) clearTimeout(prev);
  const t = setTimeout(() => {
    meaningPatchTimers.delete(entryId);
    flushMeaningPatch(entryId);
  }, 450);
  meaningPatchTimers.set(entryId, t);
}

/** Updates shared meaning only when the word still matches the saved snapshot */
async function flushMeaningPatch(entryId) {
  const cur = cache.value.get(entryId);
  const snap = snapshot.value.get(entryId);
  if (!cur || !snap) return;
  if (cur.word.trim().toLowerCase() !== snap.word.trim().toLowerCase()) {
    return;
  }
  if (cur.meaning === snap.meaning) return;
  try {
    const r = await apiFetch(
      `/api/courses/${props.courseId}/vocabulary-entries/${entryId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meaning: cur.meaning }),
      },
    );
    if (!r.ok) return;
    const data = await r.json();
    const m = new Map(cache.value);
    m.set(entryId, {
      word: data.word ?? cur.word,
      meaning: data.meaning ?? cur.meaning,
    });
    cache.value = m;
    const sn = new Map(snapshot.value);
    sn.set(entryId, { word: snap.word, meaning: data.meaning ?? cur.meaning });
    snapshot.value = sn;
    notifyVocabularyChanged();
  } catch {
    await loadCache([entryId]);
  }
}

/** Changing the word creates/links a new entry; the previous entry is unchanged elsewhere */
async function onWordBlur(entryId, rowIndex) {
  const cur = cache.value.get(entryId);
  if (!cur) return;
  if (!snapshot.value.has(entryId)) {
    await loadCache([entryId]);
  }
  const snap = snapshot.value.get(entryId);
  const w = cur.word.trim();
  if (!w) {
    await loadCache([entryId]);
    return;
  }
  if (snap && w.toLowerCase() === snap.word.trim().toLowerCase()) {
    return;
  }
  if (!snap) {
    return;
  }
  if (entryIds.value[rowIndex] !== entryId) return;
  const prevTimer = meaningPatchTimers.get(entryId);
  if (prevTimer) clearTimeout(prevTimer);
  meaningPatchTimers.delete(entryId);

  const refs = countEntryRefs(entryId);
  if (refs <= 1) {
    try {
      const r = await apiFetch(
        `/api/courses/${props.courseId}/vocabulary-entries/${entryId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ word: w, meaning: cur.meaning.trim() }),
        },
      );
      if (!r.ok) {
        if (r.status === 409) await loadCache([entryId]);
        return;
      }
      const data = await r.json();
      const m = new Map(cache.value);
      m.set(entryId, {
        word: data.word ?? w,
        meaning: data.meaning ?? cur.meaning,
      });
      cache.value = m;
      const sn = new Map(snapshot.value);
      sn.set(entryId, {
        word: data.word ?? w,
        meaning: data.meaning ?? cur.meaning,
      });
      snapshot.value = sn;
      notifyVocabularyChanged();
    } catch {
      await loadCache([entryId]);
    }
    return;
  }

  try {
    const r = await apiFetch(
      `/api/courses/${props.courseId}/vocabulary-entries`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word: w, meaning: cur.meaning.trim() }),
      },
    );
    if (!r.ok) return;
    const data = await r.json();
    const newId = Number(data.id);
    if (!Number.isFinite(newId)) return;
    if (entryIds.value[rowIndex] !== entryId) return;
    const ids = [...entryIds.value];
    ids[rowIndex] = newId;
    entryIds.value = ids;
    const m = new Map(cache.value);
    if (newId !== entryId) {
      m.delete(entryId);
    }
    m.set(newId, {
      word: data.word ?? w,
      meaning: data.meaning ?? cur.meaning,
    });
    cache.value = m;
    const sn = new Map(snapshot.value);
    sn.delete(entryId);
    sn.set(newId, {
      word: data.word ?? w,
      meaning: data.meaning ?? cur.meaning,
    });
    snapshot.value = sn;
    notifyVocabularyChanged();
  } catch {
    await loadCache([entryId]);
  }
}

async function commitDraft(draft) {
  if (!drafts.value.includes(draft)) return;
  const w = String(draft.word ?? "").trim();
  const m = String(draft.meaning ?? "").trim();
  if (!w) {
    const i = drafts.value.indexOf(draft);
    if (i >= 0) drafts.value.splice(i, 1);
    return;
  }

  const qLower = w.toLowerCase();
  const exact = (draft.suggestions || []).find(
    (s) => s.word && s.word.trim().toLowerCase() === qLower,
  );
  if (exact) {
    entryIds.value.push(exact.id);
    entryIds.value = [...entryIds.value];
    const i = drafts.value.indexOf(draft);
    if (i >= 0) drafts.value.splice(i, 1);
    await loadCache([exact.id]);
    notifyVocabularyChanged();
    return;
  }

  try {
    const r = await apiFetch(
      `/api/courses/${props.courseId}/vocabulary-entries`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word: w, meaning: m }),
      },
    );
    if (!r.ok) return;
    const data = await r.json();
    const id = data.id;
    if (!Number.isFinite(Number(id))) return;
    entryIds.value.push(Number(id));
    entryIds.value = [...entryIds.value];
    const i = drafts.value.indexOf(draft);
    if (i >= 0) drafts.value.splice(i, 1);
    await loadCache([Number(id)]);
    notifyVocabularyChanged();
  } catch {
    /* ignore */
  }
}

/** Skip commit when tabbing Word → Meaning so focus isn’t lost mid-entry */
function onDraftWordBlur(draft, e) {
  const next = e?.relatedTarget;
  if (
    next instanceof HTMLElement &&
    next.getAttribute("data-draft-meaning-for") === draft.key
  ) {
    return;
  }
  commitDraft(draft);
}

function onDraftMeaningBlur(draft) {
  commitDraft(draft);
}

function pickSuggestion(draft, entry) {
  draft.word = entry.word;
  draft.meaning = entry.meaning ?? "";
  commitDraft(draft);
}

function onWordInput(entryId, e) {
  const v = e.target.value;
  const m = new Map(cache.value);
  const cur = m.get(entryId) || { word: "", meaning: "" };
  m.set(entryId, { ...cur, word: v });
  cache.value = m;
}

function onMeaningInput(entryId, e) {
  const v = e.target.value;
  const m = new Map(cache.value);
  const cur = m.get(entryId) || { word: "", meaning: "" };
  m.set(entryId, { ...cur, meaning: v });
  cache.value = m;
  scheduleMeaningPatch(entryId);
}

watch(
  () => [entryIds.value.length, drafts.value.length],
  () => {
    if (entryIds.value.length === 0 && drafts.value.length === 0) {
      addDraft();
    }
  },
  { immediate: true },
);
</script>

<template>
  <div
    class="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
  >
    <div class="overflow-x-auto p-3">
      <table class="w-full min-w-[320px] border-collapse text-sm">
        <thead>
          <tr
            class="border-b border-zinc-200 text-left text-xs font-medium uppercase text-zinc-500 dark:border-zinc-700"
          >
            <th class="pb-2 pr-2">Word</th>
            <th class="pb-2 pr-2">Meaning</th>
            <th class="w-10 pb-2" />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(entryId, i) in entryIds"
            :key="'e-' + entryId"
            class="border-b border-zinc-100 last:border-0 dark:border-zinc-800"
          >
            <td class="py-1.5 pr-2 align-top">
              <input
                type="text"
                class="w-full rounded border border-zinc-200 bg-white px-2 py-1.5 text-zinc-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                placeholder="Word"
                :value="cache.get(entryId)?.word ?? ''"
                :title="wordFieldTitle(entryId)"
                @input="onWordInput(entryId, $event)"
                @blur="onWordBlur(entryId, i)"
              />
            </td>
            <td class="py-1.5 pr-2 align-top">
              <input
                type="text"
                class="w-full rounded border border-zinc-200 bg-white px-2 py-1.5 text-zinc-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                placeholder="Meaning"
                title="Updates the shared definition for this word everywhere it appears"
                :value="cache.get(entryId)?.meaning ?? ''"
                @input="onMeaningInput(entryId, $event)"
              />
            </td>
            <td class="py-1.5 align-top">
              <button
                type="button"
                class="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800"
                aria-label="Remove row"
                @click="removeAt(i)"
              >
                <XMarkIcon class="h-4 w-4" aria-hidden="true" />
              </button>
            </td>
          </tr>
          <tr
            v-for="(draft, di) in drafts"
            :key="'d-' + draft.key"
            class="border-b border-zinc-100 last:border-0 dark:border-zinc-800"
          >
            <td class="relative py-1.5 pr-2 align-top">
              <input
                v-model="draft.word"
                type="text"
                class="w-full rounded border border-zinc-200 bg-white px-2 py-1.5 text-zinc-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                placeholder="Word"
                autocomplete="off"
                @input="scheduleDraftSearch(draft)"
                @blur="onDraftWordBlur(draft, $event)"
              />
              <ul
                v-if="draft.suggestions.length > 0 && draft.word.trim()"
                class="absolute left-0 right-0 top-full z-20 mt-0.5 max-h-36 overflow-y-auto rounded-md border border-zinc-200 bg-white py-0.5 shadow-lg dark:border-zinc-600 dark:bg-zinc-900"
              >
                <li
                  v-for="s in draft.suggestions"
                  :key="s.id"
                  class="cursor-pointer px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-zinc-100 dark:text-indigo-300 dark:hover:bg-zinc-800"
                  @mousedown.prevent="pickSuggestion(draft, s)"
                >
                  {{ s.word }}
                  <span class="font-normal text-zinc-500 dark:text-zinc-400">
                    - {{ s.meaning }}</span
                  >
                </li>
              </ul>
            </td>
            <td class="py-1.5 pr-2 align-top">
              <input
                v-model="draft.meaning"
                type="text"
                class="w-full rounded border border-zinc-200 bg-white px-2 py-1.5 text-zinc-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                placeholder="Meaning"
                :data-draft-meaning-for="draft.key"
                @blur="onDraftMeaningBlur(draft)"
              />
            </td>
            <td class="py-1.5 align-top">
              <button
                type="button"
                class="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800"
                aria-label="Remove row"
                @click="removeAt(entryIds.length + di)"
              >
                <XMarkIcon class="h-4 w-4" aria-hidden="true" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <button
        type="button"
        class="mt-3 rounded-md border border-zinc-300 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
        @click="addDraft"
      >
        Add word
      </button>
    </div>
  </div>
</template>
