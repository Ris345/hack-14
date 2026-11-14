import type { EventParticipants, User } from "./types";

export type { EventParticipants, User };
export type { Participant, Socials } from "./types";

/** Look up an event's public participants. Throws with a message fit for the UI. */
export async function fetchEventParticipants(
  url: string,
): Promise<EventParticipants> {
  const res = await fetch("/api/luma/participants", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(json?.error ?? `Lookup failed (${res.status}).`);
  }
  return json as EventParticipants;
}

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
