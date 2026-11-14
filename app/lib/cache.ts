import "server-only";

/**
 * A process-local cache for outbound lookups, keyed on the *query* (an event, a
 * person) rather than on the user — one lookup serves everyone. you.com calls
 * are slow and metered, so this is a requirement, not an optimization.
 *
 * Deliberately in-memory: there is no database yet. It dies with the process
 * and is per-instance, which is fine for a single dev server and for one
 * container in production. Swapping in Redis later means reimplementing
 * `cached()` alone — callers don't change.
 */

type Entry<T> = {
  /** Resolved value, or the in-flight promise. Both are awaited the same way. */
  value: Promise<T>;
  /** Epoch ms after which the entry is stale. */
  expires: number;
};

/**
 * Survive Turbopack hot reloads. Module state is discarded on every edit in
 * dev, which would silently re-spend credits on queries we already paid for.
 */
const store: Map<string, Entry<unknown>> = ((
  globalThis as { __hack14Cache?: Map<string, Entry<unknown>> }
).__hack14Cache ??= new Map());

/** 6 hours. Luma events and LinkedIn headlines move on the order of days. */
export const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

/** Bound the map so a long-lived process can't grow without limit. */
const MAX_ENTRIES = 1000;

function evictIfFull() {
  if (store.size < MAX_ENTRIES) return;
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expires <= now) store.delete(key);
  }
  // Still full of live entries: drop the oldest insertions (Map preserves order).
  while (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }
}

/**
 * Return the cached value for `key`, or run `fetch` and cache what it returns.
 *
 * The *promise* is cached, not the resolved value, so N concurrent callers
 * asking the same question make one upstream request. A rejected promise is
 * evicted so a transient failure isn't cached for six hours.
 */
export async function cached<T>(
  key: string,
  fetch: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<T> {
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.expires > Date.now()) return hit.value;

  evictIfFull();

  const value = fetch();
  store.set(key, { value, expires: Date.now() + ttlMs });
  value.catch(() => {
    // Only evict if we're still the owner — a later call may have replaced us.
    if (store.get(key)?.value === value) store.delete(key);
  });
  return value;
}

/** Build a stable cache key. Order matters, so pass parts in a fixed order. */
export function cacheKey(namespace: string, ...parts: string[]): string {
  return [namespace, ...parts.map((p) => p.trim().toLowerCase())].join(":");
}

/** Testing and manual invalidation. */
export function clearCache(): void {
  store.clear();
}

export function cacheSize(): number {
  return store.size;
}
