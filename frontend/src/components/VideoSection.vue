<script setup>
import { computed } from "vue";

const section = defineModel({ type: Object, required: true });

function normalizeUrl(s) {
  let v = String(s ?? "").trim();
  if (!v) return "";
  if (/^www\./i.test(v)) v = `https://${v}`;
  if (!/^https?:\/\//i.test(v)) return v;
  try {
    return new URL(v).toString();
  } catch {
    return v;
  }
}

function toYouTubeEmbed(raw) {
  const u = normalizeUrl(raw);
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) return null;
  let url;
  try {
    url = new URL(u);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./i, "").toLowerCase();
  let id = null;

  if (host === "youtu.be") {
    id = url.pathname.replace(/^\//, "") || null;
  } else if (host === "youtube.com" || host === "m.youtube.com") {
    if (url.pathname === "/watch") {
      id = url.searchParams.get("v");
    } else if (url.pathname.startsWith("/embed/")) {
      id = url.pathname.split("/")[2] || null;
    } else if (url.pathname.startsWith("/shorts/")) {
      id = url.pathname.split("/")[2] || null;
    }
  }

  if (!id) return null;
  id = id.split("?")[0].split("&")[0].trim();
  if (!/^[A-Za-z0-9_-]{6,}$/.test(id)) return null;

  const start = url.searchParams.get("t") || url.searchParams.get("start");
  const embed = new URL(`https://www.youtube-nocookie.com/embed/${id}`);
  if (start && /^\d+$/.test(String(start))) embed.searchParams.set("start", String(start));
  return embed.toString();
}

const embedUrl = computed(() => toYouTubeEmbed(section.value.url));
const isValid = computed(() => embedUrl.value != null);
</script>

<template>
  <div class="overflow-hidden rounded-xl border border-zinc-200 bg-black shadow-sm dark:border-zinc-700">
    <div v-if="isValid" class="aspect-video w-full">
      <iframe
        class="h-full w-full"
        :src="embedUrl"
        title="YouTube video"
        frameborder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerpolicy="strict-origin-when-cross-origin"
        allowfullscreen
      />
    </div>
    <div v-else class="flex aspect-video w-full items-center justify-center bg-zinc-900 px-4 text-sm text-zinc-200">
      Video link is missing or invalid.
    </div>
  </div>
</template>

