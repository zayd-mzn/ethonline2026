/**
 * Central API configuration.
 * In dev Vite proxies /api and /marketplace to the backend,
 * and /events to the agent event stream.
 * In production set VITE_BACKEND_URL and VITE_AGENT_URL.
 */
export const BACKEND_URL =
  (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? "http://localhost:3001";

export const AGENT_EVENTS_URL =
  (import.meta.env.VITE_AGENT_URL as string | undefined) ?? "http://localhost:3002";

/** World ID app id (public — ships in the bundle). From the World Dev Portal. */
export const WORLD_APP_ID =
  (import.meta.env.VITE_WORLD_APP_ID as `app_${string}` | undefined) ??
  "app_e2c0af203369e1d934c1782a8abd051a";

/** World Incognito Action — must match the backend's WORLD_ACTION. */
export const WORLD_ACTION =
  (import.meta.env.VITE_WORLD_ACTION as string | undefined) ?? "publish-service";

/** Shared fetch wrapper — throws on non-2xx with the API error message. */
export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      message = body?.message ?? body?.error ?? message;
    } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}
