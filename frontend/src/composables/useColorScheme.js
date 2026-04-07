import { ref } from "vue";

const STORAGE_KEY = "duenote-theme";

function readStored() {
  try {
    const t = localStorage.getItem(STORAGE_KEY);
    if (t === "light" || t === "dark") return t;
  } catch {
    /* ignore */
  }
  return null;
}

function systemPrefersDark() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

/** Current theme: `light` or `dark` (resolved, including first-visit system default). */
export const colorScheme = ref("light");

export function getResolvedTheme() {
  const stored = readStored();
  if (stored === "light" || stored === "dark") return stored;
  return systemPrefersDark() ? "dark" : "light";
}

export function applyColorScheme(theme) {
  const isDark = theme === "dark";
  document.documentElement.classList.toggle("dark", isDark);
  document.documentElement.style.colorScheme = isDark ? "dark" : "light";
}

export function setColorScheme(theme) {
  if (theme !== "light" && theme !== "dark") return;
  colorScheme.value = theme;
  applyColorScheme(theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
}

export function initColorScheme() {
  colorScheme.value = getResolvedTheme();
  applyColorScheme(colorScheme.value);
}
