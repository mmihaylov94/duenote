<script setup>
const section = defineModel({ type: Object, required: true });
</script>

<template>
  <div class="rounded-xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
    <input
      v-model="section.text"
      type="text"
      class="h-9 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
      placeholder="Title"
      autocomplete="off"
    />
  </div>
</template>
