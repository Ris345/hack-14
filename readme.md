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
  with their social links, fetched through the you.com Contents API — or, after
  connecting their Luma login, the event's full guest list as Luma shows it
  to them as a registered guest. Each
  participant is then enriched from their LinkedIn, X and website (headline,
  location, bio, site summary); for people with no LinkedIn link, a
  conservative name search finds it. Tabs, search, role/industry filters,
  sorting and a starred "Want to meet" list narrow the list down. Matching
  against your own title and recommendations aren't built yet.

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
| `POST /api/auth/logout` | Clears the session cookie and the stored Luma login, `204`. POST only, so a prefetch or an `<img>` can't sign you out |
| `GET /api/luma/connect` | `{ connected: true, name }` or `{ connected: false }`: whether this user has a Luma login stored. Signed-in only |
| `POST /api/luma/connect` | Body `{ "cookie": "<luma.auth-session-key value>" }` (a `name=value` pair or a whole `Cookie:` header also works). Checks it with Luma's `/user`, then stores it encrypted. `400` if Luma rejects it, `502` if Luma is unreachable. The value is never logged or returned |
| `DELETE /api/luma/connect` | Forgets the stored Luma login (and any half-finished sign-in), `204` |
| `POST /api/luma/signin` | Sign in to Luma by emailed code, one step per request. Body `{ step: "start" \| "resend", email }`, `{ step: "code", email, code }`, `{ step: "password", email, password }` or `{ step: "two-factor", otp }`. Returns `{ next: "code" \| "password" \| "two-factor" }`, or `{ next: "done", connection }` once the login is stored. `400` with Luma's own message for a wrong code; `409` with `code: "verification_required"` or `"sso"` when the sign-in can only be done on luma.com (use the paste fallback) |
| `POST /api/luma/participants` | Body `{ "url": "https://luma.com/<event>" }`. Signed-in only (`401` otherwise). Returns the event, its guest count and its participants (`EventParticipants` in `app/lib/types.ts`): the full guest list (`source: "guest-list"`) when Luma is connected and the user can see it, else hosts and featured guests (`source: "public"`, with a `notice` saying why if Luma is connected). `400` for a non-Luma or malformed link, `422` if the page isn't an event, `401` with `code: "luma_auth"` if the stored Luma login has expired, `502` if the fetch fails |
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

### Event lookup (public)

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

A public Luma page carries only the hosts and the ~10 guests Luma features;
the rest are behind Luma's login. The UI shows "N featured guests of M
registered" so this is visible, and offers to connect Luma.

### Full guest list (Luma connected)

Luma shows an event's full guest list to people **registered** for it, when
the host has the guest list switched on. To read that list, the user connects
their Luma login once (`app/luma-connect.tsx`). Two ways:

**Default: sign in by emailed code** (`/api/luma/signin`) — works the same on a
phone. The email is prefilled from the Google sign-in, since most people use
the same address for Luma (a Luma account created with "Continue with Google"
is still tied to that email, so the code flow works for it).

1. `POST api.luma.com/auth/email/start-with-email {email}` — Luma emails a
   6-digit code and says how the account signs in (`email-code` or
   `password`).
2. The user types the code (the input has `autocomplete="one-time-code"`, so
   iOS and Android offer it straight from Mail) →
   `POST /auth/email/sign-in-with-code {email, code}`. Password accounts use
   `/auth/sign-in-with-password` instead.
3. If the account has two-factor auth, Luma answers `step: "two_factor"` with a
   `user_api_id` and `two_factor_shallow_secret`. Those are held for 10 minutes
   in a second encrypted cookie (`luma_signin`, same scheme as below, consumed
   on use) until the user enters their authenticator code →
   `POST /auth/sign-in-with-two-factor`.
4. Luma's response sets `luma.auth-session-key`; the server reads it from
   `Set-Cookie` (verbatim), checks it with `/user`, and stores it as below.

These are the calls luma.com's own sign-in dialog makes (with
`x-luma-client-type: luma-web`). Two things make Luma refuse a server-side
sign-in, and both send the user to the fallback: a Cloudflare Turnstile human
check (`auth/additional-verification-required`), which only a browser can
pass, and accounts that sign in through an organization's identity provider
(`sso_config`). Our Google sign-in can't be reused for Luma: Google issues
tokens for one app, and Luma only accepts ones issued to Luma.

**Status: blocked in practice.** In testing (Nov 2026), Luma answered
`start-with-email` from our server with the Turnstile check every time, so
the app shows the "verify you're human" message and opens the paste
fallback. Getting around that check isn't an option: it exists to stop
exactly this kind of server-side sign-in. Until Luma offers a way for other
apps to sign users in, the paste fallback is the working path.

Codes, passwords and the session are passed straight through, never logged
or stored apart from the encrypted login. This makes the app a sign-in screen
for another service, which is fine for your own account but looks like
phishing to anyone else — don't offer it to other people as is.

**Fallback: paste the cookie** ("Other ways to connect", desktop): copy the
value of `luma.auth-session-key` from luma.com in DevTools and paste it in.
`/api/luma/connect` checks it against Luma's `/user` and stores it.

**How the login is stored** (`app/lib/luma-session.ts`). That cookie value is
a full credential for the user's Luma account, so it is treated like a
password:

- Encrypted (JWE, `dir` + `A256GCM`, via `jose`) with a key derived from
  `SESSION_SECRET` (SHA-256 of a fixed label plus the secret), in an
  `HttpOnly`, `SameSite=Lax` cookie `luma_session`, `Secure` over HTTPS,
  scoped to `Path=/api/luma`, 30 days.
- Bound to the app user who connected it (the JWE subject is their Google
  `sub`): another account signing in on the same browser reads it as absent.
- Sent **only to api.luma.com** — never to you.com — and never logged or
  returned to the browser. Disconnecting or signing out deletes it. Rotating
  `SESSION_SECRET` invalidates it.
- Never put in the `session` cookie, which is signed but readable.

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
  event-lookup.tsx             Luma link input, enrichment, stars, filtered list (client component)
  luma-connect.tsx             connect Luma: email-code sign-in, paste fallback, disconnect (client component)
  people-filters.tsx           tabs, search, chips, sort; applyFilters() (client component)
  person-card.tsx              one participant: details, tags, star (client component)
  lib/
    types.ts                   shared types: User, Participant, EventParticipants, Enrichment
    api.ts                     client-side helpers: auth, event participants, enrichment
    classify.ts                role/industry tags + seniority from profile text (client-safe)
    env.ts                     env vars, read lazily               (server-only)
    session.ts                 session + OAuth-transaction cookies (server-only)
    google.ts                  authorization URL, PKCE, code exchange, ID-token verification (server-only)
    you.ts                     you.com Search + Contents client    (server-only)
    cache.ts                   query-keyed in-memory cache         (server-only)
    luma.ts                    event link → participants: public, or full guest list (server-only)
    luma-api.ts                api.luma.com client with the user's login (server-only)
    luma-session.ts            encrypted cookies: the Luma login, a pending 2FA sign-in (server-only)
    enrich.ts                  participant → find LinkedIn, read LinkedIn/X/website (server-only)
  api/auth/{login,callback/google,me,logout}/route.ts
  api/luma/{participants,enrich,connect,signin}/route.ts
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

Built so far: the you.com client, the query cache, the Luma event lookup,
per-participant enrichment (which already pulls each LinkedIn headline), and
keyword-based role/industry tags with filters (see
[Layer 2](#layer-2-luma-participants-via-youcom)). Still to build: the user's
own title, finer title normalization (role + seniority level) and matching
against it, and recommendations.

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
