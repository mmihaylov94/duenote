<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { apiFetch, apiUrl } from "../api/client.js";

const route = useRoute();
const router = useRouter();

const googleHref = computed(() => apiUrl("/auth/google"));

const email = ref("");
const code = ref("");
const busy = ref(false);
const message = ref("");
const error = ref("");
/** Shown after a valid email gets a successful OTP send */
const showOtpStep = ref(false);
/** Seconds until resend is allowed (0 = allowed when OTP step is showing) */
const resendSecondsLeft = ref(0);
let resendIntervalId = null;

function clearResendCooldown() {
  if (resendIntervalId != null) {
    clearInterval(resendIntervalId);
    resendIntervalId = null;
  }
  resendSecondsLeft.value = 0;
}

function startResendCooldown() {
  clearResendCooldown();
  resendSecondsLeft.value = 10;
  resendIntervalId = window.setInterval(() => {
    resendSecondsLeft.value -= 1;
    if (resendSecondsLeft.value <= 0) {
      clearResendCooldown();
    }
  }, 1000);
}

function isValidEmail(s) {
  const t = String(s).trim();
  if (t.length < 3 || t.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

watch(email, () => {
  showOtpStep.value = false;
  code.value = "";
  clearResendCooldown();
});

onUnmounted(() => {
  clearResendCooldown();
});

onMounted(() => {
  const q = route.query.error;
  if (q === "google") {
    error.value = "Google sign-in was cancelled or failed.";
  } else if (q === "email") {
    error.value = "Could not read your email from Google.";
  } else if (q === "config") {
    error.value = "Google sign-in is not configured on the server.";
  } else if (q === "closed") {
    error.value = "Registrations are currently closed for this app.";
  }
});

/** Sends OTP email; returns true on success */
async function sendOtpEmail() {
  message.value = "";
  error.value = "";
  if (!isValidEmail(email.value)) {
    error.value = "Enter a valid email address.";
    return false;
  }
  busy.value = true;
  try {
    const r = await apiFetch("/api/auth/email/request", {
      method: "POST",
      body: JSON.stringify({ email: email.value.trim() }),
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      error.value = data.error || `Request failed (${r.status})`;
      return false;
    }
    message.value = "Check your inbox for a 6-digit code.";
    return true;
  } catch {
    error.value = "Cannot reach the server.";
    return false;
  } finally {
    busy.value = false;
  }
}

async function requestCode() {
  const ok = await sendOtpEmail();
  if (!ok) return;
  showOtpStep.value = true;
  startResendCooldown();
}

async function resendCode() {
  if (busy.value || resendSecondsLeft.value > 0) return;
  const ok = await sendOtpEmail();
  if (ok) startResendCooldown();
}

async function verifyCode() {
  message.value = "";
  error.value = "";
  busy.value = true;
  try {
    const r = await apiFetch("/api/auth/email/verify", {
      method: "POST",
      body: JSON.stringify({
        email: email.value.trim(),
        code: code.value.trim(),
      }),
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      error.value = data.error || "Invalid or expired code";
      return;
    }
    const redirect =
      typeof route.query.redirect === "string" ? route.query.redirect : "/app";
    router.replace(redirect || "/app");
  } catch {
    error.value = "Cannot reach the server.";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-zinc-100 dark:bg-zinc-950">
    <header
      class="border-b border-zinc-200/80 bg-white/90 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-900/90"
    >
      <div class="mx-auto flex max-w-6xl items-center px-4 py-4 sm:px-6">
        <router-link
          to="/"
          class="group flex items-center gap-2.5 rounded-xl outline-none ring-indigo-500/40 ring-offset-2 ring-offset-white focus-visible:ring-2 dark:ring-offset-zinc-900"
          aria-label="DueNote home"
        >
          <span
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-sm font-bold text-white shadow-sm transition group-hover:bg-indigo-500"
            aria-hidden="true"
            >DN</span
          >
          <span
            class="text-lg font-semibold tracking-tight text-zinc-900 transition group-hover:text-indigo-600 dark:text-zinc-100 dark:group-hover:text-indigo-400"
            >DueNote</span
          >
        </router-link>
      </div>
    </header>
    <main
      class="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-4 py-16 sm:px-6 sm:py-20"
    >
      <div class="mx-auto w-full max-w-md">
        <h1
          class="mb-8 text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100"
        >
          Sign in
        </h1>
        <p
          v-if="error"
          class="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/50 dark:text-red-100"
          role="alert"
        >
          {{ error }}
        </p>
        <p
          v-if="message"
          class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-100"
        >
          {{ message }}
        </p>

        <template v-if="!showOtpStep">
          <label
            class="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            for="login-email"
            >Email</label
          >
          <input
            id="login-email"
            v-model="email"
            type="email"
            autocomplete="email"
            class="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
            placeholder="you@example.com"
          />

          <button
            type="button"
            class="mt-3 w-full rounded-lg bg-zinc-800 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white"
            :disabled="busy || !isValidEmail(email)"
            @click="requestCode"
          >
            Sign in
          </button>

          <div class="relative my-8">
            <div class="absolute inset-0 flex items-center" aria-hidden="true">
              <div
                class="w-full border-t border-zinc-200 dark:border-zinc-700"
              />
            </div>
            <div class="relative flex justify-center text-xs uppercase">
              <span
                class="bg-zinc-100 px-2 text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400"
                >Or</span
              >
            </div>
          </div>

          <a
            :href="googleHref"
            class="flex w-full items-center justify-center gap-3 rounded-lg border border-zinc-300 bg-white px-4 py-3 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <svg
              class="h-5 w-5 shrink-0"
              viewBox="0 0 24 24"
              aria-hidden="true"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Sign in with Google
          </a>
        </template>

        <template v-else>
          <label
            class="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            for="login-code"
            >Code</label
          >
          <input
            id="login-code"
            v-model="code"
            type="text"
            inputmode="numeric"
            maxlength="8"
            autocomplete="one-time-code"
            class="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
            placeholder="6-digit code"
          />

          <button
            type="button"
            class="mt-3 w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
            :disabled="busy || !code.trim()"
            @click="verifyCode"
          >
            Continue
          </button>

          <button
            type="button"
            class="mt-3 w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            :disabled="busy || resendSecondsLeft > 0"
            @click="resendCode"
          >
            <span v-if="resendSecondsLeft > 0"
              >Resend code in {{ resendSecondsLeft }}s</span
            >
            <span v-else>Resend code</span>
          </button>
        </template>
      </div>
    </main>
  </div>
</template>
