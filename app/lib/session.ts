import "server-only";

import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { cookieSecure, sessionSecret } from "./env";
import type { User } from "./types";

const SESSION_COOKIE = "session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

/** Short-lived cookie carrying the CSRF state, OIDC nonce and PKCE verifier. */
const TX_COOKIE = "oauth_tx";
const TX_MAX_AGE = 60 * 10; // 10 minutes to finish the Google round trip

export type Transaction = {
  state: string;
  nonce: string;
  verifier: string;
};

/**
 * Both cookies are signed, NOT encrypted — the payload is readable base64. Fine
 * for a name and email; never put anything sensitive in them.
 */
async function sign(payload: Record<string, unknown>, maxAge: number) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${maxAge}s`)
    .sign(sessionSecret());
}

async function verify<T>(token: string): Promise<T | null> {
  try {
    const { payload } = await jwtVerify(token, sessionSecret());
    return payload as T;
  } catch {
    // Tampered, expired, or signed with an older SESSION_SECRET.
    return null;
  }
}

const base = () => ({
  httpOnly: true,
  secure: cookieSecure(),
  // Lax still sends the cookie on the top-level GET that Google redirects back
  // to, which is exactly what the callback needs.
  sameSite: "lax" as const,
  path: "/",
});

export async function setSession(user: User) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, await sign({ ...user }, SESSION_MAX_AGE), {
    ...base(),
    maxAge: SESSION_MAX_AGE,
  });
}

export async function getSession(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = await verify<User & { exp: number }>(token);
  if (!payload) return null;
  const { sub, email, name, picture } = payload;
  return { sub, email, name, picture };
}

export async function clearSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function setTransaction(tx: Transaction) {
  const cookieStore = await cookies();
  cookieStore.set(TX_COOKIE, await sign({ ...tx }, TX_MAX_AGE), {
    ...base(),
    maxAge: TX_MAX_AGE,
  });
}

export async function takeTransaction(): Promise<Transaction | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(TX_COOKIE)?.value;
  // One shot: the transaction is spent whether or not it turns out to be valid.
  cookieStore.delete(TX_COOKIE);
  if (!token) return null;
  const payload = await verify<Transaction>(token);
  if (!payload?.state || !payload.nonce || !payload.verifier) return null;
  return { state: payload.state, nonce: payload.nonce, verifier: payload.verifier };
}
