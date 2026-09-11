/**
 * Central API configuration.
 * In dev Vite proxies /api and /marketplace to the backend,
 * and /events to the agent event stream.
 * In production set VITE_BACKEND_URL and VITE_AGENT_URL.
 */
// In dev, default to a relative base ("") so requests go through Vite's proxy
// (same-origin, no CORS). The backend does not send CORS headers. Set
// VITE_BACKEND_URL for production builds served from another origin.
export const BACKEND_URL =
  (import.meta.env.VITE_BACKEND_URL as string | undefined) ??
  (import.meta.env.DEV ? "" : "http://localhost:3001");

export const AGENT_EVENTS_URL =
  (import.meta.env.VITE_AGENT_URL as string | undefined) ?? "http://localhost:3002";

/**
 * World ID 4.0 request config, served by the backend (POST /world/rp-signature).
 * The backend owns app id, action, environment and the RP signing key, so the
 * frontend never needs World env vars and can't drift out of sync with it.
 */
export interface WorldRequestConfig {
  app_id: `app_${string}`;
  action: string;
  /** "staging" = test with simulator.worldcoin.org; "production" = real World App. */
  environment: "production" | "staging";
  rp_context: {
    rp_id: string;
    nonce: string;
    created_at: number;
    expires_at: number;
    signature: string;
  };
}

/** Ask the backend for a fresh, signed World ID request. Call right before opening IDKit. */
export function fetchWorldRequestConfig(): Promise<WorldRequestConfig> {
  return apiFetch<WorldRequestConfig>(`${BACKEND_URL}/world/rp-signature`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

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
