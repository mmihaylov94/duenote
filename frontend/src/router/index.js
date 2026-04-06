import { createRouter, createWebHistory } from "vue-router";
import Home from "../views/Home.vue";
import Login from "../views/Login.vue";
import NotebookApp from "../NotebookApp.vue";
import { apiFetch } from "../api/client.js";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "home", component: Home },
    { path: "/login", name: "login", component: Login },
    {
      path: "/app",
      name: "app",
      component: NotebookApp,
      meta: { requiresAuth: true },
    },
  ],
});

router.beforeEach(async (to, _from, next) => {
  if (!to.meta.requiresAuth) {
    return next();
  }
  try {
    const r = await apiFetch("/api/auth/me");
    if (r.ok) {
      return next();
    }
  } catch {
    /* network error - still send to login */
  }
  next({ name: "login", query: { redirect: to.fullPath } });
});

export default router;
