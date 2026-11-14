import "server-only";

/**
 * Direct client for Luma's own web API (api.luma.com), authenticated with the
 * user's Luma login cookie. Used only for what needs that login — the full
 * guest list — so the cookie goes to Luma and nowhere else. Public pages still
 * go through you.com (see `luma.ts`).
 *
 * These are the endpoints luma.com's own pages call. They're undocumented, so
 * responses are read defensively. Never log the cookie or a request's headers.
 */

const API = "https://api.luma.com";
const TIMEOUT_MS = 15_000;
/** Luma's own page size for the guest list. */
const PAGE_SIZE = 100;
/** 50 pages = 5,000 guests. A runaway cursor shouldn't loop forever. */
const MAX_PAGES = 50;

/** Luma rejected the login: expired, signed out, or a bad paste. */
export class LumaAuthError extends Error {
  constructor() {
    super("Luma login rejected");
    this.name = "LumaAuthError";
  }
}

export class LumaApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
  ) {
    super(`Luma API ${path} failed: ${status}`);
    this.name = "LumaApiError";
  }
}

async function lumaGet<T>(
  path: string,
  params: Record<string, string | undefined>,
  cookie: string,
): Promise<T> {
  const qs = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => e[1] !== undefined),
  );
  const res = await fetch(`${API}${path}?${qs}`, {
    headers: {
      Accept: "application/json",
      Cookie: `luma.auth-session-key=${cookie}`,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 403) throw new LumaAuthError();
  // The error carries the path only: params can include the user's ticket key.
  if (!res.ok) throw new LumaApiError(res.status, path);
  return (await res.json()) as T;
}

/** Who this login belongs to. Throws `LumaAuthError` if it isn't valid. */
export async function getLumaUser(
  cookie: string,
): Promise<{ apiId: string; name: string | null }> {
  const body = await lumaGet<{ user?: Record<string, unknown> }>("/user", {}, cookie);
  const apiId = body.user?.api_id;
  if (typeof apiId !== "string") throw new LumaAuthError();
  const name = body.user?.name;
  return { apiId, name: typeof name === "string" && name.trim() ? name.trim() : null };
}

/**
 * An event's page data as the signed-in user sees it — the same object luma.com
 * embeds in `__NEXT_DATA__` (`hosts`, `featured_guests`, `guest_count`, …),
 * plus `guest_data` describing the user's own registration.
 */
export async function getEventAsUser(
  slug: string,
  cookie: string,
): Promise<Record<string, unknown> | null> {
  const body = await lumaGet<{ kind?: string; data?: Record<string, unknown> }>(
    "/url",
    { url: slug },
    cookie,
  );
  return body.kind === "event" && body.data ? body.data : null;
}

/**
 * Every guest Luma shows this user, following `next_cursor` until `has_more`
 * is false. Each entry's `user` has the same shape as a host on the event page.
 */
export async function getGuestList(
  eventApiId: string,
  ticketKey: string,
  cookie: string,
): Promise<unknown[]> {
  const users: unknown[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await lumaGet<{
      entries?: { user?: unknown }[];
      has_more?: boolean;
      next_cursor?: string | null;
    }>(
      "/event/get-guest-list",
      {
        event_api_id: eventApiId,
        ticket_key: ticketKey,
        pagination_limit: String(PAGE_SIZE),
        pagination_cursor: cursor,
      },
      cookie,
    );
    for (const entry of body.entries ?? []) {
      if (entry?.user) users.push(entry.user);
    }
    if (!body.has_more || !body.next_cursor) break;
    cursor = body.next_cursor;
  }
  return users;
}

// ---------------------------------------------------------------------------
// Sign-in: Luma's own email-code flow, run from our server
// ---------------------------------------------------------------------------
//
// The same calls luma.com's sign-in dialog makes. On success, Luma answers with
// a `Set-Cookie: luma.auth-session-key=…` — the login we store. Codes,
// passwords and that cookie are passed through, never logged or kept here.

/** What luma.com sends as `x-luma-client-type`. */
const CLIENT_TYPE = "luma-web";

/** Luma asks for a human check (Cloudflare Turnstile) that a server can't pass. */
export class LumaVerificationRequired extends Error {
  constructor() {
    super("Luma requires a browser verification for this sign-in");
    this.name = "LumaVerificationRequired";
  }
}

/** Luma refused a step, with a message meant for the user ("Invalid code", …). */
export class LumaSignInError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "LumaSignInError";
  }
}

export type SignInResult =
  | { kind: "signed-in"; cookie: string }
  | { kind: "two-factor"; userApiId: string; shallowSecret: string };

async function lumaPost(
  path: string,
  body: Record<string, unknown>,
): Promise<{ json: Record<string, unknown>; setCookies: string[] }> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-luma-client-type": CLIENT_TYPE,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  const json = ((await res.json().catch(() => null)) ?? {}) as Record<string, unknown>;

  if (!res.ok) {
    const code = typeof json.code === "string" ? json.code : null;
    if (code === "auth/additional-verification-required") {
      throw new LumaVerificationRequired();
    }
    if (res.status >= 400 && res.status < 500) {
      const message =
        typeof json.message === "string" && json.message.trim()
          ? json.message.trim()
          : "Luma didn't accept that.";
      throw new LumaSignInError(message, res.status);
    }
    throw new LumaApiError(res.status, path);
  }
  return { json, setCookies: res.headers.getSetCookie() };
}

/**
 * Begin signing in. Returns how this account signs in: `email-code` (Luma has
 * emailed a code), `password`, or `sso` (an identity-provider redirect that
 * only works in a browser).
 */
export async function startEmailSignIn(
  email: string,
): Promise<"email-code" | "password" | "sso"> {
  const { json } = await lumaPost("/auth/email/start-with-email", { email });
  if (json.sso_config) return "sso";
  if (json.next_step === "password") return "password";
  return "email-code";
}

/** Email a fresh sign-in code ("Resend"). */
export async function sendSignInCode(email: string): Promise<void> {
  await lumaPost("/auth/email/send-sign-in-code", { email });
}

export async function signInWithCode(email: string, code: string): Promise<SignInResult> {
  return toSignInResult(await lumaPost("/auth/email/sign-in-with-code", { email, code }));
}

export async function signInWithPassword(
  email: string,
  password: string,
): Promise<SignInResult> {
  return toSignInResult(await lumaPost("/auth/sign-in-with-password", { email, password }));
}

export async function signInWithTwoFactor(
  userApiId: string,
  shallowSecret: string,
  otp: string,
): Promise<SignInResult> {
  return toSignInResult(
    await lumaPost("/auth/sign-in-with-two-factor", {
      user_api_id: userApiId,
      two_factor_shallow_secret: shallowSecret,
      two_factor_otp: otp,
    }),
  );
}

function toSignInResult({
  json,
  setCookies,
}: {
  json: Record<string, unknown>;
  setCookies: string[];
}): SignInResult {
  if (json.step === "two_factor") {
    const userApiId = json.user_api_id;
    const shallowSecret = json.two_factor_shallow_secret;
    if (typeof userApiId === "string" && typeof shallowSecret === "string") {
      return { kind: "two-factor", userApiId, shallowSecret };
    }
  }

  const cookie = setCookies
    .map((c) => c.match(/^luma\.auth-session-key=([^;]+)/)?.[1])
    .find((v): v is string => Boolean(v));
  // Kept exactly as Luma set it (no URL-decoding): a browser sends a cookie
  // back verbatim, and so does `lumaGet`.
  if (json.signed_in && cookie) return { kind: "signed-in", cookie };

  // Signed in, but the session didn't come back as a cookie we can keep.
  throw new LumaApiError(200, "sign-in: no session cookie in response");
}
