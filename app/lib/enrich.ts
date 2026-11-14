import "server-only";

import { contents } from "./you";
import type { Enrichment, Participant } from "./types";

/**
 * Enrich a participant by reading the pages behind their social links with
 * the you.com Contents API: LinkedIn (headline, location, about), X (bio,
 * followers) and their website (title, summary).
 *
 * Each page is its own cached `contents()` call, so a person who shows up at
 * several events is fetched once. Pages are fetched in parallel, and one that
 * fails (login wall, timeout) just leaves its section out.
 *
 * The parsers below match the markdown you.com returns for each site. They're
 * deliberately forgiving: a format change yields `null` fields, not an error.
 */

/** you.com's default is 10 s; LinkedIn and X are slow to render. */
const CRAWL_TIMEOUT_S = 20;

/** Trim long text so the UI stays a list, not a wall. */
const MAX_TEXT = 280;

export async function enrichParticipant(
  person: Participant,
): Promise<Enrichment> {
  const { linkedin, twitter, website } = person.socials;

  const [li, tw, web] = await Promise.all([
    linkedin ? fetchMarkdown(linkedin) : null,
    twitter ? fetchMarkdown(twitter) : null,
    website ? fetchMarkdown(website) : null,
  ]);

  const result: Enrichment = {};
  if (li) result.linkedin = parseLinkedIn(li);
  if (tw) result.twitter = parseTwitter(tw);
  if (web) result.website = parseWebsite(web.markdown, web.title);
  return result;
}

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
export function parseLinkedIn({ markdown }: Page): NonNullable<Enrichment["linkedin"]> {
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

  // Prefer the first heading's tagline-ish paragraph; skip nav, images, links.
  const summary =
    lines.find(
      (l) =>
        !/^[#!\-*>|\[]/.test(l) &&
        !/^\d+\.\s/.test(l) &&
        l.length > 40,
    ) ?? null;

  return { title: clip(title), summary: clip(stripMarkdown(summary)) };
}

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
