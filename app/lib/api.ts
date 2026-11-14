import type { User } from "./types";

export type { User };

/**
 * The API routes live in this same app, so these are relative paths: no CORS,
 * and the session cookie rides along on same-origin requests by default.
 */
export const loginUrl = "/api/auth/login";

export async function fetchMe(): Promise<User | null> {
  const res = await fetch("/api/auth/me", { cache: "no-store" });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`/api/auth/me failed: ${res.status}`);
  return res.json();
}

export async function logout(): Promise<void> {
  const res = await fetch("/api/auth/logout", { method: "POST" });
  if (!res.ok) throw new Error(`/api/auth/logout failed: ${res.status}`);
}
