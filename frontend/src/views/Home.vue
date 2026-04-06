<script setup>
import {
  BookOpenIcon,
  Square2StackIcon,
  LanguageIcon,
  MagnifyingGlassIcon,
} from "@heroicons/vue/24/outline";

const bgImage =
  "https://images.unsplash.com/photo-1524996297912-2818568f29ca?auto=format&fit=crop&w=2400&q=85";

const features = [
  {
    icon: BookOpenIcon,
    title: "Courses & workbooks",
    description:
      "Group material by course, then build as many workbooks as you need-each with its own sections and pace.",
  },
  {
    icon: Square2StackIcon,
    title: "Rich sections",
    description:
      "Headers, side‑by‑side translation blocks, vocabulary tables, and free text-auto‑saved as you type.",
  },
  {
    icon: LanguageIcon,
    title: "DeepL translation",
    description:
      "Translate inside your workbook with DeepL using the same language codes you use in the UI.",
  },
  {
    icon: MagnifyingGlassIcon,
    title: "Course vocabulary",
    description:
      "See every vocabulary row across a course in one searchable, filterable view-ordered like your notes.",
  },
];
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-zinc-950 text-zinc-100">
    <!-- Hero -->
    <section class="relative flex min-h-[min(92dvh,900px)] flex-col">
      <div
        class="absolute inset-0 bg-cover bg-center bg-no-repeat"
        :style="{ backgroundImage: `url('${bgImage}')` }"
        role="img"
        aria-label=""
      />
      <div
        class="absolute inset-0 bg-linear-to-b from-zinc-950/85 via-zinc-950/65 to-zinc-950"
      />
      <div
        class="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(99,102,241,0.25),transparent)]"
      />

      <header
        class="relative z-10 border-b border-white/10 bg-zinc-950/40 backdrop-blur-md"
      >
        <div
          class="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6"
        >
          <span class="text-xl font-semibold tracking-tight text-white"
            >DueNote</span
          >
          <nav class="flex items-center gap-3">
            <a
              href="#features"
              class="hidden text-sm font-medium text-zinc-300 transition hover:text-white sm:inline"
            >
              Features
            </a>
            <router-link
              to="/login"
              class="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-zinc-900 shadow-lg shadow-black/20 transition hover:bg-zinc-100"
            >
              Sign in
            </router-link>
          </nav>
        </div>
      </header>

      <div
        class="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-4 pb-20 pt-12 sm:px-6 sm:pb-24 sm:pt-16"
      >
        <p
          class="mb-4 inline-flex w-fit items-center rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium uppercase tracking-wider text-indigo-200"
        >
          Language learning notebook
        </p>
        <h1
          class="max-w-3xl text-4xl font-bold leading-[1.1] tracking-tight text-white sm:text-5xl lg:text-6xl"
        >
          Learn languages with structure -
          <span class="text-indigo-300">not chaos</span>.
        </h1>
        <p
          class="mt-6 max-w-2xl text-lg leading-relaxed text-zinc-300 sm:text-xl"
        >
          Organize courses and workbooks, mix vocabulary and translation in one
          place, and review everything in a unified vocabulary view when you're
          ready to drill.
        </p>
        <div class="mt-10 flex flex-wrap items-center gap-4">
          <router-link
            to="/login"
            class="inline-flex items-center justify-center rounded-full bg-indigo-500 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-indigo-500/30 transition hover:bg-indigo-400"
          >
            Get started
          </router-link>
          <a
            href="#features"
            class="inline-flex items-center justify-center rounded-full border border-white/20 bg-white/5 px-8 py-3.5 text-base font-medium text-white backdrop-blur-sm transition hover:bg-white/10"
          >
            See features
          </a>
        </div>
      </div>

      <div
        class="relative z-10 flex justify-center pb-8 text-zinc-500"
        aria-hidden="true"
      >
        <div
          class="h-8 w-px bg-linear-to-b from-transparent via-zinc-600 to-transparent"
        />
      </div>
    </section>

    <!-- Features -->
    <section
      id="features"
      class="relative scroll-mt-20 bg-zinc-100 py-20 dark:bg-zinc-900"
    >
      <div class="mx-auto max-w-6xl px-4 sm:px-6">
        <div class="mx-auto max-w-2xl text-center">
          <h2
            class="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white sm:text-4xl"
          >
            Built for serious learners
          </h2>
          <p class="mt-4 text-lg text-zinc-600 dark:text-zinc-400">
            Everything in one workspace-no tab-hopping, no lost notes.
          </p>
        </div>

        <div class="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
          <article
            v-for="(f, i) in features"
            :key="i"
            class="group relative overflow-hidden rounded-2xl border border-zinc-200/80 bg-white p-8 shadow-sm transition hover:border-indigo-200/80 hover:shadow-md dark:border-zinc-700/80 dark:bg-zinc-800/50 dark:hover:border-indigo-500/30"
          >
            <div
              class="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400"
            >
              <component :is="f.icon" class="h-7 w-7" aria-hidden="true" />
            </div>
            <h3 class="text-lg font-semibold text-zinc-900 dark:text-white">
              {{ f.title }}
            </h3>
            <p
              class="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400"
            >
              {{ f.description }}
            </p>
            <div
              class="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-indigo-500/0 transition group-hover:bg-indigo-500/6"
            />
          </article>
        </div>
      </div>
    </section>

    <!-- Bottom CTA -->
    <section
      class="border-t border-zinc-200 bg-white py-16 dark:border-zinc-800 dark:bg-zinc-950"
    >
      <div
        class="mx-auto flex max-w-6xl flex-col items-center justify-between gap-8 px-4 text-center sm:flex-row sm:text-left sm:px-6"
      >
        <div>
          <h2
            class="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white"
          >
            Ready to open your notebook?
          </h2>
          <p class="mt-2 text-zinc-600 dark:text-zinc-400">
            Sign in with Google or email-no passwords to remember.
          </p>
        </div>
        <router-link
          to="/login"
          class="shrink-0 rounded-full bg-indigo-600 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:bg-indigo-500"
        >
          Sign in
        </router-link>
      </div>
    </section>

    <footer
      class="border-t border-zinc-200 bg-zinc-50 py-6 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-500"
    >
      <p>DueNote - your language-learning workspace.</p>
    </footer>
  </div>
</template>
