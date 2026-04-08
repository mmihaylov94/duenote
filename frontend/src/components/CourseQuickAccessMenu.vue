<script setup>
import { ref, watch, nextTick, computed, onMounted, onUnmounted } from "vue";
import { EllipsisVerticalIcon } from "@heroicons/vue/20/solid";

const props = defineProps({
  items: { type: Array, default: () => [] },
  /** { workbookId, sectionId } when user is naming a new entry */
  draftItem: { type: Object, default: null },
  draftError: { type: String, default: "" },
});

const emit = defineEmits([
  "save-draft",
  "cancel-draft",
  "delete-item",
  "reorder",
  "navigate",
  "rename-item",
]);

const draftLabel = ref("");
const draftInputRef = ref(null);
const editingId = ref(null);
const editingLabel = ref("");
const editInputRef = ref(null);
/** Which item's ⋮ menu is open */
const openItemMenuId = ref(null);

function toggleItemMenu(itemId) {
  openItemMenuId.value = openItemMenuId.value === itemId ? null : itemId;
}

function closeItemMenu() {
  openItemMenuId.value = null;
}

function onDocumentPointerDown(e) {
  if (!(e.target instanceof Element)) return;
  if (e.target.closest("[data-quick-access-item-menu]")) return;
  closeItemMenu();
}

onMounted(() => {
  document.addEventListener("pointerdown", onDocumentPointerDown, true);
});

onUnmounted(() => {
  document.removeEventListener("pointerdown", onDocumentPointerDown, true);
});

watch(
  () => props.draftItem,
  async (d) => {
    draftLabel.value = "";
    if (d) {
      await nextTick();
      draftInputRef.value?.focus?.();
    }
  },
  { immediate: true },
);

const localOrder = ref([]);

watch(
  () => props.items,
  (items) => {
    localOrder.value = items.map((p) => p.id);
  },
  { immediate: true, deep: true },
);

const orderedItems = computed(() => {
  const byId = new Map(props.items.map((p) => [p.id, p]));
  const ids = localOrder.value.length
    ? localOrder.value
    : props.items.map((p) => p.id);
  return ids.map((id) => byId.get(id)).filter(Boolean);
});

const dragFrom = ref(null);
const dragOverId = ref(null);

function onDragStart(e, itemId) {
  dragFrom.value = itemId;
  dragOverId.value = null;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", String(itemId));
}

function onDragEnd() {
  dragFrom.value = null;
  dragOverId.value = null;
}

function onDragOverItem(itemId) {
  if (dragFrom.value === null) return;
  dragOverId.value = itemId;
}

function onDropItem(targetId) {
  const fromId = dragFrom.value;
  dragFrom.value = null;
  dragOverId.value = null;
  if (fromId == null || fromId === targetId) return;
  const ids = [...localOrder.value];
  const fromIdx = ids.indexOf(fromId);
  const toIdx = ids.indexOf(targetId);
  if (fromIdx < 0 || toIdx < 0) return;
  const [moved] = ids.splice(fromIdx, 1);
  ids.splice(toIdx, 0, moved);
  localOrder.value = ids;
  emit("reorder", ids);
}

function submitDraft() {
  const t = draftLabel.value.trim();
  emit("save-draft", t);
}

function startRename(item) {
  closeItemMenu();
  editingId.value = item.id;
  editingLabel.value = item.label;
  nextTick(() => {
    editInputRef.value?.focus?.();
    editInputRef.value?.select?.();
  });
}

function deleteItem(itemId) {
  closeItemMenu();
  emit("delete-item", itemId);
}

function commitRename() {
  const id = editingId.value;
  if (id == null) return;
  const t = editingLabel.value.trim();
  editingId.value = null;
  if (!t) return;
  emit("rename-item", { id, label: t });
}

function onRenameBlur() {
  commitRename();
}
</script>

<template>
  <div
    class="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-2xl border border-zinc-200/90 bg-white/95 shadow-lg shadow-zinc-900/10 ring-1 ring-black/5 backdrop-blur-md dark:border-zinc-600/80 dark:bg-zinc-900/95 dark:shadow-black/40 dark:ring-white/10"
    role="complementary"
    aria-label="Quick access"
  >
    <div
      class="shrink-0 border-b border-zinc-200/80 px-3 py-2 dark:border-zinc-700/80"
    >
      <h2
        class="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
      >
        Quick access
      </h2>
      <p
        class="mt-0.5 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400"
      >
        Click a shortcut to preview it in a modal. Drag a row to reorder. Your
        open workbook stays as-is.
      </p>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-2 py-2">
      <div
        v-if="draftItem"
        class="mb-1.5 rounded-lg border border-indigo-200/80 bg-indigo-50/50 p-2 dark:border-indigo-800 dark:bg-indigo-950/40"
      >
        <p class="text-[11px] text-zinc-600 dark:text-zinc-400">
          Name this shortcut
        </p>
        <input
          ref="draftInputRef"
          v-model="draftLabel"
          type="text"
          class="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
          placeholder="e.g. Key grammar"
          maxlength="500"
          @keydown.enter.prevent="submitDraft"
          @keydown.escape.prevent="emit('cancel-draft')"
        />
        <p
          v-if="draftError"
          class="mt-1 text-xs text-red-600 dark:text-red-400"
        >
          {{ draftError }}
        </p>
        <div class="mt-1.5 flex gap-1.5">
          <button
            type="button"
            class="rounded-md bg-indigo-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-indigo-500"
            @click="submitDraft"
          >
            Save
          </button>
          <button
            type="button"
            class="rounded-md border border-zinc-300 px-2 py-0.5 text-[11px] text-zinc-700 dark:border-zinc-600 dark:text-zinc-300"
            @click="emit('cancel-draft')"
          >
            Cancel
          </button>
        </div>
      </div>

      <ul
        v-if="orderedItems.length === 0 && !draftItem"
        class="list-none px-1 py-4 text-center text-[11px] leading-snug text-zinc-500 dark:text-zinc-400"
      >
        Nothing here yet. Add shortcuts with the bookmark button next to each
        section.
      </ul>

      <ul class="list-none flex flex-col gap-0.5">
        <li
          v-for="item in orderedItems"
          :key="item.id"
          class="flex min-h-7 items-center rounded-lg border border-transparent px-2 py-0.5 transition-colors"
          :class="
            dragOverId === item.id && dragFrom !== null && dragFrom !== item.id
              ? 'border-indigo-300 bg-indigo-50/80 dark:border-indigo-700 dark:bg-indigo-950/40'
              : 'hover:border-zinc-200 hover:bg-zinc-50 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/60'
          "
          @dragover.prevent="onDragOverItem(item.id)"
          @drop.prevent="onDropItem(item.id)"
        >
          <div class="flex min-h-6 w-full items-center gap-1">
            <div
              class="flex min-h-6 min-w-0 flex-1 items-center rounded-md"
              :class="
                editingId === item.id
                  ? 'cursor-default'
                  : 'cursor-grab active:cursor-grabbing'
              "
              :draggable="editingId !== item.id"
              @dragstart="onDragStart($event, item.id)"
              @dragend="onDragEnd"
            >
              <template v-if="editingId === item.id">
                <input
                  ref="editInputRef"
                  v-model="editingLabel"
                  type="text"
                  class="w-full rounded-md border border-zinc-300 bg-white px-1.5 py-0.5 text-xs leading-normal dark:border-zinc-600 dark:bg-zinc-900"
                  maxlength="500"
                  @keydown.enter.prevent="commitRename"
                  @keydown.escape.prevent="editingId = null"
                  @blur="onRenameBlur"
                />
              </template>
              <button
                v-else
                type="button"
                class="flex w-full items-center truncate text-left text-xs font-medium leading-none text-indigo-700 hover:underline dark:text-indigo-300"
                @click="
                  emit('navigate', {
                    workbookId: item.workbookId,
                    sectionId: item.sectionId,
                    label: item.label,
                  })
                "
              >
                {{ item.label }}
              </button>
            </div>
            <div class="relative shrink-0" data-quick-access-item-menu>
              <button
                type="button"
                class="flex size-6 shrink-0 items-center justify-center rounded text-zinc-500 transition-colors duration-150 hover:text-indigo-600 dark:text-zinc-400 dark:hover:text-indigo-400"
                :aria-expanded="openItemMenuId === item.id"
                aria-haspopup="true"
                :aria-label="`Actions for ${item.label || 'shortcut'}`"
                @click.stop="toggleItemMenu(item.id)"
              >
                <EllipsisVerticalIcon class="h-4 w-4" aria-hidden="true" />
              </button>
              <div
                v-show="openItemMenuId === item.id"
                class="absolute right-0 top-full z-40 mt-0.5 min-w-36 rounded-md border border-zinc-200 bg-white py-0.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
                role="menu"
                :aria-label="`Actions for ${item.label || 'shortcut'}`"
                @click.stop
              >
                <button
                  type="button"
                  class="flex w-full items-center px-2 py-1.5 text-left text-xs text-zinc-800 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  role="menuitem"
                  @click="startRename(item)"
                >
                  Rename
                </button>
                <button
                  type="button"
                  class="flex w-full items-center px-2 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                  role="menuitem"
                  @click="deleteItem(item.id)"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>
