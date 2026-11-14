import "server-only";
import { ydcApiKey } from "./env";
import { cached, cacheKey } from "./cache";

/**
 * Thin typed client for the you.com Web Search and Contents APIs.
 *
 * Transport only — no domain knowledge of Luma or LinkedIn lives here. Every
 * call goes through the query-keyed cache, because results are metered and
 * identical for every user.
 *
 * POST https://ydc-index.io/v1/{search,contents}, auth via the `X-API-Key` header.
 */

const SEARCH_URL = "https://ydc-index.io/v1/search";

/** you.com crawls pages for highlights; 10s is not generous enough. */
const REQUEST_TIMEOUT_MS = 30_000;

export type SearchOptions = {
  /** Max results. 1–100, or 1–50 when highlights are requested. Default 10. */
  count?: number;
  /** Restrict to these domains, e.g. `["linkedin.com"]`. Up to 500. */
  includeDomains?: string[];
  /** `day` | `week` | `month` | `year` | `YYYY-MM-DDtoYYYY-MM-DD`. */
  freshness?: string;
  /**
   * Ask you.com to extract the passages of each page that match the query.
   * Costs latency, but it's what turns a result list into usable text.
   */
  highlights?: boolean;
};

export type WebResult = {
  url: string;
  title: string;
  description: string;
  snippets: string[];
  thumbnail_url?: string;
  page_age?: string;
  favicon_url?: string;
  contents?: {
    html?: string;
    markdown?: string;
    highlights?: string[];
  };
};

type SearchResponse = {
  results?: {
    web?: WebResult[];
    knowledge?: unknown[];
  };
  metadata?: {
    search_uuid?: string;
    query?: string;
    latency?: number;
  };
};

/** Non-2xx from you.com, surfaced with the status so callers can tell 429 apart. */
export class YouApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`you.com search failed: ${status} ${body.slice(0, 200)}`);
    this.name = "YouApiError";
  }
}

/**
 * Run a web search. Cached on the query plus the options that change the
 * result set — two callers asking the same thing share one upstream request.
 */
export function search(
  query: string,
  options: SearchOptions = {},
): Promise<WebResult[]> {
  const key = cacheKey(
    "you:search",
    query,
    String(options.count ?? 10),
    (options.includeDomains ?? []).join(","),
    options.freshness ?? "",
    options.highlights ? "hl" : "",
  );
  return cached(key, () => searchUncached(query, options));
}

async function searchUncached(
  query: string,
  options: SearchOptions,
): Promise<WebResult[]> {
  const body: Record<string, unknown> = {
    query,
    count: options.count ?? 10,
  };
  if (options.includeDomains?.length) {
    body.include_domains = options.includeDomains;
  }
  if (options.freshness) body.freshness = options.freshness;
  if (options.highlights) {
    body.extraction = { extraction_mode: "highlights" };
  }

  const res = await fetch(SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": ydcApiKey(),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    // This is an outbound metered API; our own cache owns the freshness policy.
    cache: "no-store",
  });

  if (!res.ok) {
    throw new YouApiError(res.status, await res.text().catch(() => ""));
  }

  const json = (await res.json()) as SearchResponse;
  return json.results?.web ?? [];
}

const CONTENTS_URL = "https://ydc-index.io/v1/contents";

export type ContentsFormat = "markdown" | "html" | "metadata";

export type ContentsOptions = {
  /** Default `["markdown"]`. Each extra format adds processing time. */
  formats?: ContentsFormat[];
  /** Per-URL crawl timeout in seconds, 1–60. you.com's default is 10; JS-heavy pages want 20–30. */
  crawlTimeout?: number;
  /** Max age of you.com's own cached copy, in seconds. `0` forces a re-fetch. */
  maxAge?: number;
};

export type PageContents = {
  url: string;
  title?: string | null;
  /** `null` when the page couldn't be fetched (login wall, 404). */
  markdown?: string | null;
  html?: string | null;
  metadata?: { site_name?: string | null; favicon_url?: string | null } | null;
};

/**
 * Fetch the contents of one page via the you.com Contents API
 * (`POST /v1/contents`, $1 per 1,000 pages). Cached on the URL and options.
 *
 * Returns `null` when you.com answered but couldn't fetch the page.
 */
export function contents(
  url: string,
  options: ContentsOptions = {},
): Promise<PageContents | null> {
  const formats = options.formats ?? ["markdown"];
  const key = cacheKey(
    "you:contents",
    url,
    [...formats].sort().join(","),
    String(options.crawlTimeout ?? ""),
    String(options.maxAge ?? ""),
  );
  return cached(key, () => contentsUncached(url, formats, options));
}

async function contentsUncached(
  url: string,
  formats: ContentsFormat[],
  options: ContentsOptions,
): Promise<PageContents | null> {
  const body: Record<string, unknown> = { urls: [url], formats };
  if (options.crawlTimeout !== undefined) body.crawl_timeout = options.crawlTimeout;
  if (options.maxAge !== undefined) body.max_age = options.maxAge;

  const res = await fetch(CONTENTS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": ydcApiKey(),
    },
    body: JSON.stringify(body),
    // Crawl timeout plus headroom for you.com's own processing.
    signal: AbortSignal.timeout(((options.crawlTimeout ?? 10) + 20) * 1000),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new YouApiError(res.status, await res.text().catch(() => ""));
  }

  const json = (await res.json()) as PageContents[];
  const page = Array.isArray(json) ? json[0] : undefined;
  if (!page || (page.html == null && page.markdown == null)) return null;
  return page;
}

/** The text of a result worth reading: highlights if we asked for them, else the snippets. */
export function resultText(result: WebResult): string {
  const highlights = result.contents?.highlights;
  if (highlights?.length) return highlights.join(" ");
  if (result.snippets?.length) return result.snippets.join(" ");
  return result.description ?? "";
}
