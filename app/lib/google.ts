import "server-only";

import { createRemoteJWKSet, jwtVerify } from "jose";
import {
  googleClientId,
  googleClientSecret,
  redirectUri,
} from "./env";
import type { User } from "./types";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

// Cached across requests: the module is evaluated once, and the set refreshes
// itself when Google rotates a key.
const jwks = createRemoteJWKSet(new URL(JWKS_URI));

/** URL-safe random string, used for the state, nonce and PKCE verifier. */
export function randomString(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return Buffer.from(buf).toString("base64url");
}

/** S256 PKCE challenge for a verifier. */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return Buffer.from(digest).toString("base64url");
}

export function authorizationUrl(opts: {
  state: string;
  nonce: string;
  challenge: string;
}): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", googleClientId());
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", opts.state);
  url.searchParams.set("nonce", opts.nonce);
  url.searchParams.set("code_challenge", opts.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  // Keeps the account chooser from being skipped when several are signed in.
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

/**
 * Trade the authorization code for tokens, then verify the ID token's
 * signature, issuer, audience and nonce. Returns the user it describes.
 *
 * Only the ID token is used — this layer needs an identity, not API access, so
 * the access token is deliberately discarded rather than stored.
 */
export async function exchangeCode(
  code: string,
  verifier: string,
  nonce: string,
): Promise<User> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: googleClientId(),
      client_secret: googleClientSecret(),
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
  });

  if (!res.ok) {
    // The body echoes the client_id but never the secret; still, keep it out of
    // the response to the browser — this is logged server-side only.
    throw new Error(`Token exchange failed: ${res.status}`);
  }

  const { id_token: idToken } = (await res.json()) as { id_token?: string };
  if (!idToken) throw new Error("Token response had no id_token");

  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: ISSUERS,
    audience: googleClientId(),
  });

  if (payload.nonce !== nonce) throw new Error("Nonce mismatch");
  if (!payload.sub || typeof payload.email !== "string") {
    throw new Error("ID token missing sub or email");
  }
  if (payload.email_verified === false) {
    throw new Error("Google account has an unverified email");
  }

  return {
    sub: payload.sub,
    email: payload.email,
    name: typeof payload.name === "string" ? payload.name : payload.email,
    picture: typeof payload.picture === "string" ? payload.picture : null,
  };
}
