<script setup>
import { ref, onMounted } from "vue";
import WorkbookSidebar from "./components/WorkbookSidebar.vue";
import TranslatorView from "./components/TranslatorView.vue";
import CourseVocabularyPanel from "./components/CourseVocabularyPanel.vue";
import { LANGUAGES } from "./constants/languages.js";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";

const courses = ref([]);
const currentCourseId = ref(null);
const currentWorkbookId = ref(null);
const workbookTitle = ref("Untitled");
const wbSourceLang = ref("EN");
const wbTargetLang = ref("DE");
const apiError = ref("");
const sidebarCollapsed = ref(false);

/** Course object when open, or null */
const courseLanguagesModal = ref(null);
const courseLangDraftSource = ref("EN");
const courseLangDraftTarget = ref("DE");

/** Set when course vocabulary panel is open `{ id, title }` */
const vocabularyCourse = ref(null);
const vocabularyPanelRef = ref(null);

/** @type {(() => void) | null} */
let removeCourseLangEsc = null;

function clearTitleTimer() {
  /* reserved */
}

function findWorkbookCourse(workbookId) {
  for (const c of courses.value) {
    if ((c.workbooks || []).some((w) => w.id === workbookId)) {
      return c.id;
    }
  }
  return null;
}

function firstWorkbookInTree(list) {
  for (const c of list) {
    const wbs = c.workbooks || [];
    if (wbs.length > 0) {
      return { courseId: c.id, workbookId: wbs[0].id, title: wbs[0].title };
    }
  }
  return null;
}

async function fetchCourses() {
  apiError.value = "";
  try {
    const r = await fetch(`${API_BASE}/api/courses`);
    if (!r.ok) {
      apiError.value = `Could not load courses (HTTP ${r.status}). Is the API running at ${API_BASE}?`;
      return;
    }
    courses.value = await r.json();
  } catch {
    apiError.value = `Cannot reach the API at ${API_BASE}. In a terminal run: cd backend && npm run dev (data is stored in PostgreSQL via that server).`;
  }
}

function onWorkbookLoaded({ title }) {
  workbookTitle.value = title;
}

function onWorkbookMeta({ title }) {
  workbookTitle.value = title;
}

function onTranslatorSaved() {
  fetchCourses();
  vocabularyPanelRef.value?.reload?.();
}

function openCourseVocabulary(course) {
  vocabularyCourse.value = { id: course.id, title: course.title };
}

function selectWorkbook(id) {
  clearTitleTimer();
  currentWorkbookId.value = id;
  const cid = findWorkbookCourse(id);
  if (cid != null) currentCourseId.value = cid;
  let title = "Untitled";
  for (const c of courses.value) {
    const w = (c.workbooks || []).find((x) => x.id === id);
    if (w) {
      title = w.title ?? "Untitled";
      break;
    }
  }
  workbookTitle.value = title;
}

function closeCourseLanguagesModal() {
  courseLanguagesModal.value = null;
  if (removeCourseLangEsc) {
    removeCourseLangEsc();
    removeCourseLangEsc = null;
  }
}

function openCourseLanguages(course) {
  closeCourseLanguagesModal();
  courseLanguagesModal.value = course;
  courseLangDraftSource.value = course.sourceLang ?? "EN";
  courseLangDraftTarget.value = course.targetLang ?? "DE";
  const esc = (e) => {
    if (e.key === "Escape") closeCourseLanguagesModal();
  };
  window.addEventListener("keydown", esc);
  removeCourseLangEsc = () => window.removeEventListener("keydown", esc);
}

async function saveCourseLanguages() {
  const c = courseLanguagesModal.value;
  if (!c) return;
  let r;
  try {
    r = await fetch(`${API_BASE}/api/courses/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLang: courseLangDraftSource.value,
        targetLang: courseLangDraftTarget.value,
      }),
    });
  } catch {
    apiError.value = `Cannot reach the API at ${API_BASE}. Start the backend (cd backend && npm run dev).`;
    return;
  }
  if (!r.ok) {
    apiError.value = `Could not save languages (HTTP ${r.status}).`;
    return;
  }
  apiError.value = "";
  closeCourseLanguagesModal();
  await fetchCourses();
}

async function createCourse() {
  clearTitleTimer();
  let r;
  try {
    r = await fetch(`${API_BASE}/api/courses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "New course",
        sourceLang: wbSourceLang.value,
        targetLang: wbTargetLang.value,
      }),
    });
  } catch {
    apiError.value = `Cannot reach the API at ${API_BASE}. Start the backend (cd backend && npm run dev).`;
    return;
  }
  if (!r.ok) {
    apiError.value = `Could not create course (HTTP ${r.status}).`;
    return;
  }
  apiError.value = "";
  const c = await r.json();
  await fetchCourses();
  currentCourseId.value = c.id;
  await createWorkbook(c.id);
}

async function renameCourse({ id, title }) {
  clearTitleTimer();
  let r;
  try {
    r = await fetch(`${API_BASE}/api/courses/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
  } catch {
    apiError.value = `Cannot reach the API at ${API_BASE}. Start the backend (cd backend && npm run dev).`;
    return;
  }
  if (!r.ok) {
    apiError.value = `Could not rename course (HTTP ${r.status}).`;
    return;
  }
  apiError.value = "";
  await fetchCourses();
}

async function deleteCourse(id) {
  clearTitleTimer();
  const r = await fetch(`${API_BASE}/api/courses/${id}`, { method: "DELETE" });
  if (!r.ok) return;
  const wasCurrentCourse = currentCourseId.value === id;
  const hadCurrentWbInCourse =
    wasCurrentCourse &&
    currentWorkbookId.value != null &&
    findWorkbookCourse(currentWorkbookId.value) === id;
  await fetchCourses();
  if (hadCurrentWbInCourse || wasCurrentCourse) {
    const next = firstWorkbookInTree(courses.value);
    if (next) {
      currentCourseId.value = next.courseId;
      currentWorkbookId.value = next.workbookId;
      workbookTitle.value = next.title ?? "Untitled";
    } else {
      currentCourseId.value = courses.value[0]?.id ?? null;
      currentWorkbookId.value = null;
      workbookTitle.value = "Untitled";
      if (currentCourseId.value != null) {
        await createWorkbook(currentCourseId.value);
      } else {
        await createCourse();
      }
    }
  }
}

async function createWorkbook(courseId) {
  clearTitleTimer();
  const cid = courseId ?? currentCourseId.value;
  if (cid == null) {
    apiError.value = "Select or create a course first.";
    return;
  }
  let r;
  try {
    r = await fetch(`${API_BASE}/api/workbooks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId: cid }),
    });
  } catch {
    apiError.value = `Cannot reach the API at ${API_BASE}. Start the backend (cd backend && npm run dev).`;
    return;
  }
  if (!r.ok) {
    apiError.value = `Could not create workbook (HTTP ${r.status}).`;
    return;
  }
  apiError.value = "";
  const w = await r.json();
  await fetchCourses();
  currentCourseId.value = cid;
  currentWorkbookId.value = w.id;
  workbookTitle.value = w.title;
  wbSourceLang.value = w.sourceLang ?? "EN";
  wbTargetLang.value = w.targetLang ?? "DE";
}

async function duplicateWorkbook(id) {
  clearTitleTimer();
  const r = await fetch(`${API_BASE}/api/workbooks/${id}/duplicate`, { method: "POST" });
  if (!r.ok) return;
  const w = await r.json();
  await fetchCourses();
  currentCourseId.value = w.courseId ?? findWorkbookCourse(w.id) ?? currentCourseId.value;
  currentWorkbookId.value = w.id;
  workbookTitle.value = w.title;
  wbSourceLang.value = w.sourceLang ?? "EN";
  wbTargetLang.value = w.targetLang ?? "DE";
}

async function deleteWorkbook(id) {
  clearTitleTimer();
  const r = await fetch(`${API_BASE}/api/workbooks/${id}`, { method: "DELETE" });
  if (!r.ok) return;
  const deletedCourseId = findWorkbookCourse(id);
  await fetchCourses();
  const flat = firstWorkbookInTree(courses.value);
  if (!flat) {
    const cid = deletedCourseId ?? currentCourseId.value ?? courses.value[0]?.id;
    if (cid != null) {
      currentCourseId.value = cid;
      await createWorkbook(cid);
    } else {
      await createCourse();
    }
    return;
  }
  if (currentWorkbookId.value === id) {
    currentCourseId.value = flat.courseId;
    currentWorkbookId.value = flat.workbookId;
    workbookTitle.value = flat.title ?? "Untitled";
  }
}

onMounted(async () => {
  await fetchCourses();
  if (apiError.value) return;
  if (courses.value.length === 0) {
    await createCourse();
    return;
  }
  const first = firstWorkbookInTree(courses.value);
  if (first) {
    currentCourseId.value = first.courseId;
    currentWorkbookId.value = first.workbookId;
    workbookTitle.value = first.title ?? "Untitled";
  } else {
    currentCourseId.value = courses.value[0].id;
    await createWorkbook(currentCourseId.value);
  }
});
</script>

<template>
  <div class="flex h-[100dvh] min-h-0 flex-col bg-zinc-100 dark:bg-zinc-950">
    <p
      v-if="apiError"
      class="shrink-0 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-100"
      role="alert"
    >
      {{ apiError }}
    </p>
    <div class="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
      <WorkbookSidebar
        v-model:collapsed="sidebarCollapsed"
        :courses="courses"
        :active-workbook-id="currentWorkbookId"
        :active-course-id="currentCourseId"
        @select="selectWorkbook"
        @new-course="createCourse"
        @new-workbook="createWorkbook"
        @rename-course="renameCourse"
        @course-languages="openCourseLanguages"
        @course-vocabulary="openCourseVocabulary"
        @duplicate="duplicateWorkbook"
        @delete="deleteWorkbook"
        @delete-course="deleteCourse"
      />
      <main class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div
          class="flex shrink-0 flex-wrap items-center gap-3 border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <h1
            class="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
            :title="workbookTitle"
          >
            {{ workbookTitle }}
          </h1>
          <div class="flex flex-wrap items-center gap-3">
            <div class="flex items-center gap-2">
              <label
                for="wb-from-lang"
                class="shrink-0 text-sm font-medium text-zinc-600 dark:text-zinc-400"
              >
                Source
              </label>
              <select
                id="wb-from-lang"
                v-model="wbSourceLang"
                class="min-w-0 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
              >
                <option v-for="lang in LANGUAGES" :key="'from-' + lang.code" :value="lang.code">
                  {{ lang.label }}
                </option>
              </select>
            </div>
            <div class="flex items-center gap-2">
              <label
                for="wb-to-lang"
                class="shrink-0 text-sm font-medium text-zinc-600 dark:text-zinc-400"
              >
                Destination
              </label>
              <select
                id="wb-to-lang"
                v-model="wbTargetLang"
                class="min-w-0 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
              >
                <option v-for="lang in LANGUAGES" :key="'to-' + lang.code" :value="lang.code">
                  {{ lang.label }}
                </option>
              </select>
            </div>
          </div>
        </div>
        <div class="min-h-0 flex-1 overflow-auto">
          <TranslatorView
            v-if="currentWorkbookId != null"
            :key="currentWorkbookId"
            :workbook-id="currentWorkbookId"
            v-model:source-lang="wbSourceLang"
            v-model:target-lang="wbTargetLang"
            @loaded="onWorkbookLoaded"
            @meta="onWorkbookMeta"
            @saved="onTranslatorSaved"
          />
          <div
            v-else
            class="flex min-h-[12rem] flex-col items-center justify-center gap-2 px-6 text-center text-zinc-500 dark:text-zinc-400"
          >
            <p class="text-sm">No workbook selected.</p>
            <p class="text-xs">Add a workbook to a course from the sidebar.</p>
          </div>
        </div>
      </main>
    </div>

    <div
      v-if="courseLanguagesModal"
      class="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="course-lang-dialog-title"
      @click.self="closeCourseLanguagesModal"
    >
      <div
        class="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        @click.stop
      >
        <h2
          id="course-lang-dialog-title"
          class="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
        >
          Languages
        </h2>
        <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          New workbooks in
          <span class="font-medium text-zinc-700 dark:text-zinc-300">{{
            courseLanguagesModal.title || "this course"
          }}</span>
          will start with these languages.
        </p>
        <div
          class="mt-4 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-3"
        >
          <label
            for="course-modal-src"
            class="text-sm font-medium text-zinc-600 dark:text-zinc-400"
          >
            Source
          </label>
          <select
            id="course-modal-src"
            v-model="courseLangDraftSource"
            class="w-full min-w-0 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
          >
            <option v-for="lang in LANGUAGES" :key="'cms-' + lang.code" :value="lang.code">
              {{ lang.label }}
            </option>
          </select>
          <label
            for="course-modal-dst"
            class="text-sm font-medium text-zinc-600 dark:text-zinc-400"
          >
            Destination
          </label>
          <select
            id="course-modal-dst"
            v-model="courseLangDraftTarget"
            class="w-full min-w-0 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
          >
            <option v-for="lang in LANGUAGES" :key="'cmd-' + lang.code" :value="lang.code">
              {{ lang.label }}
            </option>
          </select>
        </div>
        <div class="mt-6 flex justify-end gap-2">
          <button
            type="button"
            class="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            @click="closeCourseLanguagesModal"
          >
            Cancel
          </button>
          <button
            type="button"
            class="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500"
            @click="saveCourseLanguages"
          >
            Save
          </button>
        </div>
      </div>
    </div>

    <CourseVocabularyPanel
      v-if="vocabularyCourse"
      ref="vocabularyPanelRef"
      :course="vocabularyCourse"
      @close="vocabularyCourse = null"
    />
  </div>
</template>
