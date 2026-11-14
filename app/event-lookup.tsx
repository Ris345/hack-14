"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import {
  fetchEnrichment,
  fetchEventParticipants,
  type EventParticipants,
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
import { PersonCard, type EnrichState } from "./person-card";
import styles from "./page.module.css";

/** How many participants to enrich at once. Each is up to 1 search + 3 page fetches. */
const ENRICH_CONCURRENCY = 4;

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

/** Paste a Luma event link, see its public participants, then narrow them down. */
export function EventLookup() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EventParticipants | null>(null);
  const [enrichment, setEnrichment] = useState<Record<string, EnrichState>>({});
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [starred, setStarred] = useState<string[]>([]);
  /** Bumped per lookup, so a slow enrichment from the last event can't land on this one. */
  const generation = useRef(0);

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
      void enrichAll(found, gen);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "Lookup failed.");
    } finally {
      setLoading(false);
    }
  }

  /** Enrich every participant, a few at a time. */
  async function enrichAll(found: EventParticipants, gen: number) {
    // Everyone: people with no links may still have a LinkedIn we can find.
    const queue = found.participants.filter((p) => p.id);
    const update = (id: string, state: EnrichState) => {
      if (gen !== generation.current) return;
      setEnrichment((prev) => ({ ...prev, [id]: state }));
    };

    setEnrichment(
      Object.fromEntries(queue.map((p) => [p.id, { status: "loading" } as const])),
    );

    let next = 0;
    async function worker() {
      while (next < queue.length && gen === generation.current) {
        const person = queue[next++];
        try {
          const data = await fetchEnrichment(found.event.url, person.id);
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

  // Re-tag as enrichment arrives; cheap, it's a few dozen people.
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

  return (
    <section className={styles.lookup}>
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
          Fetching the event page through you.com — this can take up to 30
          seconds.
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
            {hostCount} host{hostCount === 1 ? "" : "s"} · {guestCount} featured
            guest{guestCount === 1 ? "" : "s"}
            {result.guestCount !== null
              ? ` of ${result.guestCount} registered. Luma only shows the full guest list to signed-in guests.`
              : ""}
          </p>

          <FilterBar
            rows={rows}
            filters={filters}
            onChange={setFilters}
            enriching={enriching}
          />

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
