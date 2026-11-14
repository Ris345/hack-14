"use client";

import { ROLE_TAGS, TOPIC_TAGS, type Classified, type Tag } from "./lib/classify";
import type { Participant } from "./lib/api";
import styles from "./page.module.css";

export type Tab = "all" | "hosts" | "guests" | "starred";
export type SortKey = "default" | "seniority" | "followers" | "name";

export type FilterState = {
  tab: Tab;
  query: string;
  /** Tag ids. Within a group a person needs any one; across groups, all. */
  roles: string[];
  topics: string[];
  sort: SortKey;
};

export const DEFAULT_FILTERS: FilterState = {
  tab: "all",
  query: "",
  roles: [],
  topics: [],
  sort: "default",
};

const SORTS: { id: SortKey; label: string }[] = [
  { id: "default", label: "Hosts first" },
  { id: "seniority", label: "Most senior" },
  { id: "followers", label: "Most X followers" },
  { id: "name", label: "Name A–Z" },
];

/** One person as the filters see them. */
export type Row = {
  person: Participant;
  info: Classified;
  followers: number | null;
  starred: boolean;
};

/** Everything except the tab, so tab counts reflect the other filters. */
function matchesFilters(row: Row, f: FilterState): boolean {
  const terms = f.query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.every((t) => row.info.searchText.includes(t))) return false;
  if (f.roles.length && !f.roles.some((r) => row.info.roles.includes(r))) return false;
  if (f.topics.length && !f.topics.some((t) => row.info.topics.includes(t))) return false;
  return true;
}

function matchesTab(row: Row, tab: Tab): boolean {
  if (tab === "hosts") return row.person.role === "host";
  if (tab === "guests") return row.person.role === "guest";
  if (tab === "starred") return row.starred;
  return true;
}

export function applyFilters(rows: Row[], f: FilterState): Row[] {
  const out = rows.filter((r) => matchesTab(r, f.tab) && matchesFilters(r, f));
  const byName = (a: Row, b: Row) => a.person.name.localeCompare(b.person.name);
  switch (f.sort) {
    case "seniority":
      return out.sort((a, b) => b.info.seniority - a.info.seniority || byName(a, b));
    case "followers":
      return out.sort((a, b) => (b.followers ?? -1) - (a.followers ?? -1) || byName(a, b));
    case "name":
      return out.sort(byName);
    default:
      // Stable sort keeps Luma's order within hosts and within guests.
      return out.sort(
        (a, b) => Number(b.person.role === "host") - Number(a.person.role === "host"),
      );
  }
}

export function isFiltered(f: FilterState): boolean {
  return Boolean(f.query.trim() || f.roles.length || f.topics.length);
}

export function FilterBar({
  rows,
  filters,
  onChange,
  enriching,
}: {
  rows: Row[];
  filters: FilterState;
  onChange: (next: FilterState) => void;
  /** Profiles still loading: tags and counts will keep growing. */
  enriching: boolean;
}) {
  const set = (patch: Partial<FilterState>) => onChange({ ...filters, ...patch });
  const toggle = (key: "roles" | "topics", id: string) => {
    const list = filters[key];
    set({ [key]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id] });
  };

  // Counts for each tab honour the other filters, so you can see where matches are.
  const filtered = rows.filter((r) => matchesFilters(r, filters));
  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "all", label: "All", count: filtered.length },
    { id: "hosts", label: "Hosts", count: filtered.filter((r) => r.person.role === "host").length },
    { id: "guests", label: "Guests", count: filtered.filter((r) => r.person.role === "guest").length },
    { id: "starred", label: "★ Want to meet", count: filtered.filter((r) => r.starred).length },
  ];

  // Chip counts are over the current tab, ignoring that chip's own group, so
  // picking "AI" doesn't zero out every other topic.
  const inTab = rows.filter((r) => matchesTab(r, filters.tab));
  const countFor = (group: "roles" | "topics", id: string) =>
    inTab.filter(
      (r) => matchesFilters(r, { ...filters, [group]: [] }) && r.info[group].includes(id),
    ).length;

  return (
    <div className={styles.filters}>
      <div className={styles.tabs} role="tablist" aria-label="Who to show">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={filters.tab === t.id}
            className={styles.tab}
            onClick={() => set({ tab: t.id })}
          >
            {t.label} <span className={styles.tabCount}>{t.count}</span>
          </button>
        ))}
      </div>

      <div className={styles.toolbar}>
        <input
          className={styles.input}
          type="search"
          placeholder="Search names, titles, companies, interests…"
          aria-label="Search participants"
          value={filters.query}
          onChange={(e) => set({ query: e.target.value })}
        />
        <label className={styles.sortLabel}>
          <span className={styles.muted}>Sort</span>
          <select
            className={styles.select}
            value={filters.sort}
            onChange={(e) => set({ sort: e.target.value as SortKey })}
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ChipGroup
        title="Role"
        tags={ROLE_TAGS}
        selected={filters.roles}
        count={(id) => countFor("roles", id)}
        onToggle={(id) => toggle("roles", id)}
      />
      <ChipGroup
        title="Industry & interests"
        tags={TOPIC_TAGS}
        selected={filters.topics}
        count={(id) => countFor("topics", id)}
        onToggle={(id) => toggle("topics", id)}
      />

      <div className={styles.filterStatus}>
        {enriching ? (
          <span className={styles.muted}>
            Reading profiles — tags and counts fill in as they load.
          </span>
        ) : null}
        {isFiltered(filters) ? (
          <button
            type="button"
            className={styles.linkButton}
            onClick={() => onChange({ ...DEFAULT_FILTERS, tab: filters.tab, sort: filters.sort })}
          >
            Clear filters
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ChipGroup({
  title,
  tags,
  selected,
  count,
  onToggle,
}: {
  title: string;
  tags: Pick<Tag, "id" | "label">[];
  selected: string[];
  count: (id: string) => number;
  onToggle: (id: string) => void;
}) {
  // Hide chips nobody matches, unless selected (so it can be turned off).
  const visible = tags
    .map((t) => ({ ...t, n: count(t.id) }))
    .filter((t) => t.n > 0 || selected.includes(t.id));
  if (!visible.length) return null;

  return (
    <div className={styles.chipGroup}>
      <span className={styles.chipGroupTitle}>{title}</span>
      <div className={styles.chips}>
        {visible.map((t) => (
          <button
            key={t.id}
            type="button"
            className={styles.chip}
            aria-pressed={selected.includes(t.id)}
            onClick={() => onToggle(t.id)}
          >
            {t.label} <span className={styles.chipCount}>{t.n}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
