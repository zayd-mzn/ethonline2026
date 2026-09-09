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
