<script setup>
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  TrashIcon,
  ChevronDownIcon,
  EllipsisVerticalIcon,
  MagnifyingGlassIcon,
} from "@heroicons/vue/20/solid";
import { DocumentDuplicateIcon } from "@heroicons/vue/24/outline";
import { ref, watch, nextTick, onMounted, onUnmounted } from "vue";
import SidebarProfile from "./SidebarProfile.vue";

const collapsed = defineModel("collapsed", { type: Boolean, default: false });

const props = defineProps({
  courses: { type: Array, default: () => [] },
  activeWorkbookId: { type: Number, default: null },
  activeCourseId: { type: Number, default: null },
  user: { type: Object, default: null },
});

const emit = defineEmits([
  "select",
  "new-course",
  "new-workbook",
  "rename-course",
  "course-languages",
  "course-vocabulary",
  "course-search",
  "duplicate",
  "delete",
  "delete-course",
  "open-settings",
  "sign-out",
]);

const editingCourseId = ref(null);
const renameDraft = ref("");

function renameInputId(courseId) {
  return `course-rename-${courseId}`;
}

function focusRenameInput(courseId) {
  nextTick(() => {
    requestAnimationFrame(() => {
      const el = document.getElementById(renameInputId(courseId));
      if (el instanceof HTMLInputElement) {
        el.focus();
        el.select();
      }
    });
  });
}

function startRename(course) {
  editingCourseId.value = course.id;
  renameDraft.value = course.title || "";
  focusRenameInput(course.id);
}

function cancelRename() {
  editingCourseId.value = null;
  renameDraft.value = "";
}

function commitRename(courseId) {
  if (editingCourseId.value !== courseId) return;
  const t = renameDraft.value.trim() || "Untitled course";
  editingCourseId.value = null;
  renameDraft.value = "";
  emit("rename-course", { id: courseId, title: t });
}

function onRenameBlur(courseId) {
  if (editingCourseId.value === courseId) {
    commitRename(courseId);
  }
}

/** @type {import('vue').Ref<number | null>} */
const courseMenuOpenId = ref(null);

function toggleCourseMenu(courseId) {
  courseMenuOpenId.value =
    courseMenuOpenId.value === courseId ? null : courseId;
}

function closeCourseMenu() {
  courseMenuOpenId.value = null;
}

function openRenameFromMenu(course) {
  closeCourseMenu();
  // Wait for the menu to leave the DOM so focus isn't stolen by the closing overlay.
  nextTick(() => startRename(course));
}

function addWorkbookFromMenu(courseId) {
  closeCourseMenu();
  emit("new-workbook", courseId);
}

function deleteCourseFromMenu(courseId) {
  closeCourseMenu();
  emit("delete-course", courseId);
}

function openCourseLanguagesFromMenu(course) {
  closeCourseMenu();
  emit("course-languages", course);
}

function openCourseVocabularyFromMenu(course) {
  closeCourseMenu();
  emit("course-vocabulary", course);
}

function openCourseSearchFromMenu(course) {
  closeCourseMenu();
  emit("course-search", course);
}

function onDocumentPointerDown(e) {
  if (!(e.target instanceof Element)) return;
  if (e.target.closest("[data-course-menu]")) return;
  courseMenuOpenId.value = null;
}

function onDocumentKeydown(e) {
  if (e.key === "Escape") courseMenuOpenId.value = null;
}

onMounted(() => {
  document.addEventListener("pointerdown", onDocumentPointerDown, true);
  document.addEventListener("keydown", onDocumentKeydown);
});

onUnmounted(() => {
  document.removeEventListener("pointerdown", onDocumentPointerDown, true);
  document.removeEventListener("keydown", onDocumentKeydown);
});

/** @type {import('vue').Ref<Record<number, boolean>>} */
const expanded = ref({});

function ensureExpanded(ids) {
  const next = { ...expanded.value };
  for (const id of ids) {
    if (next[id] === undefined) next[id] = true;
  }
  expanded.value = next;
}

watch(
  () => props.courses.map((c) => c.id),
  (ids) => {
    ensureExpanded(ids);
    if (editingCourseId.value != null && !ids.includes(editingCourseId.value)) {
      editingCourseId.value = null;
    }
    if (
      courseMenuOpenId.value != null &&
      !ids.includes(courseMenuOpenId.value)
    ) {
      courseMenuOpenId.value = null;
    }
  },
  { immediate: true },
);

function toggleCourse(courseId) {
  expanded.value = {
    ...expanded.value,
    [courseId]: !expanded.value[courseId],
  };
}

function onCollapsedNewWorkbook() {
  if (props.activeCourseId != null) {
    emit("new-workbook", props.activeCourseId);
  }
}
</script>

<template>
  <aside
    class="flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-r border-zinc-200 bg-white transition-[width] duration-200 ease-out dark:border-zinc-800 dark:bg-zinc-900"
    :class="collapsed ? 'w-14' : 'w-[300px]'"
  >
    <!-- Expanded -->
    <template v-if="!collapsed">
      <div
        class="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-200 px-2 py-3 dark:border-zinc-800"
      >
        <div class="flex min-w-0 flex-1 items-center gap-2">
          <button
            type="button"
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            aria-label="Collapse sidebar"
            @click="collapsed = true"
          >
            <ChevronLeftIcon class="h-5 w-5" aria-hidden="true" />
          </button>
          <div class="flex min-w-0 flex-1 items-center gap-2">
            <span
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-xs font-bold text-white"
              aria-hidden="true"
              >DN</span
            >
            <span
              class="truncate font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
              >DueNote</span
            >
          </div>
        </div>
        <button
          type="button"
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
          aria-label="New course"
          title="New course"
          @click="$emit('new-course')"
        >
          <PlusIcon class="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      <nav
        class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-2"
        aria-label="Courses and workbooks"
      >
        <ul class="flex flex-col gap-2">
          <li
            v-for="course in courses"
            :key="course.id"
            class="rounded-lg border border-zinc-100 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-900/50"
          >
            <div
              class="flex items-center gap-1 border-b border-zinc-100 px-1 py-1.5 dark:border-zinc-800"
              :class="
                activeCourseId === course.id && activeWorkbookId == null
                  ? 'bg-indigo-50/80 dark:bg-indigo-950/30'
                  : ''
              "
            >
              <button
                type="button"
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-white dark:hover:bg-zinc-800"
                :aria-expanded="expanded[course.id] !== false"
                :aria-label="
                  expanded[course.id] === false
                    ? 'Expand course'
                    : 'Collapse course'
                "
                @click="toggleCourse(course.id)"
              >
                <ChevronDownIcon
                  v-if="expanded[course.id] !== false"
                  class="h-4 w-4"
                  aria-hidden="true"
                />
                <ChevronRightIcon v-else class="h-4 w-4" aria-hidden="true" />
              </button>
              <input
                v-if="editingCourseId === course.id"
                :id="renameInputId(course.id)"
                v-model="renameDraft"
                type="text"
                class="min-w-0 flex-1 rounded border border-indigo-400 bg-white px-1.5 py-0.5 text-sm font-medium text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-indigo-500 dark:bg-zinc-950 dark:text-zinc-100"
                aria-label="Course name"
                @keydown.enter.prevent="commitRename(course.id)"
                @keydown.escape.prevent="cancelRename"
                @blur="onRenameBlur(course.id)"
              />
              <button
                v-else
                type="button"
                class="min-w-0 flex-1 truncate px-1 text-left text-sm font-medium text-zinc-800 dark:text-zinc-100"
                :title="course.title"
                @dblclick.prevent="startRename(course)"
              >
                {{ course.title || "Untitled course" }}
              </button>
              <div
                v-if="editingCourseId === course.id"
                class="h-8 w-8 shrink-0"
                aria-hidden="true"
              />
              <div v-else class="relative shrink-0" data-course-menu>
                <button
                  type="button"
                  class="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-white hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                  :aria-expanded="courseMenuOpenId === course.id"
                  aria-haspopup="true"
                  :aria-label="`Course actions: ${course.title || 'Untitled course'}`"
                  @click.stop="toggleCourseMenu(course.id)"
                >
                  <EllipsisVerticalIcon class="h-5 w-5" aria-hidden="true" />
                </button>
                <div
                  v-show="courseMenuOpenId === course.id"
                  class="absolute right-0 top-full z-30 mt-0.5 min-w-44 rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
                  role="menu"
                  :aria-label="`Actions for ${course.title || 'course'}`"
                >
                  <button
                    type="button"
                    class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-800 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    role="menuitem"
                    @click="openRenameFromMenu(course)"
                  >
                    Rename course
                  </button>
                  <button
                    type="button"
                    class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-800 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    role="menuitem"
                    @click="addWorkbookFromMenu(course.id)"
                  >
                    New workbook
                  </button>
                  <button
                    type="button"
                    class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-800 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    role="menuitem"
                    @click="openCourseLanguagesFromMenu(course)"
                  >
                    Languages
                  </button>
                  <button
                    type="button"
                    class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-800 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    role="menuitem"
                    @click="openCourseVocabularyFromMenu(course)"
                  >
                    Vocabulary
                  </button>
                  <button
                    type="button"
                    class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-800 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    role="menuitem"
                    @click="openCourseSearchFromMenu(course)"
                  >
                    <MagnifyingGlassIcon
                      class="h-4 w-4 shrink-0 opacity-70"
                      aria-hidden="true"
                    />
                    Search course
                  </button>
                  <button
                    type="button"
                    class="flex w-full items-center gap-2 border-t border-zinc-100 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:border-zinc-800 dark:text-red-400 dark:hover:bg-red-950/40"
                    role="menuitem"
                    @click="deleteCourseFromMenu(course.id)"
                  >
                    Delete course
                  </button>
                </div>
              </div>
            </div>
            <ul
              v-show="expanded[course.id] !== false"
              class="flex flex-col gap-0.5 px-1 pb-1.5 pt-0.5"
            >
              <li v-for="w in course.workbooks || []" :key="w.id">
                <div
                  class="flex items-center gap-1 rounded-lg border transition"
                  :class="
                    activeWorkbookId === w.id
                      ? 'border-indigo-500 bg-indigo-50 dark:border-indigo-500 dark:bg-indigo-950/50'
                      : 'border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800/80'
                  "
                >
                  <button
                    type="button"
                    class="min-w-0 flex-1 truncate px-2 py-2 pl-3 text-left text-sm text-zinc-800 dark:text-zinc-200"
                    @click="$emit('select', w.id)"
                  >
                    {{ w.title || "Untitled" }}
                  </button>
                  <button
                    type="button"
                    class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-white/80 hover:text-zinc-800 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
                    aria-label="Duplicate workbook"
                    @click.stop="$emit('duplicate', w.id)"
                  >
                    <DocumentDuplicateIcon class="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-red-100 hover:text-red-700 dark:hover:bg-red-950/50 dark:hover:text-red-300"
                    aria-label="Delete workbook"
                    @click.stop="$emit('delete', w.id)"
                  >
                    <TrashIcon class="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </li>
              <li
                v-if="!(course.workbooks && course.workbooks.length)"
                class="px-2 py-2 text-xs text-zinc-500 dark:text-zinc-400"
              >
                No workbooks yet - use the ⋮ menu on the course to add one.
              </li>
            </ul>
          </li>
        </ul>
        <p
          v-if="!courses.length"
          class="px-2 py-4 text-center text-sm text-zinc-500 dark:text-zinc-400"
        >
          No courses yet. Use + in the header to create one.
        </p>
      </nav>
      <SidebarProfile
        :user="user"
        :collapsed="false"
        @open-settings="$emit('open-settings')"
        @sign-out="$emit('sign-out')"
      />
    </template>

    <!-- Collapsed -->
    <div
      v-else
      class="flex min-h-0 flex-1 flex-col items-center gap-3 border-b border-transparent py-3"
    >
      <button
        type="button"
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        aria-label="Expand sidebar"
        @click="collapsed = false"
      >
        <ChevronRightIcon class="h-5 w-5" aria-hidden="true" />
      </button>
      <span
        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-xs font-bold text-white"
        aria-hidden="true"
        >DN</span
      >
      <button
        type="button"
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800 disabled:opacity-40"
        aria-label="New workbook in current course"
        :disabled="activeCourseId == null"
        @click="onCollapsedNewWorkbook"
      >
        <PlusIcon class="h-5 w-5" aria-hidden="true" />
      </button>
      <div class="mt-auto w-full px-1 pb-1 pt-2">
        <SidebarProfile
          :user="user"
          :collapsed="true"
          @open-settings="$emit('open-settings')"
          @sign-out="$emit('sign-out')"
        />
      </div>
    </div>
  </aside>
</template>
