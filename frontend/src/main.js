import { createApp } from "vue";
import "./style.css";
import App from "./App.vue";
import router from "./router";
import { initColorScheme } from "./composables/useColorScheme.js";

initColorScheme();

createApp(App).use(router).mount("#app");
