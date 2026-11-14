import "server-only";
import { ydcApiKey } from "./env";
import { cached, cacheKey } from "./cache";

/**
 * Thin typed client for the you.com Web Search API.
 *
 * Transport only — no domain knowledge of Luma or LinkedIn lives here. Every
 * call goes through the query-keyed cache, because results are metered and
 * identical for every user.
 *
 * POST https://ydc-index.io/v1/search, auth via the `X-API-Key` header.
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

/** The text of a result worth reading: highlights if we asked for them, else the snippets. */
export function resultText(result: WebResult): string {
  const highlights = result.contents?.highlights;
  if (highlights?.length) return highlights.join(" ");
  if (result.snippets?.length) return result.snippets.join(" ");
  return result.description ?? "";
}
