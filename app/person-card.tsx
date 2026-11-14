"use client";

import { ROLE_TAGS, TOPIC_TAGS, type Classified } from "./lib/classify";
import type { Enrichment, Participant, Socials } from "./lib/api";
import styles from "./page.module.css";

export type EnrichState =
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

const TAG_LABELS = new Map(
  [...ROLE_TAGS, ...TOPIC_TAGS].map((t) => [t.id, t.label] as const),
);

export function PersonCard({
  person: p,
  info,
  enrichment,
  starred,
  onToggleStar,
  activeTags,
  onTagClick,
}: {
  person: Participant;
  info: Classified;
  enrichment: EnrichState | undefined;
  starred: boolean;
  onToggleStar: () => void;
  /** Tag ids currently used as filters, highlighted on the card. */
  activeTags: string[];
  onTagClick: (group: "roles" | "topics", id: string) => void;
}) {
  const tags = [
    ...info.roles.map((id) => ({ group: "roles" as const, id })),
    ...info.topics.map((id) => ({ group: "topics" as const, id })),
  ];

  return (
    <li className={styles.person}>
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
        <div className={styles.personHeader}>
          <span className={styles.name}>{p.name}</span>
          {p.role === "host" ? <span className={styles.badge}>Host</span> : null}
        </div>
        {p.bio ? <div className={styles.bio}>{p.bio}</div> : null}
        <EnrichmentDetails state={enrichment} />
        {tags.length ? (
          <div className={styles.tags}>
            {tags.map((t) => (
              <button
                key={`${t.group}:${t.id}`}
                type="button"
                className={styles.tag}
                aria-pressed={activeTags.includes(t.id)}
                title="Filter by this"
                onClick={() => onTagClick(t.group, t.id)}
              >
                {TAG_LABELS.get(t.id) ?? t.id}
              </button>
            ))}
          </div>
        ) : null}
        <div className={styles.socials}>
          {(Object.keys(SOCIAL_LABELS) as (keyof Socials)[])
            .filter((k) => p.socials[k])
            .map((k) => (
              <a key={k} href={p.socials[k]} target="_blank" rel="noreferrer">
                {SOCIAL_LABELS[k]}
              </a>
            ))}
        </div>
      </div>
      <button
        type="button"
        className={styles.star}
        aria-pressed={starred}
        aria-label={starred ? `Unstar ${p.name}` : `Star ${p.name} — want to meet`}
        title={starred ? "Remove from Want to meet" : "Add to Want to meet"}
        onClick={onToggleStar}
      >
        {starred ? "★" : "☆"}
      </button>
    </li>
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
