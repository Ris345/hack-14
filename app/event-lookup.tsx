"use client";

import { useState, type FormEvent } from "react";
import {
  fetchEventParticipants,
  type EventParticipants,
  type Participant,
  type Socials,
} from "./lib/api";
import styles from "./page.module.css";

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

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!url.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      setResult(await fetchEventParticipants(url));
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "Lookup failed.");
    } finally {
      setLoading(false);
    }
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
          <PeopleList title="Hosts" people={hosts} />
          <PeopleList title="Featured guests" people={guests} />
        </div>
      ) : null}
    </section>
  );
}

function PeopleList({ title, people }: { title: string; people: Participant[] }) {
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
