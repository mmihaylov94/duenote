<script setup>
import { ref, onMounted, onUnmounted, computed, watch, nextTick } from "vue";
import { useRouter } from "vue-router";
import WorkbookSidebar from "./components/WorkbookSidebar.vue";
import TranslatorView from "./components/TranslatorView.vue";
import CourseVocabularyPanel from "./components/CourseVocabularyPanel.vue";
import CourseMaterialsPanel from "./components/CourseMaterialsPanel.vue";
import CourseSearchModal from "./components/CourseSearchModal.vue";
import CourseQuickAccessMenu from "./components/CourseQuickAccessMenu.vue";
import CourseVocabularyQuickRef from "./components/CourseVocabularyQuickRef.vue";
import PinnedSectionPreviewModal from "./components/PinnedSectionPreviewModal.vue";
import ProfileSettingsModal from "./components/ProfileSettingsModal.vue";
import { LANGUAGES } from "./constants/languages.js";
import { apiFetch, apiOriginLabel } from "./api/client.js";

const router = useRouter();

/** Scrollport for workbook content; drives --workbook-scroll-h for quick access height. */
const workbookScrollEl = ref(null);
let workbookScrollResizeObserver = null;

function updateWorkbookScrollHeightVar() {
  const el = workbookScrollEl.value;
  if (!el) return;
  el.style.setProperty("--workbook-scroll-h", `${el.clientHeight}px`);
}

onMounted(() => {
  nextTick(() => {
    updateWorkbookScrollHeightVar();
    const el = workbookScrollEl.value;
    if (!el || typeof ResizeObserver === "undefined") return;
    workbookScrollResizeObserver = new ResizeObserver(() => {
      updateWorkbookScrollHeightVar();
    });
    workbookScrollResizeObserver.observe(el);
  });
});

onUnmounted(() => {
  workbookScrollResizeObserver?.disconnect();
  workbookScrollResizeObserver = null;
});

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
const courseVocabularyQuickRef = ref(null);

/** Set when course materials panel is open `{ id, title }` */
const materialsCourse = ref(null);

/** Set when course search modal is open `{ id, title }` */
const searchCourse = ref(null);

const coursePins = ref([]);
/** @type {import('vue').Ref<{ workbookId: number, sectionId: string } | null>} */
const draftPin = ref(null);
/** Quick access: preview section in a modal without switching workbook */
const pinSectionPreview = ref(null);
const draftPinError = ref("");
const pendingScrollSectionId = ref(null);
const scrollMissMessage = ref("");

const currentUser = ref(null);
const settingsOpen = ref(false);

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
    const r = await apiFetch("/api/courses");
    if (r.status === 401) {
      router.replace({ name: "login", query: { redirect: "/app" } });
      return;
    }
    if (!r.ok) {
      apiError.value = `Could not load courses (HTTP ${r.status}). Is the API running (${apiOriginLabel()})?`;
      return;
    }
    courses.value = await r.json();
  } catch {
    apiError.value = `Cannot reach ${apiOriginLabel()}. Run: cd backend && npm run dev`;
  }
}

async function logout() {
  try {
    await apiFetch("/api/auth/logout", { method: "POST" });
  } catch {
    /* still navigate */
  }
  currentUser.value = null;
  router.push({ name: "login" });
}

async function fetchCurrentUser() {
  try {
    const r = await apiFetch("/api/auth/me");
    if (r.ok) {
      currentUser.value = await r.json();
    } else {
      currentUser.value = null;
    }
  } catch {
    currentUser.value = null;
  }
}

function onProfileSaved(user) {
  currentUser.value = user;
}

function onWorkbookLoaded({ title }) {
  workbookTitle.value = title;
}

function onWorkbookMeta({ title }) {
  workbookTitle.value = title;
}

async function loadPins() {
  const cid = currentCourseId.value;
  if (cid == null) {
    coursePins.value = [];
    return;
  }
  try {
    const r = await apiFetch(`/api/courses/${cid}/pins`);
    if (r.ok) {
      const data = await r.json();
      coursePins.value = Array.isArray(data.pins) ? data.pins : [];
    }
  } catch {
    /* ignore */
  }
}

watch(currentCourseId, () => {
  draftPin.value = null;
  draftPinError.value = "";
  loadPins();
});

watch(currentWorkbookId, () => {
  draftPin.value = null;
  draftPinError.value = "";
});

const pinnedSectionIdsForWorkbook = computed(() => {
  const wid = currentWorkbookId.value;
  if (wid == null) return [];
  return coursePins.value
    .filter((p) => p.workbookId === wid)
    .map((p) => p.sectionId);
});

function openCourseSearch(course) {
  searchCourse.value = { id: course.id, title: course.title };
}

function onSearchSelectResult({ workbookId, sectionId }) {
  searchCourse.value = null;
  selectWorkbook(workbookId);
  pendingScrollSectionId.value = sectionId;
}

function onPendingScrollDone({ found }) {
  pendingScrollSectionId.value = null;
  if (!found) {
    scrollMissMessage.value = "That section was not found in this workbook.";
    window.setTimeout(() => {
      scrollMissMessage.value = "";
    }, 5000);
  }
}

async function onPinClick({ sectionId, isPinned }) {
  const cid = currentCourseId.value;
  const wid = currentWorkbookId.value;
  if (cid == null || wid == null) return;
  if (isPinned) {
    const pin = coursePins.value.find(
      (p) => p.workbookId === wid && p.sectionId === sectionId,
    );
    if (!pin) return;
    try {
      const r = await apiFetch(`/api/courses/${cid}/pins/${pin.id}`, {
        method: "DELETE",
      });
      if (r.ok) await loadPins();
    } catch {
      /* ignore */
    }
    return;
  }
  draftPin.value = { workbookId: wid, sectionId };
  draftPinError.value = "";
}

async function saveDraftPin(label) {
  draftPinError.value = "";
  const d = draftPin.value;
  const cid = currentCourseId.value;
  if (!d || cid == null) return;
  const t = String(label).trim();
  if (!t) {
    draftPinError.value = "Enter a label.";
    return;
  }
  try {
    const r = await apiFetch(`/api/courses/${cid}/pins`, {
      method: "POST",
      body: JSON.stringify({
        workbookId: d.workbookId,
        sectionId: d.sectionId,
        label: t,
      }),
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      draftPinError.value = data.error || `Failed (${r.status})`;
      return;
    }
    draftPin.value = null;
    await loadPins();
  } catch {
    draftPinError.value = "Cannot reach the API.";
  }
}

async function onPinsReorder(orderedIds) {
  const cid = currentCourseId.value;
  if (cid == null) return;
  try {
    const r = await apiFetch(`/api/courses/${cid}/pins/reorder`, {
      method: "PUT",
      body: JSON.stringify({ orderedIds }),
    });
    if (r.ok) await loadPins();
  } catch {
    /* ignore */
  }
}

async function onRenamePin({ id, label }) {
  const cid = currentCourseId.value;
  if (cid == null) return;
  try {
    const r = await apiFetch(`/api/courses/${cid}/pins/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ label }),
    });
    if (r.ok) await loadPins();
  } catch {
    /* ignore */
  }
}

async function onDeletePin(pinId) {
  const cid = currentCourseId.value;
  if (cid == null) return;
  try {
    const r = await apiFetch(`/api/courses/${cid}/pins/${pinId}`, {
      method: "DELETE",
    });
    if (r.ok) await loadPins();
  } catch {
    /* ignore */
  }
}

function onNavigatePin({ workbookId, sectionId, label }) {
  pinSectionPreview.value = {
    workbookId,
    sectionId,
    label: typeof label === "string" ? label : "",
  };
}

function closePinSectionPreview() {
  pinSectionPreview.value = null;
}

function onOpenPinInWorkbook({ workbookId, sectionId }) {
  pinSectionPreview.value = null;
  selectWorkbook(workbookId);
  pendingScrollSectionId.value = sectionId;
}

function cancelDraftPin() {
  draftPin.value = null;
  draftPinError.value = "";
}

function onTranslatorSaved() {
  fetchCourses();
  vocabularyPanelRef.value?.reload?.();
  courseVocabularyQuickRef.value?.reload?.();
  loadPins();
}

function openCourseVocabulary(course) {
  vocabularyCourse.value = { id: course.id, title: course.title };
}

function openCourseMaterials(course) {
  materialsCourse.value = { id: course.id, title: course.title };
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
    r = await apiFetch(`/api/courses/${c.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        sourceLang: courseLangDraftSource.value,
        targetLang: courseLangDraftTarget.value,
      }),
    });
  } catch {
    apiError.value = `Cannot reach ${apiOriginLabel()}. Start the backend (cd backend && npm run dev).`;
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
    r = await apiFetch("/api/courses", {
      method: "POST",
      body: JSON.stringify({
        title: "New course",
        sourceLang: wbSourceLang.value,
        targetLang: wbTargetLang.value,
      }),
    });
  } catch {
    apiError.value = `Cannot reach ${apiOriginLabel()}. Start the backend (cd backend && npm run dev).`;
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
    r = await apiFetch(`/api/courses/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    });
  } catch {
    apiError.value = `Cannot reach ${apiOriginLabel()}. Start the backend (cd backend && npm run dev).`;
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
  const r = await apiFetch(`/api/courses/${id}`, { method: "DELETE" });
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
    r = await apiFetch("/api/workbooks", {
      method: "POST",
      body: JSON.stringify({ courseId: cid }),
    });
  } catch {
    apiError.value = `Cannot reach ${apiOriginLabel()}. Start the backend (cd backend && npm run dev).`;
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
  const r = await apiFetch(`/api/workbooks/${id}/duplicate`, {
    method: "POST",
  });
  if (!r.ok) return;
  const w = await r.json();
  await fetchCourses();
  currentCourseId.value =
    w.courseId ?? findWorkbookCourse(w.id) ?? currentCourseId.value;
  currentWorkbookId.value = w.id;
  workbookTitle.value = w.title;
  wbSourceLang.value = w.sourceLang ?? "EN";
  wbTargetLang.value = w.targetLang ?? "DE";
}

async function deleteWorkbook(id) {
  clearTitleTimer();
  const r = await apiFetch(`/api/workbooks/${id}`, { method: "DELETE" });
  if (!r.ok) return;
  const deletedCourseId = findWorkbookCourse(id);
  await fetchCourses();
  const flat = firstWorkbookInTree(courses.value);
  if (!flat) {
    const cid =
      deletedCourseId ?? currentCourseId.value ?? courses.value[0]?.id;
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
  await fetchCurrentUser();
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
  <div class="flex h-dvh min-h-0 flex-col bg-zinc-100 dark:bg-zinc-950">
    <p
      v-if="apiError"
      class="shrink-0 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-100"
      role="alert"
    >
      {{ apiError }}
    </p>
    <p
      v-if="scrollMissMessage"
      class="shrink-0 border-b border-zinc-200 bg-zinc-100 px-4 py-2 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
      role="status"
    >
      {{ scrollMissMessage }}
    </p>
    <div class="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
      <WorkbookSidebar
        v-model:collapsed="sidebarCollapsed"
        :courses="courses"
        :user="currentUser"
        :active-workbook-id="currentWorkbookId"
        :active-course-id="currentCourseId"
        @select="selectWorkbook"
        @new-course="createCourse"
        @new-workbook="createWorkbook"
        @rename-course="renameCourse"
        @course-languages="openCourseLanguages"
        @course-vocabulary="openCourseVocabulary"
        @course-materials="openCourseMaterials"
        @course-search="openCourseSearch"
        @duplicate="duplicateWorkbook"
        @delete="deleteWorkbook"
        @delete-course="deleteCourse"
        @open-settings="settingsOpen = true"
        @sign-out="logout"
      />
      <main class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div
          class="flex shrink-0 flex-wrap items-center gap-3 border-b border-zinc-200 bg-white px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900"
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
                <option
                  v-for="lang in LANGUAGES"
                  :key="'from-' + lang.code"
                  :value="lang.code"
                >
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
                <option
                  v-for="lang in LANGUAGES"
                  :key="'to-' + lang.code"
                  :value="lang.code"
                >
                  {{ lang.label }}
                </option>
              </select>
            </div>
          </div>
        </div>
        <div ref="workbookScrollEl" class="min-h-0 flex-1 overflow-auto">
          <TranslatorView
            v-if="currentWorkbookId != null"
            :key="currentWorkbookId"
            :workbook-id="currentWorkbookId"
            :course-id="currentCourseId"
            :quick-access-enabled="currentCourseId != null"
            :pinned-section-ids="pinnedSectionIdsForWorkbook"
            :pending-section-scroll-id="pendingScrollSectionId"
            v-model:source-lang="wbSourceLang"
            v-model:target-lang="wbTargetLang"
            @loaded="onWorkbookLoaded"
            @meta="onWorkbookMeta"
            @saved="onTranslatorSaved"
            @vocabulary-changed="
              () => {
                vocabularyPanelRef?.reload?.();
                courseVocabularyQuickRef?.reload?.();
              }
            "
            @pending-scroll-done="onPendingScrollDone"
            @pin-click="onPinClick"
          >
            <template v-if="currentCourseId != null" #quick-access>
              <CourseQuickAccessMenu
                :items="coursePins"
                :draft-item="draftPin"
                :draft-error="draftPinError"
                @save-draft="saveDraftPin"
                @cancel-draft="cancelDraftPin"
                @delete-item="onDeletePin"
                @reorder="onPinsReorder"
                @rename-item="onRenamePin"
                @navigate="onNavigatePin"
              />
            </template>
            <template v-if="currentCourseId != null" #course-vocabulary>
              <CourseVocabularyQuickRef
                ref="courseVocabularyQuickRef"
                :course-id="currentCourseId"
              />
            </template>
          </TranslatorView>
          <div
            v-else
            class="flex min-h-48 flex-col items-center justify-center gap-2 px-6 text-center text-zinc-500 dark:text-zinc-400"
          >
            <p class="text-sm">No workbook selected.</p>
            <p class="text-xs">Add a workbook to a course from the sidebar.</p>
          </div>
        </div>
      </main>
    </div>

    <div
      v-if="courseLanguagesModal"
      class="fixed inset-0 z-100 flex items-center justify-center bg-black/40 p-4"
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
            <option
              v-for="lang in LANGUAGES"
              :key="'cms-' + lang.code"
              :value="lang.code"
            >
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
            <option
              v-for="lang in LANGUAGES"
              :key="'cmd-' + lang.code"
              :value="lang.code"
            >
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

    <CourseSearchModal
      v-if="searchCourse"
      :course="searchCourse"
      @close="searchCourse = null"
      @select-result="onSearchSelectResult"
    />

    <PinnedSectionPreviewModal
      v-if="pinSectionPreview"
      :workbook-id="pinSectionPreview.workbookId"
      :section-id="pinSectionPreview.sectionId"
      :label="pinSectionPreview.label"
      @close="closePinSectionPreview"
      @open-in-workbook="onOpenPinInWorkbook"
    />

    <CourseVocabularyPanel
      v-if="vocabularyCourse"
      ref="vocabularyPanelRef"
      :course="vocabularyCourse"
      @close="vocabularyCourse = null"
    />

    <CourseMaterialsPanel
      v-if="materialsCourse"
      :course="materialsCourse"
      @close="materialsCourse = null"
    />

    <ProfileSettingsModal
      :open="settingsOpen"
      :user="currentUser"
      @update:open="settingsOpen = $event"
      @saved="onProfileSaved"
    />
  </div>
</template>
