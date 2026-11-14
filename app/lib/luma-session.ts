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
 * That value is a full credential for their Luma account, so unlike the app
 * session (signed, readable) this cookie is **encrypted** (AES-256-GCM),
 * HttpOnly, scoped to `/api/luma`, and bound to the app user who connected
 * it: if someone else signs in on the same browser it reads as absent.
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

/** A separate key from the cookie-signing one, derived from the same secret. */
async function encryptionKey(): Promise<Uint8Array> {
  const label = new TextEncoder().encode("hack14:luma-session:");
  const secret = sessionSecret();
  const input = new Uint8Array(label.length + secret.length);
  input.set(label);
  input.set(secret, label.length);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", input));
}

export async function setLumaSession(appUserSub: string, session: LumaSession) {
  const token = await new EncryptJWT({ ...session })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setSubject(appUserSub)
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

/** The stored Luma login for this app user, or null. */
export async function getLumaSession(
  appUserSub: string,
): Promise<LumaSession | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtDecrypt(token, await encryptionKey(), {
      subject: appUserSub,
    });
    const { cookie, userApiId, name } = payload as Partial<LumaSession>;
    if (typeof cookie !== "string" || typeof userApiId !== "string") return null;
    return { cookie, userApiId, name: typeof name === "string" ? name : null };
  } catch {
    // Tampered, expired, another app user's, or an older SESSION_SECRET.
    return null;
  }
}

export async function clearLumaSession() {
  const store = await cookies();
  store.delete({ name: COOKIE, path: PATH });
  store.delete({ name: PENDING_COOKIE, path: PATH });
}

/**
 * Check a Luma login with Luma, then store it for this app user. Shared by the
 * email-code sign-in and the paste-a-cookie fallback. Throws `LumaAuthError`
 * if Luma doesn't accept it.
 */
export async function storeLumaLogin(
  appUserSub: string,
  cookie: string,
): Promise<{ name: string | null }> {
  const user = await getLumaUser(cookie);
  await setLumaSession(appUserSub, {
    cookie,
    userApiId: user.apiId,
    name: user.name,
  });
  return { name: user.name };
}

// ---------------------------------------------------------------------------
// A sign-in in progress: two-factor, between the first factor and the second
// ---------------------------------------------------------------------------

const PENDING_COOKIE = "luma_signin";
/** Long enough to open an authenticator app; short enough to be useless after. */
const PENDING_MAX_AGE = 60 * 10;

/** What Luma hands back after the first factor, needed to submit the second. */
export type PendingTwoFactor = { userApiId: string; shallowSecret: string };

export async function setPendingTwoFactor(appUserSub: string, pending: PendingTwoFactor) {
  const token = await new EncryptJWT({ ...pending })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setSubject(appUserSub)
    .setIssuedAt()
    .setExpirationTime(`${PENDING_MAX_AGE}s`)
    .encrypt(await encryptionKey());
  (await cookies()).set(PENDING_COOKIE, token, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
    path: PATH,
    maxAge: PENDING_MAX_AGE,
  });
}

/** The pending two-factor sign-in, consumed: it's deleted whether or not it's valid. */
export async function takePendingTwoFactor(
  appUserSub: string,
): Promise<PendingTwoFactor | null> {
  const store = await cookies();
  const token = store.get(PENDING_COOKIE)?.value;
  store.delete({ name: PENDING_COOKIE, path: PATH });
  if (!token) return null;
  try {
    const { payload } = await jwtDecrypt(token, await encryptionKey(), {
      subject: appUserSub,
    });
    const { userApiId, shallowSecret } = payload as Partial<PendingTwoFactor>;
    if (typeof userApiId !== "string" || typeof shallowSecret !== "string") return null;
    return { userApiId, shallowSecret };
  } catch {
    return null;
  }
}
