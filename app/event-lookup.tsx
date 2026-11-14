"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ApiError,
  fetchEnrichment,
  fetchEventParticipants,
  fetchLumaConnection,
  type EventParticipants,
  type LumaConnection,
  type Participant,
} from "./lib/api";
import { classify } from "./lib/classify";
import {
  applyFilters,
  DEFAULT_FILTERS,
  FilterBar,
  isFiltered,
  type FilterState,
  type Row,
} from "./people-filters";
import { LumaConnect } from "./luma-connect";
import { PersonCard, type EnrichState } from "./person-card";
import styles from "./page.module.css";

/** How many participants to enrich at once. Each is up to 1 search + 3 page fetches. */
const ENRICH_CONCURRENCY = 4;

/**
 * Enrich automatically only up to this many people. A full guest list can run
 * to hundreds, and reading everyone's profiles costs real money and minutes;
 * above this, the user filters first and enriches the people shown.
 */
const AUTO_ENRICH_LIMIT = 40;

/** Worst case per person: one search ($5/1k) plus three pages ($1/1k each). */
const MAX_COST_PER_PERSON = 0.008;

/**
 * Stars ("want to meet") live in this browser only, per event. There's no
 * database, and they're a personal shortlist, not something to sync.
 */
const starKey = (eventUrl: string) => `hack14:starred:${eventUrl}`;

function loadStars(eventUrl: string): string[] {
  try {
    const raw = window.localStorage.getItem(starKey(eventUrl));
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
  } catch {
    // Private mode, blocked storage, or bad JSON: start empty.
    return [];
  }
}

function saveStars(eventUrl: string, ids: string[]) {
  try {
    window.localStorage.setItem(starKey(eventUrl), JSON.stringify(ids));
  } catch {
    // Storage unavailable: stars still work for this session.
  }
}

/** Paste a Luma event link, see its participants, then narrow them down. */
export function EventLookup({ email }: { email: string }) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EventParticipants | null>(null);
  const [enrichment, setEnrichment] = useState<Record<string, EnrichState>>({});
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [starred, setStarred] = useState<string[]>([]);
  const [luma, setLuma] = useState<LumaConnection | null>(null);
  /** Bumped per lookup, so a slow enrichment from the last event can't land on this one. */
  const generation = useRef(0);

  useEffect(() => {
    let cancelled = false;
    fetchLumaConnection()
      .then((c) => {
        if (!cancelled) setLuma(c);
      })
      .catch(() => {
        // Not fatal: lookups still work, just without the full guest list.
        if (!cancelled) setLuma({ connected: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!url.trim() || loading) return;
    const gen = ++generation.current;
    setLoading(true);
    setError(null);
    setEnrichment({});
    try {
      const found = await fetchEventParticipants(url);
      if (gen !== generation.current) return;
      setResult(found);
      setFilters(DEFAULT_FILTERS);
      setStarred(loadStars(found.event.url));
      if (found.participants.length <= AUTO_ENRICH_LIMIT) {
        void enrichPeople(found.participants, found.event.url, gen);
      }
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "Lookup failed.");
      // The stored Luma login stopped working: show the connect form again.
      if (err instanceof ApiError && err.code === "luma_auth") {
        setLuma({ connected: false });
      }
    } finally {
      setLoading(false);
    }
  }

  /**
   * Enrich these people, a few at a time. Everyone, not just people with
   * links: someone with none may still have a LinkedIn we can find.
   */
  async function enrichPeople(people: Participant[], eventUrl: string, gen: number) {
    const queue = people.filter((p) => p.id);
    const update = (id: string, state: EnrichState) => {
      if (gen !== generation.current) return;
      setEnrichment((prev) => ({ ...prev, [id]: state }));
    };

    setEnrichment((prev) => ({
      ...prev,
      ...Object.fromEntries(queue.map((p) => [p.id, { status: "loading" } as const])),
    }));

    let next = 0;
    async function worker() {
      while (next < queue.length && gen === generation.current) {
        const person = queue[next++];
        try {
          const data = await fetchEnrichment(eventUrl, person.id);
          update(person.id, { status: "done", data });
        } catch {
          update(person.id, { status: "error" });
        }
      }
    }
    await Promise.all(
      Array.from({ length: ENRICH_CONCURRENCY }, () => worker()),
    );
  }

  function toggleStar(id: string) {
    if (!result) return;
    const next = starred.includes(id)
      ? starred.filter((x) => x !== id)
      : [...starred, id];
    setStarred(next);
    saveStars(result.event.url, next);
  }

  function toggleTag(group: "roles" | "topics", id: string) {
    const list = filters[group];
    setFilters({
      ...filters,
      [group]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id],
    });
  }

  // Re-tag as enrichment arrives; keyword matching over a few hundred people is cheap.
  const rows: Row[] = useMemo(() => {
    if (!result) return [];
    return result.participants.map((person) => {
      const state = enrichment[person.id];
      const data = state?.status === "done" ? state.data : undefined;
      return {
        person,
        info: classify(person, data),
        followers: data?.twitter?.followers ?? null,
        starred: starred.includes(person.id),
      };
    });
  }, [result, enrichment, starred]);

  const visible = useMemo(() => applyFilters(rows, filters), [rows, filters]);
  const enriching = Object.values(enrichment).some((s) => s.status === "loading");
  const hostCount = result?.participants.filter((p) => p.role === "host").length ?? 0;
  const guestCount = (result?.participants.length ?? 0) - hostCount;
  // Shown people we haven't read yet (or whose read failed): what the button enriches.
  const unread = visible
    .map((r) => r.person)
    .filter((p) => p.id && (!enrichment[p.id] || enrichment[p.id].status === "error"));

  return (
    <section className={styles.lookup}>
      <LumaConnect connection={luma} onChange={setLuma} defaultEmail={email} />

      <form className={styles.form} onSubmit={onSubmit}>
        <input
          className={styles.input}
          type="url"
          inputMode="url"
          placeholder="https://luma.com/your-event"
          aria-label="Luma event link"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
        />
        <button className={styles.button} type="submit" disabled={loading}>
          {loading ? "Fetching…" : "Find people"}
        </button>
      </form>

      {loading ? (
        <p className={styles.muted}>
          {luma?.connected
            ? "Loading the guest list from Luma…"
            : "Fetching the event page through you.com — this can take up to 30 seconds."}
        </p>
      ) : null}
      {error ? <p className={styles.error}>{error}</p> : null}

      {result ? (
        <div className={styles.results}>
          <h2 className={styles.eventName}>
            <a href={result.event.url} target="_blank" rel="noreferrer">
              {result.event.name}
            </a>
          </h2>
          <p className={styles.muted}>
            {hostCount} host{hostCount === 1 ? "" : "s"} ·{" "}
            {result.source === "guest-list"
              ? `${guestCount} guest${guestCount === 1 ? "" : "s"} — the full guest list`
              : `${guestCount} featured guest${guestCount === 1 ? "" : "s"}${
                  result.guestCount !== null ? ` of ${result.guestCount} registered` : ""
                }`}
          </p>
          {result.notice ? (
            <p className={styles.notice}>{result.notice}</p>
          ) : result.source === "public" && !luma?.connected ? (
            <p className={styles.notice}>
              Only featured guests are public. Connect your Luma login above to
              see everyone, if you’re registered.
            </p>
          ) : null}

          <FilterBar
            rows={rows}
            filters={filters}
            onChange={setFilters}
            enriching={enriching}
          />

          {unread.length && !enriching && result.participants.length > AUTO_ENRICH_LIMIT ? (
            <div className={styles.enrichPrompt}>
              <button
                type="button"
                className={styles.button}
                onClick={() =>
                  void enrichPeople(unread, result.event.url, generation.current)
                }
              >
                Read profiles for {unread.length === visible.length ? "the" : ""}{" "}
                {unread.length} {unread.length === 1 ? "person" : "people"} shown
              </button>
              <span className={styles.muted}>
                LinkedIn, X and websites via you.com · up to ~$
                {Math.max(0.01, unread.length * MAX_COST_PER_PERSON).toFixed(2)}.
                Filter or star first to read fewer.
              </span>
            </div>
          ) : null}

          {visible.length ? (
            <ul className={styles.people}>
              {visible.map(({ person, info, starred: isStarred }) => (
                <PersonCard
                  key={person.id || person.name}
                  person={person}
                  info={info}
                  enrichment={enrichment[person.id]}
                  starred={isStarred}
                  onToggleStar={() => toggleStar(person.id)}
                  activeTags={[...filters.roles, ...filters.topics]}
                  onTagClick={toggleTag}
                />
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>
              {filters.tab === "starred" && !isFiltered(filters)
                ? "No one starred yet. Tap ☆ on anyone you want to meet."
                : "No one matches these filters."}
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
