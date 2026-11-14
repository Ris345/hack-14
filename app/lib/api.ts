import type {
  Enrichment,
  EventParticipants,
  LumaConnection,
  LumaSignInStep,
  User,
} from "./types";

export type { Enrichment, EventParticipants, LumaConnection, LumaSignInStep, User };

/** A failed API call. `code: "luma_auth"` means the stored Luma login stopped working. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function call<T>(path: string, init: RequestInit, fallback: string): Promise<T> {
  const res = await fetch(path, init);
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(json?.error ?? `${fallback} (${res.status}).`, res.status, json?.code);
  }
  return json as T;
}

const postJson = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** Whether the user has connected their Luma login, and as whom. */
export function fetchLumaConnection(): Promise<LumaConnection> {
  return call("/api/luma/connect", { cache: "no-store" }, "Couldn't check Luma");
}

/** Store the user's `luma.auth-session-key` (encrypted, server-side). */
export function connectLuma(cookie: string): Promise<LumaConnection> {
  return call("/api/luma/connect", postJson({ cookie }), "Couldn't connect Luma");
}

/** One step of signing in to Luma by email code. See `/api/luma/signin`. */
export function lumaSignIn(
  body:
    | { step: "start" | "resend"; email: string }
    | { step: "code"; email: string; code: string }
    | { step: "password"; email: string; password: string }
    | { step: "two-factor"; otp: string },
): Promise<LumaSignInStep> {
  return call("/api/luma/signin", postJson(body), "Couldn't sign in to Luma");
}

export async function disconnectLuma(): Promise<void> {
  const res = await fetch("/api/luma/connect", { method: "DELETE" });
  if (!res.ok) throw new ApiError("Couldn't disconnect Luma.", res.status);
}
export type { Participant, Socials } from "./types";

/** What one participant's social pages say about them. */
export function fetchEnrichment(
  eventUrl: string,
  personId: string,
): Promise<Enrichment> {
  return call("/api/luma/enrich", postJson({ url: eventUrl, personId }), "Enrichment failed");
}

/**
 * Look up an event's participants: the full guest list if Luma is connected
 * and the user can see it, else hosts and featured guests. Throws `ApiError`
 * with a message fit for the UI.
 */
export function fetchEventParticipants(url: string): Promise<EventParticipants> {
  return call("/api/luma/participants", postJson({ url }), "Lookup failed");
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
