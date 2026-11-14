import "server-only";

import { contents } from "./you";
import type { EventParticipants, Participant, Socials } from "./types";

/**
 * Pull the public participants of a Luma event page, fetched through the
 * you.com Contents API.
 *
 * Luma renders event pages with Next.js and embeds the page data as JSON in
 * `<script id="__NEXT_DATA__">`. That JSON carries the hosts and the guests
 * Luma "features" publicly (about ten), each with whatever social handles they
 * listed. The full guest list is behind Luma's login and isn't on the page.
 */

const LUMA_HOSTS = new Set(["luma.com", "www.luma.com", "lu.ma", "www.lu.ma"]);
const SLUG = /^[A-Za-z0-9_-]+$/;

/** User-facing failure: the message is safe to show in the UI. */
export class LumaError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "LumaError";
  }
}

/**
 * Validate an event link and reduce it to `https://luma.com/<slug>`.
 *
 * The query string is dropped on purpose: `?tk=…` is a personal invite token,
 * and it shouldn't be sent to a third party or split the cache.
 */
export function normalizeEventUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new LumaError("That isn't a valid URL.", 400);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new LumaError("That isn't a valid URL.", 400);
  }
  if (!LUMA_HOSTS.has(url.hostname.toLowerCase())) {
    throw new LumaError("Enter a luma.com event link.", 400);
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 1 || !SLUG.test(segments[0])) {
    throw new LumaError(
      "Enter a link to a single event, like https://luma.com/my-event.",
      400,
    );
  }
  return `https://luma.com/${segments[0]}`;
}

export async function getEventParticipants(
  input: string,
): Promise<EventParticipants> {
  const url = normalizeEventUrl(input);

  // Luma pages are heavy; give the crawler time to finish.
  const page = await contents(url, { formats: ["html"], crawlTimeout: 30 });
  if (!page?.html) {
    throw new LumaError("Couldn't load that event page.", 502);
  }

  const data = extractPageData(page.html);
  if (!data) {
    throw new LumaError(
      "That page doesn't look like a public Luma event.",
      422,
    );
  }

  const hosts = asArray(data.hosts).map((u) => toParticipant(u, "host"));
  const hostIds = new Set(hosts.map((h) => h.id));
  const guests = asArray(data.featured_guests)
    .map((u) => toParticipant(u, "guest"))
    .filter((g) => !hostIds.has(g.id));

  const event = (data.event ?? {}) as Record<string, unknown>;
  return {
    event: {
      name: str(event.name) ?? "Untitled event",
      url,
      startAt: str(event.start_at) ?? str(data.start_at),
    },
    guestCount: typeof data.guest_count === "number" ? data.guest_count : null,
    participants: [...hosts, ...guests],
  };
}

/** `props.pageProps.initialData.data` from the embedded Next.js JSON. */
function extractPageData(html: string): Record<string, unknown> | null {
  const match = html.match(
    /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!match) return null;
  try {
    const json = JSON.parse(match[1]);
    const data = json?.props?.pageProps?.initialData?.data;
    return data && typeof data === "object" && data.event ? data : null;
  } catch {
    return null;
  }
}

function toParticipant(raw: unknown, role: Participant["role"]): Participant {
  const u = (raw ?? {}) as Record<string, unknown>;
  const id = str(u.api_id) ?? "";
  const username = str(u.username);
  const name =
    str(u.name) ??
    ([str(u.first_name), str(u.last_name)].filter(Boolean).join(" ") ||
      "Unknown");

  const socials: Socials = {
    luma: id || username ? `https://luma.com/user/${username ?? id}` : undefined,
    linkedin: profileUrl("https://www.linkedin.com", u.linkedin_handle, ""),
    twitter: profileUrl("https://x.com", u.twitter_handle),
    instagram: profileUrl("https://www.instagram.com", u.instagram_handle),
    tiktok: profileUrl("https://www.tiktok.com", u.tiktok_handle, "@"),
    youtube: profileUrl("https://www.youtube.com", u.youtube_handle, "@"),
    website: websiteUrl(u.website),
  };
  for (const key of Object.keys(socials) as (keyof Socials)[]) {
    if (!socials[key]) delete socials[key];
  }

  return {
    id,
    name,
    role,
    avatarUrl: str(u.avatar_url),
    bio: str(u.bio_short),
    socials,
  };
}

/**
 * Turn a stored handle into a profile URL. Handles come in several shapes:
 * `jdoe`, `@jdoe`, `/in/jdoe` (LinkedIn), or occasionally a full URL.
 */
function profileUrl(
  base: string,
  handle: unknown,
  prefix = "",
): string | undefined {
  const h = str(handle);
  if (!h) return undefined;
  if (/^https?:\/\//i.test(h)) return h;
  if (h.startsWith("/")) return `${base}${h}`;
  const bare = h.replace(/^@/, "");
  // A path like `channel/UC…` (YouTube) goes in as-is, without the @.
  if (bare.includes("/")) return `${base}/${bare}`;
  return `${base}/${prefix}${encodeURIComponent(bare)}`;
}

function websiteUrl(value: unknown): string | undefined {
  const v = str(value);
  if (!v) return undefined;
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    return new URL(withScheme).toString();
  } catch {
    return undefined;
  }
}

/** A trimmed non-empty string, or null. Luma uses both `null` and `""` for "unset". */
function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
