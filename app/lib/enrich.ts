import "server-only";

import { search, resultText } from "./you";
import { cached, cacheKey } from "./cache";
import type { EnrichedParticipant, Participant, Profile } from "./types";

/**
 * Turn a bare participant (a name, maybe a one-line bio) into someone you can
 * decide whether to meet, using you.com Search over LinkedIn.
 *
 * This is the half of layer 2 that doesn't care where the names came from —
 * Luma's public page, an authenticated guest list, or a CSV. It takes
 * `Participant[]` and returns the same people with a `profile` attached.
 *
 * Two rules shape everything here:
 *
 *   1. A wrong profile is worse than no profile. Attaching the wrong Jane Doe
 *      makes the whole feature untrustworthy, so a match must be *verifiable*
 *      from the result title, and anything short of that resolves to `null`.
 *   2. Searches are metered. Every lookup is cached on the person, people
 *      already carrying a LinkedIn handle are never searched for at all, and
 *      concurrency is bounded so one event can't fan out into 50 parallel calls.
 */

/** Simultaneous you.com searches. Enough to stay fast, low enough to be polite. */
const CONCURRENCY = 4;

/** A name this short can't be matched safely — "Al" matches half of LinkedIn. */
const MIN_NAME_LENGTH = 3;

export async function enrichParticipants(
  participants: Participant[],
): Promise<EnrichedParticipant[]> {
  return mapPool(participants, CONCURRENCY, async (participant) => ({
    ...participant,
    profile: await enrichOne(participant),
  }));
}

/**
 * Resolve one participant's profile.
 *
 * Cached on the identity we searched for, not on the participant's Luma id: the
 * same person showing up at two events is one lookup, and the key stays stable
 * when Luma reissues ids.
 */
function enrichOne(participant: Participant): Promise<Profile | null> {
  // Luma already knows: trust it and spend nothing.
  if (participant.socials.linkedin) {
    return Promise.resolve({
      linkedin: participant.socials.linkedin,
      headline: null,
      summary: participant.bio,
      confidence: "high",
    });
  }

  const name = participant.name.trim();
  if (name.length < MIN_NAME_LENGTH || name.toLowerCase() === "unknown") {
    return Promise.resolve(null);
  }

  const query = buildQuery(name, participant.bio);
  return cached(cacheKey("enrich:linkedin", query), () => lookup(name, query));
}

async function lookup(name: string, query: string): Promise<Profile | null> {
  const results = await search(query, {
    count: 5,
    includeDomains: ["linkedin.com"],
    highlights: true,
  });

  for (const result of results) {
    if (!isPersonProfile(result.url)) continue;
    if (!titleNamesPerson(result.title, name)) continue;
    return {
      linkedin: canonicalProfileUrl(result.url),
      headline: headlineFrom(result.title),
      summary: truncate(resultText(result), 400),
      confidence: "medium",
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

function truncate(value: string, max: number): string | null {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
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
