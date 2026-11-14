# hack-14

Recommends people to follow and events to attend, by matching your job title
against the people behind [Luma](https://lu.ma) events.

A single Next.js 16 app (App Router, Turbopack, React 19). No accounts and no
database: anyone with the link can use it.

**Current state:** paste a Luma event link and see its public participants
(hosts and featured guests) with their social links, fetched through the
you.com Contents API — or, after connecting your Luma login, the event's full
guest list as Luma shows it to you as a registered guest. Each participant is
then enriched from their LinkedIn, X and website (headline, location, bio,
site summary); for people with no LinkedIn link, a conservative name search
finds it. Tabs, search, role/industry filters, sorting and a starred "Want to
meet" list narrow the list down. Matching against your own title and
recommendations aren't built yet.

**It's open on purpose.** There's no sign-in, so anyone who has the URL can run
lookups, and every new event or profile read is a paid you.com call (cached for
6 hours). Fine for a demo; put something in front of it (an access code, or
Vercel's deployment protection) before sharing it widely.

See [Where this is going](#where-this-is-going) for the rest.

## Setup

### 1. Configure

```bash
cp .env.example .env.local   # if .env.local doesn't already exist
openssl rand -hex 32         # paste the output as SESSION_SECRET
```

Fill in `.env.local`:

| Variable | What it is |
|---|---|
| `YDC_API_KEY` | you.com API key, from <https://you.com/platform>. Needed for every event lookup and profile read. If it's missing, lookups fail and the server logs `Missing YDC_API_KEY` |
| `SESSION_SECRET` | `openssl rand -hex 32`. Encrypts the stored Luma login. Only needed to connect Luma; lookups work without it |

`.env.local` is gitignored. Never commit it.

Env vars are read lazily through getters in `app/lib/env.ts`, so a missing
one fails the request that needs it (with a message pointing at
`.env.example`), not `next build`.

### 2. Run

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

### Checks

```bash
npx tsc --noEmit
npx eslint .
npm run build
```

If npm fails with an `EPERM … _cacache` "root-owned files" error, prefix the
command with `npm_config_cache="$TMPDIR/npm-cache"`.

## Routes

| Route | Behavior |
|---|---|
| `GET /api/luma/connect` | `{ connected: true, name }` or `{ connected: false }`: whether this browser has a Luma login stored |
| `POST /api/luma/connect` | Body `{ "cookie": "<luma.auth-session-key value>" }` (a `name=value` pair or a whole `Cookie:` header also works). Checks it with Luma's `/user`, then stores it encrypted. `400` if Luma rejects it, `502` if Luma is unreachable. The value is never logged or returned |
| `DELETE /api/luma/connect` | Forgets the stored Luma login, `204` |
| `POST /api/luma/participants` | Body `{ "url": "https://luma.com/<event>" }`. Returns the event, its guest count and its participants (`EventParticipants` in `app/lib/types.ts`): the full guest list (`source: "guest-list"`) when Luma is connected and the user can see it, else hosts and featured guests (`source: "public"`, with a `notice` saying why if Luma is connected). `400` for a non-Luma or malformed link, `422` if the page isn't an event, `401` with `code: "luma_auth"` if the stored Luma login has expired, `502` if the fetch fails |
| `POST /api/luma/enrich` | Body `{ "url": "https://luma.com/<event>", "personId"?: "usr-…" }`. With `personId`: `Enrichment` for that participant (`404` if they aren't on the event); this is what the UI uses. Without: `EnrichedEvent`, every participant enriched (slow). The server only looks up people from the event it fetched itself, so the client can't make it search or fetch arbitrary things |

No route requires sign-in. Client-side calls go through `app/lib/api.ts`.

## Layer 2: Luma participants via you.com

### Event lookup (public)

The home page is an input for a Luma event link
(`app/event-lookup.tsx`). It posts to `/api/luma/participants`, which calls
`getEventParticipants()` in `app/lib/luma.ts`:

1. **Normalize the link** to `https://luma.com/<slug>` (`lu.ma` accepted). The
   query string is dropped — `?tk=…` is a personal invite token and shouldn't
   go to a third party or split the cache.
2. **Fetch the page's raw HTML** with the you.com Contents API
   (`crawl_timeout` 30 s; Luma pages are heavy).
3. **Parse the embedded Next.js JSON** (`<script id="__NEXT_DATA__">`,
   `props.pageProps.initialData.data`): the event name and start time, the
   guest count, `hosts`, and `featured_guests`.
4. **Map each person** to `{ name, role, avatarUrl, bio, socials }`, turning
   Luma's stored handles (`/in/jdoe`, `@jdoe`, `jdoe`) into full LinkedIn, X,
   Instagram, TikTok, YouTube, website and Luma profile URLs.

A public Luma page carries only the hosts and the ~10 guests Luma features;
the rest are behind Luma's login. The UI shows "N featured guests of M
registered" so this is visible, and offers to connect Luma.

### Full guest list (Luma connected)

Luma shows an event's full guest list to people **registered** for it, when
the host has the guest list switched on. To read that list, the user connects
their Luma login once (`app/luma-connect.tsx`): on a computer where they're
signed in to luma.com, they copy the value of the `luma.auth-session-key`
cookie in DevTools and paste it in. `/api/luma/connect` checks it against
Luma's `/user` and stores it.

**Why pasting, and not something smoother.** We tried the alternatives:

- *Luma's email-code sign-in, run from our server.* Luma answers it with a
  Cloudflare Turnstile human check (`auth/additional-verification-required`)
  that only a real browser on luma.com can pass, so it was removed. Getting
  around that check isn't an option: it exists to stop exactly this.
- *"Sign in with Google" for Luma.* Google issues tokens for one app; Luma
  only accepts tokens issued to Luma.
- *Reading the cookie from luma.com in another tab, or an iframe.* Browsers
  don't let one site read another's cookies, and Luma offers no OAuth /
  "Sign in with Luma" redirect back to other apps.

The login is stored per browser, so a phone needs its own connection. Sharing
one across devices would need app accounts plus a server-side store.

**How the login is stored** (`app/lib/luma-session.ts`). That cookie value is
a full credential for the user's Luma account, so it is treated like a
password:

- Encrypted (JWE, `dir` + `A256GCM`, via `jose`) with a key derived from
  `SESSION_SECRET` (SHA-256 of a fixed label plus the secret), in an
  `HttpOnly`, `SameSite=Lax` cookie `luma_session`, `Secure` over HTTPS,
  scoped to `Path=/api/luma`, 30 days.
- Per browser: there are no app accounts, so it belongs to whoever connected
  it in that browser.
- Sent **only to api.luma.com** — never to you.com — and never logged or
  returned to the browser. Disconnecting deletes it. Rotating
  `SESSION_SECRET` invalidates it.

**How the list is read** (`app/lib/luma-api.ts`, the endpoints luma.com's own
pages call; undocumented, so read defensively):

1. `GET api.luma.com/url?url=<slug>` with the login cookie returns the same
   event data the public page embeds, plus `guest_data`: the user's own
   registration, including their `ticket_key` and `approval_status`.
2. If the host hid the list (`event.show_guest_list: false`), the user isn't
   registered (no `ticket_key`), or their registration isn't approved, the
   lookup returns the hosts and featured guests from that same data with a
   `notice` explaining why. No you.com call is made.
3. Otherwise `GET api.luma.com/event/get-guest-list?event_api_id=…&ticket_key=…&pagination_limit=100`
   is followed through `next_cursor` until `has_more` is false (capped at 50
   pages). Each entry's `user` has the same shape as a host, so the same
   mapping applies. Hosts and duplicate tickets are dropped from the guests.
4. A `401`/`403` from Luma surfaces as `401` with `code: "luma_auth"`, and the
   UI shows the connect form again.

The result is cached for 10 minutes **per Luma account** (key
`luma:as-guest:<luma user id>:<slug>`), never shared: a guest list is only
visible to people registered for the event.

**Enriching a big list.** Reading profiles costs up to ~$0.008 a person and a
few seconds each, so it runs automatically only for events of 40 people or
fewer. Above that, filter or star first, then click **Read profiles for the N
people shown**, which shows the worst-case cost.

Luma's terms may restrict automated access, even with your own login. This is
fine for a prototype; check them before offering it to other people.

### Enrichment

Once the participant list is on screen, the page calls `/api/luma/enrich`
for each person, four at a time, and fills in each card as results arrive.
`enrichParticipant()` in `app/lib/enrich.ts` works in two steps.

**1. Find their LinkedIn.** If Luma lists it, it's used as-is
(`confidence: "high"`) and no search is spent. Otherwise you.com Search runs
over `linkedin.com` for `"<name> <first clause of their bio> LinkedIn"`, and a
result only counts if it's a personal profile (`/in/<slug>`) **and** its title
contains every part of the person's name (accents and punctuation ignored).
That match is `confidence: "medium"`, and the UI labels it "Found by name
search — check it's them". Anything less resolves to no LinkedIn at all: a
wrong profile is worse than none. Names under three characters aren't
searched.

**2. Read their pages.** The LinkedIn profile, X profile and website are
fetched in parallel with the you.com Contents API (markdown, 20 s crawl
timeout) and parsed:

| Source | Fields | From you.com's markdown |
|---|---|---|
| LinkedIn | `headline`, `location`, `about` | the bold headline line, `- **Location**: …`, the first paragraph |
| X | `bio`, `followers` | `- **description**: …`, `- **followers_count**: …` |
| Website | `title`, `summary` | the page title, the first real paragraph |

Every fetch is best-effort: a page that fails (login wall, timeout) just
leaves its section out, and a format change yields `null` fields rather than
an error. If a found LinkedIn page can't be read, the headline and summary
from the search result are used instead. Long text is clipped to 280
characters. Searches are cached per query and pages per URL, so someone who
appears at several events is looked up once. Cost per person is up to three
pages (about $0.003 at $1 per 1,000 pages), plus one search for people
without a LinkedIn link. Search runs without highlights, since the matched
profile is read with the Contents API anyway.

`enrichParticipants(list)` does the same for a whole list, four at a time,
preserving order (used by the route when no `personId` is given).

Instagram, TikTok and YouTube links are shown but not enriched yet.

### Filters

Above the list, a filter bar (`app/people-filters.tsx`) narrows the
participants down to the ones worth talking to. It runs entirely in the
browser on data already loaded, so it costs no you.com calls, and it
updates live as enrichment arrives.

- **Tabs:** All · Hosts · Guests · ★ Want to meet. Each count reflects the
  other active filters.
- **Search:** every word must appear somewhere in the person's name, Luma
  bio, LinkedIn headline/about/location, X bio or website.
- **Role** chips (Founder, Leadership, Engineer, Research / Data, Product,
  Design, Investor, Sales / Growth, Marketing, Community / Events,
  Advisor / Consultant, Student).
- **Industry & interests** chips (AI, Fintech, Crypto / Web3, Health / Bio,
  Climate / Energy, Dev tools / Infra, B2B / SaaS, Consumer, Media / Creator,
  Education, Robotics / Hardware, Real estate, Legal).
- **Sort:** Hosts first (Luma's order), Most senior, Most X followers, Name.

Within a chip group a person needs any selected chip; across groups, all of
them (e.g. Engineer **and** (AI **or** Fintech)). Chips nobody matches are
hidden, and chip counts ignore their own group so selecting one doesn't zero
out its neighbours.

**Tags** come from `app/lib/classify.ts`: plain keyword rules (word-bounded,
case-insensitive), so a wrong tag can be traced to the word that caused it.
Roles are read only from what someone *does* (Luma bio, LinkedIn headline, X
bio), so "I write about founders" in an About section doesn't make someone a
founder; industries read everything. Seniority for sorting runs 5 (founder,
C-level) → 4 (VP, head of, partner) → 3 (director) → 2 (lead, senior,
manager) → 0 (student, intern), with 1 for anything else. Each card shows its
tags, and clicking one toggles that filter.

**Stars** ("Want to meet") are kept in `localStorage` under
`hack14:starred:<event url>`: per browser, per event, never sent to the
server. Blocked storage just means stars last for the session.

### you.com client and cache

**`app/lib/you.ts`** — a thin typed client for the you.com Search and
Contents APIs (`POST https://ydc-index.io/v1/{search,contents}`,
`X-API-Key: $YDC_API_KEY`). Transport only; no Luma or LinkedIn knowledge
lives here.

- `contents(url, { formats, crawlTimeout, maxAge })` returns one page's
  `markdown` / `html` / `metadata`, or `null` if you.com couldn't fetch it
  ($1 per 1,000 pages).
- `search(query, { count, includeDomains, freshness, highlights })` returns
  `WebResult[]`. `highlights: true` asks you.com to extract the matching
  passages of each page — slower, but it's what makes results usable as text.
- 30 s request timeout (highlight extraction crawls pages).
- Non-2xx responses throw `YouApiError`, which carries `status` so callers
  can tell a `429` apart.
- `resultText(result)` returns the highlights, else the snippets, else the
  description.

**`app/lib/cache.ts`** — an in-memory cache keyed on the **query**, not the
user, so one lookup serves everyone. Every `search()` and `contents()` call
goes through it.

- `cached(key, fetch, ttlMs?)` caches the *promise*, so concurrent identical
  queries make one upstream call. A rejected promise is evicted, so a
  transient failure isn't cached.
- Default TTL 6 hours; bounded at 1000 entries (expired first, then oldest).
- Stored on `globalThis` so it survives Turbopack hot reloads in dev, which
  would otherwise re-spend metered credits on every edit.
- Per-process: it dies with the server and isn't shared across instances.
  Moving to Redis means reimplementing `cached()` only.
- `cacheKey(namespace, ...parts)` builds keys (parts trimmed and lowercased).

## Verifying it works

1. <http://localhost:3000> shows the event-link input.
2. Paste a public Luma event link → hosts and featured guests appear, then
   fill in with LinkedIn / X / website details.
3. Optional: open **See the full guest list — connect Luma**, paste your
   `luma.auth-session-key`, and look up an event you're registered for → the
   full guest list.
4. In DevTools, the `luma_session` cookie is `HttpOnly`, scoped to
   `/api/luma`, and its value is ciphertext.

## Layout

```
app/
  layout.tsx, globals.css      root layout; system font stack (no next/font/google)
  page.tsx, page.module.css    the home page: header + event lookup
  event-lookup.tsx             Luma link input, enrichment, stars, filtered list (client component)
  luma-connect.tsx             connect / disconnect the user's Luma login (client component)
  people-filters.tsx           tabs, search, chips, sort; applyFilters() (client component)
  person-card.tsx              one participant: details, tags, star (client component)
  lib/
    types.ts                   shared types: Participant, EventParticipants, Enrichment, LumaConnection
    api.ts                     client-side helpers: event participants, enrichment, Luma connect
    classify.ts                role/industry tags + seniority from profile text (client-safe)
    env.ts                     env vars, read lazily               (server-only)
    you.ts                     you.com Search + Contents client    (server-only)
    cache.ts                   query-keyed in-memory cache         (server-only)
    luma.ts                    event link → participants: public, or full guest list (server-only)
    luma-api.ts                api.luma.com client with the user's login (server-only)
    luma-session.ts            encrypted cookie holding the Luma login (server-only)
    enrich.ts                  participant → find LinkedIn, read LinkedIn/X/website (server-only)
  api/luma/{participants,enrich,connect}/route.ts
next.config.ts                 cacheComponents + partialPrefetching enabled
```

Modules marked server-only `import "server-only"` and must never be imported
from a client component.

## Where this is going

The app proper recommends **people to follow and events to attend**:

```
the user's own job title (LinkedIn URL, or typed in)
                        ↓
Luma event pages  →  candidate people (hosts, guests)
                        ↓
you.com  →  each candidate's public LinkedIn headline → their title
                        ↓
normalize to (role, seniority)  →  match on role, seniority ±1
                        ↓
recommend: people to follow + the events they'll be at
                        ↓
cache, keyed on the query — shared across users
```

**The signal is job-title overlap.** Two people match when their roles line up
— both software engineers, both design architects. Deliberately *not*
connection graphs or mutuals: those sit behind LinkedIn's login wall and no
search-based tool reaches them. Public headlines are indexed and do.

Built so far: the you.com client, the query cache, the Luma event lookup,
per-participant enrichment (which already pulls each LinkedIn headline), and
keyword-based role/industry tags with filters (see
[Layer 2](#layer-2-luma-participants-via-youcom)). Still to build: the user's
own title, finer title normalization (role + seniority level) and matching
against it, and recommendations.

Two things this still needs from the user side:

- **The user's own title.** There are no accounts, so nothing is known about
  the user. They'd supply a LinkedIn URL or type their title (kept in the
  browser, like stars).
- **Comparable titles.** Raw strings don't match: "SWE", "Senior Software
  Engineer II" and "Member of Technical Staff" are all the same role. Titles
  normalize to a canonical role plus a seniority level, and match on role with
  a ±1 seniority tolerance — cheaper than embeddings and far easier to debug
  when a recommendation looks wrong.

The cache is keyed on the **query** (an event, a person), not on the user, so
one lookup serves everyone. you.com calls are slow and metered; this is a
requirement, not an optimization. It's in memory for now; it needs a shared
store (e.g. Redis) once there's more than one server instance.

## Deploying to Vercel

1. **Import the repo.** In the Vercel dashboard: Add New → Project → import
   `Ris345/hack-14`. The defaults (Next.js, `npm run build`) are right. Every
   merge to `main` then redeploys.
2. **Environment variables** (Project → Settings → Environment Variables,
   ticked for **Production**):

   | Variable | Value |
   |---|---|
   | `YDC_API_KEY` | your you.com key |
   | `SESSION_SECRET` | a **new** one: `openssl rand -hex 32`. Don't reuse dev's. Needed for Connect Luma |

   Redeploy after adding them; env vars apply to new deployments only.

Then open the URL and look up an event.

On Vercel:

- The Luma routes declare `maxDuration = 60` (a you.com page fetch can take up
  to ~50 s), which every Vercel plan allows.
- Cookies are `Secure` automatically (`VERCEL=1`).
- The cache (`app/lib/cache.ts`) is per serverless instance and resets on cold
  starts, so you.com is called a bit more often than in dev. A shared store
  (Redis) would fix that.

## Production notes

- Anyone with the URL can use the app and spend your you.com credits. Add an
  access gate before sharing it beyond a demo.
- Rotating `SESSION_SECRET` invalidates every stored Luma login.
