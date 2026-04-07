<script setup>
import { QuillEditor } from "@vueup/vue-quill";
import "@vueup/vue-quill/dist/vue-quill.snow.css";

const section = defineModel({ type: Object, required: true });

const LABELS = {
  grammar: "Grammar",
};

/** Rich toolbar: headings, emphasis, colors (incl. highlight), lists, indent, align, quote, code, link, image */
const toolbarOptions = [
  [{ header: [1, 2, 3, false] }],
  ["bold", "italic", "underline", "strike"],
  [{ color: [] }, { background: [] }],
  [{ script: "sub" }, { script: "super" }],
  [{ list: "ordered" }, { list: "bullet" }],
  [{ indent: "-1" }, { indent: "+1" }],
  [{ align: [] }],
  ["blockquote", "code-block"],
  ["link", "image"],
  ["clean"],
];
</script>

<template>
  <div
    data-dictionary-host
    class="grammar-quill rounded-xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
  >
    <QuillEditor
      :key="section.id"
      v-model:content="section.text"
      content-type="html"
      theme="snow"
      :toolbar="toolbarOptions"
      :placeholder="(LABELS[section.type] || 'Grammar') + '…'"
      class="grammar-quill-editor"
    />
  </div>
</template>

<style scoped>
.grammar-quill :deep(.grammar-quill-editor) {
  display: flex;
  flex-direction: column;
}

/* Light (default) */
.grammar-quill :deep(.ql-toolbar.ql-snow) {
  border-color: rgb(212 212 216);
  border-radius: 0.375rem 0.375rem 0 0;
  background-color: rgb(250 250 250);
}

.grammar-quill :deep(.ql-container.ql-snow) {
  border-color: rgb(212 212 216);
  border-radius: 0 0 0.375rem 0.375rem;
  font-family: ui-sans-serif, system-ui, sans-serif;
}

.grammar-quill :deep(.ql-editor) {
  min-height: 17.5rem;
  font-size: 0.875rem;
  line-height: 1.625;
  color: rgb(24 24 27);
  background-color: white;
}

.grammar-quill :deep(.ql-editor.ql-blank::before) {
  color: rgb(161 161 170);
  font-style: normal;
}

.grammar-quill :deep(.ql-snow .ql-picker-label) {
  color: rgb(63 63 70);
}

.grammar-quill :deep(.ql-snow .ql-stroke) {
  stroke: rgb(63 63 70);
}

.grammar-quill :deep(.ql-snow .ql-fill) {
  fill: rgb(63 63 70);
}

/* Dark theme only when `html.dark` is set (app toggle). Do not use prefers-color-scheme here,
   or the editor stays dark while the rest of the app is light. */
.dark .grammar-quill :deep(.ql-toolbar.ql-snow) {
  border-color: rgb(63 63 70);
  background-color: rgb(24 24 27);
}

.dark .grammar-quill :deep(.ql-container.ql-snow) {
  border-color: rgb(63 63 70);
}

.dark .grammar-quill :deep(.ql-editor) {
  color: rgb(244 244 245);
  background-color: rgb(9 9 11);
}

.dark .grammar-quill :deep(.ql-editor.ql-blank::before) {
  color: rgb(113 113 122);
}

.dark .grammar-quill :deep(.ql-snow .ql-picker-label) {
  color: rgb(212 212 216);
}

.dark .grammar-quill :deep(.ql-snow .ql-picker-label:hover),
.dark .grammar-quill :deep(.ql-snow .ql-picker-label.ql-active) {
  color: rgb(244 244 245);
}

.dark .grammar-quill :deep(.ql-snow .ql-stroke) {
  stroke: rgb(212 212 216);
}

.dark .grammar-quill :deep(.ql-snow .ql-fill) {
  fill: rgb(212 212 216);
}

.dark .grammar-quill :deep(.ql-snow .ql-picker.ql-expanded .ql-picker-label) {
  border-color: rgb(82 82 91);
}

.dark .grammar-quill :deep(.ql-snow .ql-picker-options) {
  border-color: rgb(63 63 70);
  background-color: rgb(24 24 27);
}

.dark .grammar-quill :deep(.ql-snow .ql-picker-item) {
  color: rgb(228 228 231);
}

.dark .grammar-quill :deep(.ql-snow .ql-picker-item:hover),
.dark .grammar-quill :deep(.ql-snow .ql-picker-item.ql-selected) {
  color: rgb(250 250 250);
  background-color: rgb(39 39 42);
}

.dark .grammar-quill :deep(.ql-snow.ql-toolbar button:hover),
.dark .grammar-quill :deep(.ql-snow .ql-toolbar button:hover) {
  color: rgb(250 250 250);
}

.dark .grammar-quill :deep(.ql-snow.ql-toolbar button:hover .ql-stroke),
.dark .grammar-quill :deep(.ql-snow .ql-toolbar button:hover .ql-stroke) {
  stroke: rgb(250 250 250);
}

.dark .grammar-quill :deep(.ql-snow.ql-toolbar button:hover .ql-fill),
.dark .grammar-quill :deep(.ql-snow .ql-toolbar button:hover .ql-fill) {
  fill: rgb(250 250 250);
}

.dark .grammar-quill :deep(.ql-snow.ql-toolbar button.ql-active),
.dark .grammar-quill :deep(.ql-snow .ql-toolbar button.ql-active) {
  color: rgb(199 210 254);
}

.dark .grammar-quill :deep(.ql-snow.ql-toolbar button.ql-active .ql-stroke),
.dark .grammar-quill :deep(.ql-snow .ql-toolbar button.ql-active .ql-stroke) {
  stroke: rgb(165 180 252);
}

.dark .grammar-quill :deep(.ql-snow.ql-toolbar button.ql-active .ql-fill),
.dark .grammar-quill :deep(.ql-snow .ql-toolbar button.ql-active .ql-fill) {
  fill: rgb(165 180 252);
}

.dark .grammar-quill :deep(.ql-snow a) {
  color: rgb(165 180 252);
}

.dark .grammar-quill :deep(.ql-tooltip) {
  border-color: rgb(63 63 70);
  background-color: rgb(24 24 27);
  color: rgb(228 228 231);
  box-shadow:
    0 4px 6px -1px rgb(0 0 0 / 0.4),
    0 2px 4px -2px rgb(0 0 0 / 0.3);
}

.dark .grammar-quill :deep(.ql-tooltip input[type="text"]) {
  border-color: rgb(63 63 70);
  background-color: rgb(9 9 11);
  color: rgb(244 244 245);
}

.dark .grammar-quill :deep(.ql-tooltip a.ql-action),
.dark .grammar-quill :deep(.ql-tooltip a.ql-remove) {
  color: rgb(165 180 252);
}

.dark .grammar-quill :deep(.ql-editor blockquote) {
  border-left-color: rgb(82 82 91);
  color: rgb(212 212 216);
}

.dark .grammar-quill :deep(.ql-editor pre.ql-syntax) {
  background-color: rgb(24 24 27);
  color: rgb(228 228 231);
  border: 1px solid rgb(63 63 70);
}
</style>
