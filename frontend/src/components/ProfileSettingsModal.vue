<script setup>
import { ref, watch, computed, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { apiFetch } from "../api/client.js";
import { colorScheme, setColorScheme } from "../composables/useColorScheme.js";

const props = defineProps({
  open: { type: Boolean, default: false },
  user: { type: Object, default: null },
});

const router = useRouter();

const emit = defineEmits(["update:open", "saved"]);

const displayName = ref("");
const pendingFile = ref(null);
const previewObjectUrl = ref("");
const saving = ref(false);
const removing = ref(false);
const error = ref("");

const deleteModalOpen = ref(false);
const deletingAccount = ref(false);
const deleteError = ref("");

function revokePreview() {
  if (previewObjectUrl.value) {
    URL.revokeObjectURL(previewObjectUrl.value);
    previewObjectUrl.value = "";
  }
}

watch(
  () => [props.open, props.user],
  () => {
    if (!props.open || !props.user) return;
    displayName.value =
      props.user.displayName != null ? String(props.user.displayName) : "";
    pendingFile.value = null;
    revokePreview();
    error.value = "";
    deleteModalOpen.value = false;
    deletingAccount.value = false;
    deleteError.value = "";
  },
  { immediate: true },
);

onUnmounted(() => {
  revokePreview();
});

function onFileChange(e) {
  const input = e.target;
  const f = input?.files?.[0];
  revokePreview();
  pendingFile.value = f || null;
  if (f) {
    previewObjectUrl.value = URL.createObjectURL(f);
  }
  if (input) input.value = "";
}

function close() {
  emit("update:open", false);
}

function openDeleteModal() {
  deleteError.value = "";
  deleteModalOpen.value = true;
}

function closeDeleteModal() {
  if (deletingAccount.value) return;
  deleteModalOpen.value = false;
  deleteError.value = "";
}

async function deleteAccount() {
  if (deletingAccount.value) return;
  deleteError.value = "";
  deletingAccount.value = true;
  try {
    const r = await apiFetch("/api/auth/me", { method: "DELETE" });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      deleteError.value = j.error || `Could not delete account (${r.status})`;
      return;
    }
    deleteModalOpen.value = false;
    emit("update:open", false);
    // Ensure UI leaves authenticated area immediately (router guard will also enforce this).
    await router.replace({ name: "login" });
  } catch {
    deleteError.value = "Cannot reach the server.";
  } finally {
    deletingAccount.value = false;
  }
}

const displayAvatarSrc = computed(() => {
  if (previewObjectUrl.value) return previewObjectUrl.value;
  return props.user?.avatarUrl || "";
});

async function save() {
  if (!props.user) return;
  error.value = "";
  saving.value = true;
  try {
    if (pendingFile.value) {
      const fd = new FormData();
      fd.append("avatar", pendingFile.value);
      const r = await apiFetch("/api/auth/me/avatar", {
        method: "POST",
        body: fd,
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        error.value = data.error || `Could not upload image (${r.status})`;
        return;
      }
      pendingFile.value = null;
      revokePreview();
    }

    const r2 = await apiFetch("/api/auth/me", {
      method: "PATCH",
      body: JSON.stringify({
        displayName: displayName.value.trim() || null,
      }),
    });
    if (!r2.ok) {
      const data = await r2.json().catch(() => ({}));
      error.value = data.error || `Could not save (${r2.status})`;
      return;
    }
    const updated = await r2.json();
    emit("saved", updated);
    emit("update:open", false);
  } catch {
    error.value = "Cannot reach the server.";
  } finally {
    saving.value = false;
  }
}

async function removePhoto() {
  if (pendingFile.value) {
    pendingFile.value = null;
    revokePreview();
    return;
  }
  if (!props.user) return;
  error.value = "";
  removing.value = true;
  try {
    const r = await apiFetch("/api/auth/me/avatar", { method: "DELETE" });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      error.value = data.error || `Could not remove (${r.status})`;
      return;
    }
    const updated = await r.json();
    pendingFile.value = null;
    revokePreview();
    emit("saved", updated);
  } catch {
    error.value = "Cannot reach the server.";
  } finally {
    removing.value = false;
  }
}
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-110 flex items-center justify-center bg-black/40 p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="profile-settings-title"
    @click.self="close"
  >
    <div
      class="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      @click.stop
    >
      <h2
        id="profile-settings-title"
        class="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
      >
        Profile settings
      </h2>
      <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Update your display name and profile photo.
      </p>

      <p
        v-if="error"
        class="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/50 dark:text-red-100"
        role="alert"
      >
        {{ error }}
      </p>

      <div class="mt-4 flex flex-col items-center gap-3">
        <div
          class="relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full border border-zinc-200 bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800"
        >
          <img
            v-if="displayAvatarSrc"
            :src="displayAvatarSrc"
            alt=""
            class="h-full w-full object-cover"
          />
          <span
            v-else
            class="text-sm font-medium text-zinc-500 dark:text-zinc-400"
            >No photo</span
          >
        </div>
        <div class="flex w-full flex-wrap justify-center gap-2">
          <label
            class="cursor-pointer rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Choose image
            <input
              type="file"
              class="sr-only"
              accept="image/jpeg,image/png,image/webp,image/gif"
              @change="onFileChange"
            />
          </label>
          <button
            v-if="user?.avatarUrl || pendingFile"
            type="button"
            class="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:bg-zinc-900 dark:text-red-300 dark:hover:bg-red-950/40"
            :disabled="removing"
            @click="removePhoto"
          >
            Remove photo
          </button>
        </div>
        <p class="text-center text-xs text-zinc-500 dark:text-zinc-400">
          JPEG, PNG, WebP, or GIF. Max {{ Math.round(2) }}MB (server limit).
        </p>
      </div>

      <div class="mt-4">
        <label
          for="profile-display-name"
          class="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          Display name
        </label>
        <input
          id="profile-display-name"
          v-model="displayName"
          type="text"
          maxlength="200"
          autocomplete="name"
          class="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
          placeholder="Your name"
        />
      </div>

      <div
        class="mt-6 border-t border-zinc-200 pt-5 dark:border-zinc-700"
        role="group"
        aria-labelledby="profile-appearance-label"
      >
        <p
          id="profile-appearance-label"
          class="text-sm font-medium text-zinc-900 dark:text-zinc-100"
        >
          Appearance
        </p>
        <p class="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          Light or dark theme for the whole app.
        </p>
        <div class="mt-3 flex items-center justify-between gap-4">
          <span
            id="profile-dark-toggle-label"
            class="text-sm text-zinc-700 dark:text-zinc-300"
          >
            Dark mode
          </span>
          <button
            type="button"
            role="switch"
            :aria-checked="colorScheme === 'dark'"
            aria-labelledby="profile-dark-toggle-label"
            class="relative h-5 w-9 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-zinc-900"
            :class="
              colorScheme === 'dark'
                ? 'bg-indigo-600'
                : 'bg-zinc-300 dark:bg-zinc-600'
            "
            @click="setColorScheme(colorScheme === 'dark' ? 'light' : 'dark')"
          >
            <span class="sr-only">Toggle dark mode</span>
            <span
              class="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform"
              :class="
                colorScheme === 'dark' ? 'translate-x-4' : 'translate-x-0'
              "
            />
          </button>
        </div>
      </div>

      <div class="mt-6 border-t border-zinc-200 pt-5 dark:border-zinc-700">
        <p class="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          Danger zone
        </p>
        <p class="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          Permanently delete your account and all your courses, workbooks, and
          vocabulary.
        </p>
        <div class="mt-3 flex justify-end">
          <button
            type="button"
            class="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:bg-zinc-900 dark:text-red-300 dark:hover:bg-red-950/40"
            @click="openDeleteModal"
          >
            Delete account
          </button>
        </div>
      </div>

      <div class="mt-6 flex justify-end gap-2">
        <button
          type="button"
          class="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          @click="close"
        >
          Cancel
        </button>
        <button
          type="button"
          class="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
          :disabled="saving"
          @click="save"
        >
          Save
        </button>
      </div>
    </div>
  </div>

  <div
    v-if="deleteModalOpen"
    class="fixed inset-0 z-120 flex items-center justify-center bg-black/50 p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="delete-account-title"
    @click.self="closeDeleteModal"
  >
    <div
      class="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      @click.stop
    >
      <h3
        id="delete-account-title"
        class="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
      >
        Delete account?
      </h3>
      <p class="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
        This will permanently delete your account and all related data (courses,
        workbooks, vocabulary, pins, and uploads). This cannot be undone.
      </p>

      <p
        v-if="deleteError"
        class="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/50 dark:text-red-100"
        role="alert"
      >
        {{ deleteError }}
      </p>

      <div class="mt-6 flex justify-end gap-2">
        <button
          type="button"
          class="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          :disabled="deletingAccount"
          @click="closeDeleteModal"
        >
          Cancel
        </button>
        <button
          type="button"
          class="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-500 disabled:opacity-50"
          :disabled="deletingAccount"
          @click="deleteAccount"
        >
          {{ deletingAccount ? "Deleting…" : "Delete account" }}
        </button>
      </div>
    </div>
  </div>
</template>
