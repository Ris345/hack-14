import "server-only";

import { contents, resultText, search } from "./you";
import { cached, cacheKey } from "./cache";
import type { EnrichedParticipant, Enrichment, Participant } from "./types";

/**
 * Turn a bare participant (a name, maybe a one-line bio, maybe some social
 * links) into someone you can decide whether to meet, using you.com.
 *
 * This doesn't care where the names came from — Luma's public page, an
 * authenticated guest list, or a CSV. It takes a `Participant` and returns
 * what their public profiles say, in two steps:
 *
 *   1. **Find their LinkedIn.** If Luma lists it, use it (`high` confidence).
 *      Otherwise search linkedin.com for them (`medium`).
 *   2. **Read their pages.** Fetch the LinkedIn profile, X profile and website
 *      in parallel with the Contents API and parse headline, location, about,
 *      bio, followers and a site summary.
 *
 * Three rules shape everything here:
 *
 *   - A wrong profile is worse than no profile. Attaching the wrong Jane Doe
 *     makes the whole feature untrustworthy, so a searched match must be
 *     *verifiable* from the result title, and anything short of that resolves
 *     to no LinkedIn section at all.
 *   - Calls are metered. Every search and every page is cached (a person who
 *     shows up at two events costs one lookup), people Luma already knows the
 *     LinkedIn of are never searched for, and batch concurrency is bounded.
 *   - It's best-effort. A page that fails (login wall, timeout) leaves its
 *     section out, and a site format change yields `null` fields, not an error.
 */

/** Simultaneous participants in `enrichParticipants`. Each is up to 1 search + 3 pages. */
const CONCURRENCY = 4;

/** A name this short can't be matched safely — "Al" matches half of LinkedIn. */
const MIN_NAME_LENGTH = 3;

/** you.com's default is 10 s; LinkedIn and X are slow to render. */
const CRAWL_TIMEOUT_S = 20;

/** Trim long text so the UI stays a list, not a wall. */
const MAX_TEXT = 280;

/** Enrich one participant. The UI calls this per person so cards fill in as they're ready. */
export async function enrichParticipant(
  person: Participant,
): Promise<Enrichment> {
  const { twitter, website } = person.socials;

  const [li, tw, web] = await Promise.all([
    enrichLinkedIn(person),
    twitter ? fetchMarkdown(twitter) : null,
    website ? fetchMarkdown(website) : null,
  ]);

  const result: Enrichment = {};
  if (li) result.linkedin = li;
  if (tw) result.twitter = parseTwitter(tw);
  if (web) result.website = parseWebsite(web.markdown, web.title);
  return result;
}

/** Enrich a whole list, at most `CONCURRENCY` people at a time, in input order. */
export async function enrichParticipants(
  participants: Participant[],
): Promise<EnrichedParticipant[]> {
  return mapPool(participants, CONCURRENCY, async (participant) => ({
    ...participant,
    enrichment: await enrichParticipant(participant),
  }));
}

// ---------------------------------------------------------------------------
// LinkedIn: find the profile, then read it
// ---------------------------------------------------------------------------

async function enrichLinkedIn(
  person: Participant,
): Promise<Enrichment["linkedin"] | null> {
  // Luma already knows: trust it and spend no search.
  const known = person.socials.linkedin;
  const found = known ? null : await findLinkedIn(person);
  const url = known ?? found?.url;
  if (!url) return null;

  const page = await fetchMarkdown(url);
  const parsed = page ? parseLinkedIn(page) : null;

  return {
    url,
    confidence: known ? "high" : "medium",
    // Prefer the profile page; fall back to what the search result said.
    headline: parsed?.headline ?? found?.headline ?? null,
    location: parsed?.location ?? null,
    about: parsed?.about ?? found?.summary ?? null,
  };
}

type SearchHit = { url: string; headline: string | null; summary: string | null };

/**
 * Search linkedin.com for a participant Luma has no LinkedIn link for.
 *
 * Cached on the query, not the participant's Luma id: the same person showing
 * up at two events is one lookup, and the key stays stable when Luma reissues
 * ids. Failures resolve to null — enrichment is best-effort.
 */
async function findLinkedIn(person: Participant): Promise<SearchHit | null> {
  const name = person.name.trim();
  if (name.length < MIN_NAME_LENGTH || name.toLowerCase() === "unknown") {
    return null;
  }

  const query = buildQuery(name, person.bio);
  try {
    return await cached(cacheKey("enrich:linkedin", query), () =>
      searchLinkedIn(name, query),
    );
  } catch (err) {
    console.error(`LinkedIn search failed for "${query}":`, err);
    return null;
  }
}

async function searchLinkedIn(
  name: string,
  query: string,
): Promise<SearchHit | null> {
  // No highlights: we read the matched profile with the Contents API anyway,
  // so extracting passages here would pay twice for the same page.
  const results = await search(query, {
    count: 5,
    includeDomains: ["linkedin.com"],
  });

  for (const result of results) {
    if (!isPersonProfile(result.url)) continue;
    if (!titleNamesPerson(result.title, name)) continue;
    return {
      url: canonicalProfileUrl(result.url),
      headline: headlineFrom(result.title),
      summary: clip(resultText(result)),
    };
  }
  return null;
}

/**
 * The search query for a person. The bio is included because a name alone is
 * frequently ambiguous, and Luma's `bio_short` usually names the company or
 * role — exactly the disambiguating terms we need.
 */
function buildQuery(name: string, bio: string | null): string {
  const context = (bio ?? "")
    .replace(/\s+/g, " ")
    .trim()
    // Keep it to the first clause; long bios dilute the query.
    .split(/[.!?|•]/)[0]
    .slice(0, 120)
    .trim();
  return context ? `${name} ${context} LinkedIn` : `${name} LinkedIn`;
}

/**
 * Only personal profiles (`/in/<slug>`) count. Search over `linkedin.com` also
 * returns company pages, job posts and articles, and none of those are a person.
 */
function isPersonProfile(url: string): boolean {
  try {
    const { hostname, pathname } = new URL(url);
    if (!/(^|\.)linkedin\.com$/i.test(hostname)) return false;
    const segments = pathname.split("/").filter(Boolean);
    return segments[0]?.toLowerCase() === "in" && Boolean(segments[1]);
  } catch {
    return false;
  }
}

/** Drop tracking params and locale subdomains so the same profile caches once. */
function canonicalProfileUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const slug = parsed.pathname.split("/").filter(Boolean)[1];
    return `https://www.linkedin.com/in/${slug}`;
  } catch {
    return url;
  }
}

/**
 * Does this result title actually name the person we searched for?
 *
 * LinkedIn titles read "Jane Doe - Founder at Acme | LinkedIn". Requiring every
 * part of the participant's name to appear is what keeps us from attaching a
 * stranger who merely ranked well for the query.
 */
function titleNamesPerson(title: string, name: string): boolean {
  const haystack = normalize(title);
  const parts = normalize(name)
    .split(" ")
    // Initials and honorifics carry no matching signal.
    .filter((part) => part.length > 1);
  if (!parts.length) return false;
  return parts.every((part) => haystack.includes(part));
}

/** The role/company half of a LinkedIn title, or null if it carries none. */
function headlineFrom(title: string): string | null {
  const withoutSuffix = title.replace(/\s*[|–-]\s*LinkedIn\s*$/i, "").trim();
  // "Jane Doe - Founder at Acme" → "Founder at Acme"
  const separator = withoutSuffix.search(/\s+[–—-]\s+/);
  if (separator === -1) return null;
  const headline = withoutSuffix
    .slice(separator)
    .replace(/^\s+[–—-]\s+/, "")
    .trim();
  return headline || null;
}

/** Strip accents and punctuation so "José" matches "Jose". */
function normalize(value: string): string {
  return value
    // NFD splits "é" into "e" + a combining mark, which the next line drops.
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Reading pages
// ---------------------------------------------------------------------------

type Page = { markdown: string; title: string | null };

/** The page's markdown, or null on any failure — enrichment is best-effort. */
async function fetchMarkdown(url: string): Promise<Page | null> {
  try {
    const page = await contents(url, {
      formats: ["markdown"],
      crawlTimeout: CRAWL_TIMEOUT_S,
    });
    if (!page?.markdown) return null;
    return { markdown: page.markdown, title: page.title ?? null };
  } catch (err) {
    console.error(`Enrichment fetch failed for ${url}:`, err);
    return null;
  }
}

/**
 * LinkedIn profiles come back as:
 *
 *     # Name
 *     ![Name](avatar)
 *     **Headline | with | segments |**
 *     - **Location**: New York, New York, United States
 *     About paragraph…
 */
export function parseLinkedIn({ markdown }: Page) {
  const lines = markdown.split("\n").map((l) => l.trim()).filter(Boolean);

  const boldLine = lines.find((l) => /^\*\*[^*].*\*\*$/.test(l));
  const headline = boldLine
    ? boldLine
        .replace(/^\*\*|\*\*$/g, "")
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean)
        .join(" · ")
    : null;

  const location =
    lines
      .map((l) => l.match(/^-\s*\*\*Location\*\*:\s*(.+)$/i)?.[1])
      .find(Boolean) ?? null;

  const about =
    lines.find(
      (l) =>
        !/^[#!\-*>|]/.test(l) && // not a heading, image, list item, bold line or table
        l.length > 40,
    ) ?? null;

  return {
    headline: clip(headline),
    location: clip(location),
    about: clip(about),
  };
}

/**
 * X profiles come back as a list of fields:
 *
 *     - **description**: 60,000+ member community…
 *     - **followers_count**: 27
 */
export function parseTwitter({ markdown }: Page): NonNullable<Enrichment["twitter"]> {
  const field = (name: string) =>
    markdown.match(new RegExp(`^\\s*-\\s*\\*\\*${name}\\*\\*:\\s*(.+)$`, "m"))?.[1]?.trim() ??
    null;

  const followersRaw = field("followers_count");
  const followers = followersRaw ? Number(followersRaw.replace(/,/g, "")) : NaN;

  return {
    bio: clip(field("description")),
    followers: Number.isFinite(followers) ? followers : null,
  };
}

/** A personal or company site: its title and the first real paragraph. */
export function parseWebsite(
  markdown: string,
  title: string | null,
): NonNullable<Enrichment["website"]> {
  const lines = markdown.split("\n").map((l) => l.trim()).filter(Boolean);

  // The first substantial paragraph; skip headings, nav, images, links, lists.
  const summary =
    lines.find(
      (l) =>
        !/^[#!\-*>|\[]/.test(l) &&
        !/^\d+\.\s/.test(l) &&
        l.length > 40,
    ) ?? null;

  return { title: clip(title), summary: clip(stripMarkdown(summary)) };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripMarkdown(text: string | null): string | null {
  if (!text) return null;
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links → their text
    .replace(/[*_`]+/g, "")
    .trim();
}

function clip(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT - 1).trimEnd()}…` : t;
}

/**
 * `Promise.all` over `items` with at most `limit` running at once, preserving
 * input order. Workers pull from a shared cursor rather than running fixed
 * slices, so one slow lookup doesn't stall the others.
 */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}
