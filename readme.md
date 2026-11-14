# hack-14

Recommends people to follow and events to attend, by matching your job title
against the people behind [Luma](https://lu.ma) events.

**This repo currently contains layer 1 only: Google sign-in.** A single
Next.js app (App Router) — sign in with a Google account, see who you are,
sign out. No database: the session is a signed HttpOnly cookie. See
[Where this is going](#where-this-is-going) for the rest.

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

`.env.local` is gitignored. Never commit it.

### 3. Run

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

## Routes

| Route | Behavior |
|---|---|
| `GET /api/auth/login` | Redirects to Google's consent screen. Must be a real navigation (`<a href>`), not a `fetch` |
| `GET /api/auth/callback/google` | Verifies `state`, exchanges the code (PKCE), verifies the ID token, sets the session cookie, redirects home |
| `GET /api/auth/me` | The signed-in user as JSON, or `401` |
| `POST /api/auth/logout` | Clears the session cookie, `204`. POST only, so a prefetch or an `<img>` can't sign you out |

## How it works

Standard OIDC authorization-code flow, hand-rolled on [`jose`](https://github.com/panva/jose):

- **PKCE (S256)** — the code can't be redeemed without the verifier.
- **`state`** — CSRF protection; a forged callback can't log your browser into
  someone else's account.
- **`nonce`** — ties the ID token to the request that started the flow.
- The ID token's signature is verified against Google's JWKS, plus its issuer,
  audience and nonce. The access token is deliberately discarded — this layer
  needs an identity, not API access.

The `state`, `nonce` and verifier travel in one short-lived signed cookie
(`oauth_tx`, 10 min) that is deleted the moment the callback reads it.

The session cookie is **signed, not encrypted** — its payload (`sub`, `email`,
`name`, `picture`) is readable base64. That's fine for a name and an email;
don't put anything sensitive in it. It's `HttpOnly`, `SameSite=Lax`, and
`Secure` whenever `APP_URL` is `https://`.

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
  page.tsx                     sign in / sign out UI (client component)
  lib/
    types.ts                   the User type
    env.ts                     env vars, read lazily so a missing one breaks a request, not the build
    session.ts                 session + OAuth-transaction cookies
    google.ts                  authorization URL, PKCE, code exchange, ID-token verification
  api/auth/{login,callback/google,me,logout}/route.ts
```

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

Two things this still needs:

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
requirement, not an optimization.

## Adding a database later

One place to change: in `app/api/auth/callback/google/route.ts`, between
`exchangeCode()` and `setSession()`, upsert the user by `sub` (Google's stable
user ID — not the email, which can change) and put your own user ID in the
session instead of the profile fields.

## Production notes

- Set `APP_URL` to the real origin; cookies become `Secure` automatically.
- Add `https://your-domain/api/auth/callback/google` to the Google client's redirect URIs.
- Rotating `SESSION_SECRET` invalidates every existing session.
