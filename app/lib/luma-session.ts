import "server-only";

import { cookies } from "next/headers";
import { EncryptJWT, jwtDecrypt } from "jose";
import { cookieSecure, sessionSecret } from "./env";
import { getLumaUser } from "./luma-api";

/**
 * The user's Luma login (`luma.auth-session-key`), kept so we can read the
 * guest lists Luma shows *them* — the full list of an event they're
 * registered for, not just the public featured guests.
 *
 * That value is a full credential for their Luma account, so this cookie is
 * **encrypted** (AES-256-GCM), HttpOnly and scoped to `/api/luma`. There are
 * no app accounts: the login belongs to whoever connected it in this browser.
 *
 * It is only ever sent to api.luma.com — never to you.com or anywhere else —
 * and must never be logged.
 */

const COOKIE = "luma_session";
const PATH = "/api/luma";
/** Luma's own session lasts longer; a stale one fails with a clear "reconnect". */
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export type LumaSession = {
  /** Value of Luma's `luma.auth-session-key` cookie. Secret. */
  cookie: string;
  /** The Luma account it belongs to — keys the per-user guest-list cache. */
  userApiId: string;
  name: string | null;
};

/** Derived from `SESSION_SECRET` with a fixed label, so the raw secret is never the key. */
async function encryptionKey(): Promise<Uint8Array> {
  const label = new TextEncoder().encode("hack14:luma-session:");
  const secret = sessionSecret();
  const input = new Uint8Array(label.length + secret.length);
  input.set(label);
  input.set(secret, label.length);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", input));
}

export async function setLumaSession(session: LumaSession) {
  const token = await new EncryptJWT({ ...session })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .encrypt(await encryptionKey());

  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
    path: PATH,
    maxAge: MAX_AGE,
  });
}

/** The Luma login stored in this browser, or null. */
export async function getLumaSession(): Promise<LumaSession | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtDecrypt(token, await encryptionKey());
    const { cookie, userApiId, name } = payload as Partial<LumaSession>;
    if (typeof cookie !== "string" || typeof userApiId !== "string") return null;
    return { cookie, userApiId, name: typeof name === "string" ? name : null };
  } catch {
    // Tampered, expired, or encrypted with an older SESSION_SECRET.
    return null;
  }
}

export async function clearLumaSession() {
  (await cookies()).delete({ name: COOKIE, path: PATH });
}

/**
 * Check a Luma login with Luma, then store it in this browser. Throws
 * `LumaAuthError` if Luma doesn't accept it.
 */
export async function storeLumaLogin(
  cookie: string,
): Promise<{ name: string | null }> {
  const user = await getLumaUser(cookie);
  await setLumaSession({
    cookie,
    userApiId: user.apiId,
    name: user.name,
  });
  return { name: user.name };
}
