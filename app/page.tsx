"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchMe, loginUrl, logout, type User } from "./lib/api";
import { EventLookup } from "./event-lookup";
import styles from "./page.module.css";

/** Errors the callback route can hand back on /?error=… when sign-in fails. */
const ERROR_MESSAGES: Record<string, string> = {
  auth_failed: "Sign-in failed or the request expired. Please try again.",
  access_denied: "Sign-in was cancelled.",
};

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The callback redirects to /?error=… when sign-in fails. Strip it
    // from the URL so a reload doesn't resurrect a stale message.
    const code = new URLSearchParams(window.location.search).get("error");
    if (code) {
      window.history.replaceState({}, "", window.location.pathname);
    }

    // Everything below lands in an async callback rather than the effect body,
    // so the initial state settles in one render instead of cascading.
    let cancelled = false;
    fetchMe()
      .then((me) => {
        if (cancelled) return;
        setUser(me);
        if (code) {
          setError(ERROR_MESSAGES[code] ?? "Sign-in failed. Please try again.");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("Couldn't check your sign-in status. Please reload.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = useCallback(async () => {
    setError(null);
    try {
      await logout();
      setUser(null);
    } catch {
      setError("Sign-out failed. Please try again.");
    }
  }, []);

  return (
    <main className={styles.main}>
      <div className={styles.card}>
        <h1 className={styles.title}>hack-14</h1>

        {loading ? (
          <p className={styles.muted}>Loading…</p>
        ) : user ? (
          <>
            <div className={styles.profile}>
              {user.picture ? (
                // Plain <img>: the avatar is an arbitrary Google URL, and
                // next/image would need that host allow-listed in next.config.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className={styles.avatar}
                  src={user.picture}
                  alt=""
                  width={56}
                  height={56}
                  referrerPolicy="no-referrer"
                />
              ) : null}
              <div>
                <div className={styles.name}>{user.name}</div>
                <div className={styles.muted}>{user.email}</div>
              </div>
            </div>
            <button className={styles.button} onClick={signOut}>
              Sign out
            </button>
          </>
        ) : (
          <>
            <p className={styles.muted}>Sign in to continue.</p>
            {/* A real navigation, not fetch — the OAuth flow leaves the site. */}
            <a className={styles.button} href={loginUrl}>
              Sign in with Google
            </a>
          </>
        )}

        {error ? <p className={styles.error}>{error}</p> : null}
      </div>

      {user ? <EventLookup /> : null}
    </main>
  );
}
