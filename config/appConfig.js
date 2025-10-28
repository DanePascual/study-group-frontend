// frontend/config/appConfig.js
// Central configuration for frontend apps (API base and helpers).
// - Uses window.API_BASE when present (easy to override at runtime).
// - Falls back to a sensible default for local development.
// - Exports API_BASE and apiUrl(path) for consistent usage across modules.

const DEFAULT_API_BASE =
  "https://study-group-backend-d8fc93ae1b7a.herokuapp.com";

// Prefer a runtime override on window for easy environment switches (staging/prod).
// You can set window.API_BASE in a server-rendered <script> tag in production.
export const API_BASE =
  (typeof window !== "undefined" && window.API_BASE) || DEFAULT_API_BASE;

// Helper: join a path to the API base in a safe way
export function apiUrl(path = "") {
  if (!path) return API_BASE;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return API_BASE.replace(/\/+$/, "") + normalized;
}
