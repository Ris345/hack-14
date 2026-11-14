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
