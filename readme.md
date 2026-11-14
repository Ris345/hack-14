# hack-14

Recommends people to follow and events to attend, by matching your job title
against the people behind [Luma](https://lu.ma) events.

A single Next.js 16 app (App Router, Turbopack, React 19). No database: the
session is a signed HttpOnly cookie.

**Current state:**

- **Layer 1 — Google sign-in: done.** Sign in with a Google account, see who
  you are, sign out.
- **Layer 2 — recommendations: in progress.** Signed-in users can paste a
  Luma event link and see its public participants (hosts and featured guests)
  with their social links, fetched through the you.com Contents API. Each
  participant is then enriched from their LinkedIn, X and website (headline,
  location, bio, site summary); for people with no LinkedIn link, a
  conservative name search finds it. Title matching and recommendations
  aren't built yet.

See [Where this is going](#where-this-is-going) for the rest.

## Setup

### 1. Get Google credentials

This part is interactive and has to be done by hand:

1. [Google Cloud Console](https://console.cloud.google.com/) → create or select a project.
2. **APIs & Services → OAuth consent screen** → **External** → add your own Gmail
   address under **Test users** (otherwise Google blocks the sign-in).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** →
   **Web application**.
4. Under **Authorized redirect URIs** add exactly:

   ```
   http://localhost:3000/api/auth/callback/google
   ```

   It must match character for character — a trailing slash breaks it.
5. Copy the client ID and client secret.

### 2. Configure

```bash
cp .env.example .env.local   # if .env.local doesn't already exist
openssl rand -hex 32         # paste the output as SESSION_SECRET
```

Fill in `.env.local`:

| Variable | What it is |
|---|---|
| `GOOGLE_CLIENT_ID` | from the Console |
| `GOOGLE_CLIENT_SECRET` | from the Console |
| `SESSION_SECRET` | `openssl rand -hex 32`; signs the cookies |
| `APP_URL` | `http://localhost:3000` in dev; the public origin in production |
| `YDC_API_KEY` | you.com API key, from <https://you.com/platform>. Needed for the Luma event lookup; sign-in works without it. If it's missing, lookups fail and the server logs `Missing YDC_API_KEY` |

`.env.local` is gitignored. Never commit it.

Env vars are read lazily through getters in `app/lib/env.ts`, so a missing
one fails the request that needs it (with a message pointing at
`.env.example`), not `next build`.

### 3. Run

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
| `GET /api/auth/login` | Redirects to Google's consent screen. Must be a real navigation (`<a href>`), not a `fetch` |
| `GET /api/auth/callback/google` | Verifies `state`, exchanges the code (PKCE), verifies the ID token, sets the session cookie, redirects home. On failure redirects to `/?error=access_denied` (user cancelled) or `/?error=auth_failed` (anything else) |
| `GET /api/auth/me` | The signed-in user (`{ sub, email, name, picture }`) as JSON, or `401` |
| `POST /api/auth/logout` | Clears the session cookie, `204`. POST only, so a prefetch or an `<img>` can't sign you out |
| `POST /api/luma/participants` | Body `{ "url": "https://luma.com/<event>" }`. Signed-in only (`401` otherwise). Returns the event, its guest count and its public participants (`EventParticipants` in `app/lib/types.ts`). `400` for a non-Luma or malformed link, `422` if the page isn't a public event, `502` if the fetch fails |
| `POST /api/luma/enrich` | Body `{ "url": "https://luma.com/<event>", "personId"?: "usr-…" }`. Signed-in only. With `personId`: `Enrichment` for that participant (`404` if they aren't on the event); this is what the UI uses. Without: `EnrichedEvent`, every participant enriched (slow). The server only looks up people from the event it fetched itself, so the client can't make it search or fetch arbitrary things |

The page (`app/page.tsx`) calls `/api/auth/me` on mount, turns an `?error=`
code into a readable message, and strips it from the URL so a reload doesn't
bring it back. Client-side calls go through `app/lib/api.ts`.

## How it works

Standard OIDC authorization-code flow, hand-rolled on [`jose`](https://github.com/panva/jose):

- **PKCE (S256)** — the code can't be redeemed without the verifier.
- **`state`** — CSRF protection; a forged callback can't log your browser into
  someone else's account.
- **`nonce`** — ties the ID token to the request that started the flow.
- The ID token's signature is verified against Google's JWKS, plus its issuer,
  audience and nonce. Accounts with an unverified email are rejected. The
  access token is deliberately discarded — this layer needs an identity, not
  API access.
- Scopes are `openid email profile`, with `prompt=select_account` so the
  account chooser always shows.

The `state`, `nonce` and verifier travel in one short-lived signed cookie
(`oauth_tx`, 10 min) that is deleted the moment the callback reads it, valid
or not.

The session cookie (`session`, 7 days) is an HS256 JWT signed with
`SESSION_SECRET` — **signed, not encrypted**. Its payload (`sub`, `email`,
`name`, `picture`) is readable base64. That's fine for a name and an email;
don't put anything sensitive in it. It's `HttpOnly`, `SameSite=Lax`, and
`Secure` whenever `APP_URL` is `https://`.

## Layer 2: Luma participants via you.com

### Event lookup

Signed in, the home page shows an input for a Luma event link
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

**Limitation: this is not the full guest list.** A public Luma page carries
only the hosts and the ~10 guests Luma features; the rest are behind Luma's
login. The UI shows "N featured guests of M registered" so this is visible.

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

1. <http://localhost:3000> shows "Sign in with Google".
2. Click → Google consent → you land back showing your real Gmail address.
3. **Reload** — still signed in (this is what proves the cookie works, not just
   React state).
4. Sign out, then reload — still signed out.
5. In DevTools, the `session` cookie is `HttpOnly` and invisible to
   `document.cookie`.

## Layout

```
app/
  layout.tsx, globals.css      root layout; system font stack (no next/font/google)
  page.tsx, page.module.css    sign in / sign out UI (client component)
  event-lookup.tsx             Luma link input + participant list + enrichment (client component)
  lib/
    types.ts                   the User type, shared by routes and the page
    api.ts                     client-side helpers: loginUrl, fetchMe(), logout()
    env.ts                     env vars, read lazily               (server-only)
    session.ts                 session + OAuth-transaction cookies (server-only)
    google.ts                  authorization URL, PKCE, code exchange, ID-token verification (server-only)
    you.ts                     you.com Search + Contents client    (server-only)
    cache.ts                   query-keyed in-memory cache         (server-only)
    luma.ts                    event link → public participants    (server-only)
    enrich.ts                  participant → find LinkedIn, read LinkedIn/X/website (server-only)
  api/auth/{login,callback/google,me,logout}/route.ts
  api/luma/{participants,enrich}/route.ts
next.config.ts                 cacheComponents + partialPrefetching enabled
```

Modules marked server-only `import "server-only"` and must never be imported
from a client component.

## Where this is going

Sign-in is layer 1 — it exists to identify the user so later layers can
personalize. The app proper recommends **people to follow and events to
attend**:

```
Google sign-in  →  the user's own job title (LinkedIn URL, or typed in)
                        ↓
Luma public event pages  →  candidate people (hosts, listed attendees)
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

Built so far: the you.com client, the query cache, the Luma event lookup, and
per-participant enrichment, which already pulls each LinkedIn headline (see
[Layer 2](#layer-2-luma-participants-via-youcom)). Still to build: headline →
title extraction, title normalization and matching, and recommendations.

Two things this still needs from the user side:

- **The user's own title.** Google OAuth returns `sub`, `email`, `name`,
  `picture` and nothing else — no employer, no role. The user has to supply a
  LinkedIn URL or type their title.
- **Comparable titles.** Raw strings don't match: "SWE", "Senior Software
  Engineer II" and "Member of Technical Staff" are all the same role. Titles
  normalize to a canonical role plus a seniority level, and match on role with
  a ±1 seniority tolerance — cheaper than embeddings and far easier to debug
  when a recommendation looks wrong.

The cache is keyed on the **query** (an event, a person), not on the user, so
one lookup serves everyone. you.com calls are slow and metered; this is a
requirement, not an optimization. It's in memory for now; it needs a shared
store (e.g. Redis) once there's more than one server instance.

## Adding a database later

One place to change: in `app/api/auth/callback/google/route.ts`, between
`exchangeCode()` and `setSession()`, upsert the user by `sub` (Google's stable
user ID — not the email, which can change) and put your own user ID in the
session instead of the profile fields.

## Production notes

- Set `APP_URL` to the real origin; cookies become `Secure` automatically.
- Add `https://your-domain/api/auth/callback/google` to the Google client's redirect URIs.
- Rotating `SESSION_SECRET` invalidates every existing session.
