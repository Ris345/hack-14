"use client";

import { useRef, useState, type FormEvent } from "react";
import {
  fetchEnrichment,
  fetchEventParticipants,
  type Enrichment,
  type EventParticipants,
  type Participant,
  type Socials,
} from "./lib/api";
import styles from "./page.module.css";

/** How many participants to enrich at once. Each is up to 1 search + 3 page fetches. */
const ENRICH_CONCURRENCY = 4;

type EnrichState =
  | { status: "loading" }
  | { status: "done"; data: Enrichment }
  | { status: "error" };

const SOCIAL_LABELS: Record<keyof Socials, string> = {
  linkedin: "LinkedIn",
  twitter: "X",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  website: "Website",
  luma: "Luma",
};

/** Paste a Luma event link, see its public participants and their socials. */
export function EventLookup() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EventParticipants | null>(null);
  const [enrichment, setEnrichment] = useState<Record<string, EnrichState>>({});
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
      void enrichAll(found, gen);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "Lookup failed.");
    } finally {
      setLoading(false);
    }
  }

  /** Enrich every participant with linkable profiles, a few at a time. */
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

  const hosts = result?.participants.filter((p) => p.role === "host") ?? [];
  const guests = result?.participants.filter((p) => p.role === "guest") ?? [];

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
            {hosts.length} host{hosts.length === 1 ? "" : "s"} · {guests.length}{" "}
            featured guest{guests.length === 1 ? "" : "s"}
            {result.guestCount !== null
              ? ` of ${result.guestCount} registered. Luma only shows the full guest list to signed-in guests.`
              : ""}
          </p>
          <PeopleList title="Hosts" people={hosts} enrichment={enrichment} />
          <PeopleList
            title="Featured guests"
            people={guests}
            enrichment={enrichment}
          />
        </div>
      ) : null}
    </section>
  );
}

function PeopleList({
  title,
  people,
  enrichment,
}: {
  title: string;
  people: Participant[];
  enrichment: Record<string, EnrichState>;
}) {
  if (!people.length) return null;
  return (
    <>
      <h3 className={styles.listTitle}>{title}</h3>
      <ul className={styles.people}>
        {people.map((p) => (
          <li key={p.id || p.name} className={styles.person}>
            {p.avatarUrl ? (
              // Arbitrary CDN host; next/image would need it allow-listed.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className={styles.personAvatar}
                src={p.avatarUrl}
                alt=""
                width={40}
                height={40}
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className={styles.personAvatar} aria-hidden />
            )}
            <div className={styles.personBody}>
              <div className={styles.name}>{p.name}</div>
              {p.bio ? <div className={styles.bio}>{p.bio}</div> : null}
              <EnrichmentDetails state={enrichment[p.id]} />
              <div className={styles.socials}>
                {(Object.keys(SOCIAL_LABELS) as (keyof Socials)[])
                  .filter((k) => p.socials[k])
                  .map((k) => (
                    <a
                      key={k}
                      href={p.socials[k]}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {SOCIAL_LABELS[k]}
                    </a>
                  ))}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

/** What the person's LinkedIn, X and website say, as it arrives. */
function EnrichmentDetails({ state }: { state: EnrichState | undefined }) {
  if (!state) return null;
  if (state.status === "loading") {
    return <div className={styles.enrichPending}>Reading their profiles…</div>;
  }
  if (state.status === "error") {
    return <div className={styles.enrichPending}>Couldn’t read their profiles.</div>;
  }

  const { linkedin, twitter, website } = state.data;
  const rows: { label: string; text: string; href?: string; note?: string }[] = [];
  if (linkedin && (linkedin.headline || linkedin.confidence === "medium")) {
    rows.push({
      label: "LinkedIn",
      text: linkedin.headline ?? "Profile",
      // Luma's own link is already in the socials row; a found one isn't.
      href: linkedin.confidence === "medium" ? linkedin.url : undefined,
      note:
        linkedin.confidence === "medium"
          ? "Found by name search — check it's them."
          : undefined,
    });
  }
  if (linkedin?.location) rows.push({ label: "Location", text: linkedin.location });
  if (twitter?.bio) {
    const followers =
      twitter.followers !== null
        ? ` (${twitter.followers.toLocaleString()} followers)`
        : "";
    rows.push({ label: "X", text: `${twitter.bio}${followers}` });
  }
  if (website?.summary || website?.title) {
    rows.push({
      label: "Website",
      text: [website.title, website.summary].filter(Boolean).join(" — "),
    });
  }

  if (!rows.length) {
    return <div className={styles.enrichPending}>Nothing public on their profiles.</div>;
  }
  return (
    <dl className={styles.enrich}>
      {rows.map((r) => (
        <div key={r.label} className={styles.enrichRow}>
          <dt>{r.label}</dt>
          <dd>
            {r.href ? (
              <a href={r.href} target="_blank" rel="noreferrer">
                {r.text}
              </a>
            ) : (
              r.text
            )}
            {r.note ? <span className={styles.enrichNote}> {r.note}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
