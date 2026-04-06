<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import {
  EllipsisVerticalIcon,
  Cog6ToothIcon,
  ArrowRightOnRectangleIcon,
} from "@heroicons/vue/20/solid";

const props = defineProps({
  user: {
    type: Object,
    default: null,
  },
  collapsed: { type: Boolean, default: false },
});

const emit = defineEmits(["open-settings", "sign-out"]);

const menuOpen = ref(false);
const avatarBroken = ref(false);

watch(
  () => props.user?.avatarUrl,
  () => {
    avatarBroken.value = false;
  },
);

const initials = computed(() => {
  const u = props.user;
  if (!u) return "?";
  const name = (u.displayName || u.email || "?").trim();
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase().slice(0, 2);
  }
  return name.slice(0, 2).toUpperCase() || "?";
});

const primaryLabel = computed(() => {
  const u = props.user;
  if (!u) return "…";
  if (u.displayName && String(u.displayName).trim()) return String(u.displayName).trim();
  return u.email || "Account";
});

const emailLabel = computed(() => props.user?.email || "");

function toggleMenu() {
  menuOpen.value = !menuOpen.value;
}

function closeMenu() {
  menuOpen.value = false;
}

function onOpenSettings() {
  closeMenu();
  emit("open-settings");
}

function onSignOut() {
  closeMenu();
  emit("sign-out");
}

function onDocPointerDown(e) {
  if (!(e.target instanceof Element)) return;
  if (e.target.closest("[data-profile-menu]")) return;
  menuOpen.value = false;
}

function onDocKeydown(e) {
  if (e.key === "Escape") menuOpen.value = false;
}

onMounted(() => {
  document.addEventListener("pointerdown", onDocPointerDown, true);
  document.addEventListener("keydown", onDocKeydown);
});

onUnmounted(() => {
  document.removeEventListener("pointerdown", onDocPointerDown, true);
  document.removeEventListener("keydown", onDocKeydown);
});
</script>

<template>
  <div
    v-if="user"
    class="shrink-0 border-t border-zinc-200 bg-zinc-50/90 p-2 dark:border-zinc-800 dark:bg-zinc-950/50"
    data-profile-menu
  >
    <!-- Collapsed: avatar + menu -->
    <div v-if="collapsed" class="relative flex flex-col items-center gap-2">
      <div class="relative">
        <button
          type="button"
          class="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-zinc-200 bg-zinc-100 text-xs font-semibold text-zinc-700 ring-2 ring-white dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:ring-zinc-900"
          :aria-label="`Account: ${primaryLabel}`"
          @click="toggleMenu"
        >
          <img
            v-if="user.avatarUrl && !avatarBroken"
            :src="user.avatarUrl"
            alt=""
            class="h-full w-full object-cover"
            @error="avatarBroken = true"
          />
          <span v-else aria-hidden="true">{{ initials }}</span>
        </button>
        <div
          v-show="menuOpen"
          class="absolute bottom-full left-1/2 z-40 mb-1 w-48 -translate-x-1/2 rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          role="menu"
        >
          <button
            type="button"
            class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-800 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            role="menuitem"
            @click="onOpenSettings"
          >
            <Cog6ToothIcon class="h-4 w-4 shrink-0 text-zinc-500" aria-hidden="true" />
            Settings
          </button>
          <button
            type="button"
            class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
            role="menuitem"
            @click="onSignOut"
          >
            <ArrowRightOnRectangleIcon class="h-4 w-4 shrink-0" aria-hidden="true" />
            Sign out
          </button>
        </div>
      </div>
    </div>

    <!-- Expanded -->
    <div v-else class="relative flex items-center gap-2">
      <div
        class="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-zinc-200 bg-zinc-100 text-xs font-semibold text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
      >
        <img
          v-if="user.avatarUrl && !avatarBroken"
          :src="user.avatarUrl"
          alt=""
          class="h-full w-full object-cover"
          @error="avatarBroken = true"
        />
        <span v-else aria-hidden="true">{{ initials }}</span>
      </div>
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100" :title="primaryLabel">
          {{ primaryLabel }}
        </p>
        <p class="truncate text-xs text-zinc-500 dark:text-zinc-400" :title="emailLabel">
          {{ emailLabel }}
        </p>
      </div>
      <div class="relative shrink-0">
        <button
          type="button"
          class="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-200/80 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          :aria-expanded="menuOpen"
          aria-haspopup="true"
          aria-label="Account menu"
          @click.stop="toggleMenu"
        >
          <EllipsisVerticalIcon class="h-5 w-5" aria-hidden="true" />
        </button>
        <div
          v-show="menuOpen"
          class="absolute bottom-full right-0 z-40 mb-1 min-w-[11rem] rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          role="menu"
        >
          <button
            type="button"
            class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-800 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            role="menuitem"
            @click="onOpenSettings"
          >
            <Cog6ToothIcon class="h-4 w-4 shrink-0 text-zinc-500" aria-hidden="true" />
            Settings
          </button>
          <button
            type="button"
            class="flex w-full items-center gap-2 border-t border-zinc-100 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:border-zinc-800 dark:text-red-400 dark:hover:bg-red-950/40"
            role="menuitem"
            @click="onSignOut"
          >
            <ArrowRightOnRectangleIcon class="h-4 w-4 shrink-0" aria-hidden="true" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
