const raw = import.meta.env.VITE_API_URL;

/** Empty string = same origin (use Vite `/api` proxy in dev). */
export const API_BASE = raw == null || String(raw).trim() === "" ? "" : String(raw).replace(/\/$/, "");

export function apiUrl(path) {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (API_BASE === "") return p;
  return `${API_BASE}${p}`;
}

export function apiOriginLabel() {
  if (API_BASE === "") return "this origin (Vite proxies /api to the backend)";
  return API_BASE;
}

export async function apiFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const body = options.body;
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  if (body != null && typeof body === "string" && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  if (isFormData) {
    delete headers["Content-Type"];
  }
  return fetch(apiUrl(path), {
    ...options,
    credentials: "include",
    headers: Object.keys(headers).length ? headers : undefined,
  });
}
