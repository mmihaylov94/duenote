<script setup>
import { XMarkIcon } from "@heroicons/vue/20/solid";

const section = defineModel({ type: Object, required: true });

function addRow() {
  section.value.rows.push({
    id: globalThis.crypto.randomUUID(),
    word: "",
    meaning: "",
  });
}

function removeRow(i) {
  if (section.value.rows.length <= 1) return;
  section.value.rows.splice(i, 1);
}
</script>

<template>
  <div class="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
    <div class="overflow-x-auto p-3">
      <table class="w-full min-w-[320px] border-collapse text-sm">
        <thead>
          <tr class="border-b border-zinc-200 text-left text-xs font-medium uppercase text-zinc-500 dark:border-zinc-700">
            <th class="pb-2 pr-2">Word</th>
            <th class="pb-2 pr-2">Meaning</th>
            <th class="w-10 pb-2" />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, i) in section.rows"
            :key="row.id"
            class="border-b border-zinc-100 last:border-0 dark:border-zinc-800"
          >
            <td class="py-1.5 pr-2 align-top">
              <input
                v-model="row.word"
                type="text"
                class="w-full rounded border border-zinc-200 bg-white px-2 py-1.5 text-zinc-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                placeholder="Word"
              />
            </td>
            <td class="py-1.5 pr-2 align-top">
              <input
                v-model="row.meaning"
                type="text"
                class="w-full rounded border border-zinc-200 bg-white px-2 py-1.5 text-zinc-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                placeholder="Meaning"
              />
            </td>
            <td class="py-1.5 align-top">
              <button
                type="button"
                class="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 disabled:opacity-30 dark:hover:bg-zinc-800"
                :disabled="section.rows.length <= 1"
                aria-label="Remove row"
                @click="removeRow(i)"
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
        @click="addRow"
      >
        Add word
      </button>
    </div>
  </div>
</template>
