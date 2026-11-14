"use client";

import { useState, type FormEvent } from "react";
import { connectLuma, disconnectLuma, type LumaConnection } from "./lib/api";
import styles from "./page.module.css";

/**
 * Connect / disconnect the user's Luma login. Connected, event lookups return
 * the full guest list Luma shows them, not just the featured guests.
 *
 * The login is the `luma.auth-session-key` cookie, copied from luma.com in
 * DevTools. (Signing in to Luma from our server isn't possible: Luma demands a
 * browser-only human check, and its login cookie can't be read by other sites.)
 */
export function LumaConnect({
  connection,
  onChange,
}: {
  /** `null` while the status is still loading. */
  connection: LumaConnection | null;
  onChange: (next: LumaConnection) => void;
}) {
  const [cookie, setCookie] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  function onConnect(e: FormEvent) {
    e.preventDefault();
    if (!cookie.trim() || busy) return;
    void run(async () => {
      onChange(await connectLuma(cookie));
      setCookie("");
    });
  }

  if (!connection) return null;

  if (connection.connected) {
    return (
      <div className={styles.lumaBar}>
        <span>
          <span className={styles.lumaDot} aria-hidden /> Luma connected
          {connection.name ? ` as ${connection.name}` : ""}. Lookups show the
          full guest list for events you’re registered for.
        </span>
        <button
          type="button"
          className={styles.linkButton}
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await disconnectLuma();
              onChange({ connected: false });
            })
          }
        >
          Disconnect
        </button>
        {error ? <p className={styles.error}>{error}</p> : null}
      </div>
    );
  }

  return (
    <details className={styles.lumaConnect}>
      <summary>See the full guest list — connect Luma</summary>
      <p className={styles.muted}>
        Luma shows everyone on the guest list to people registered for the
        event. Connect your Luma login once, on a computer where you’re signed
        in to luma.com, and lookups will show it here too:
      </p>
      <ol className={styles.steps}>
        <li>
          Open <a href="https://luma.com" target="_blank" rel="noreferrer">luma.com</a>{" "}
          and make sure you’re signed in.
        </li>
        <li>
          Open DevTools → <strong>Application</strong> (Chrome) or{" "}
          <strong>Storage</strong> (Firefox/Safari) → Cookies →{" "}
          <code>https://luma.com</code>.
        </li>
        <li>
          Copy the value of <code>luma.auth-session-key</code> and paste it here.
        </li>
      </ol>
      <form className={styles.form} onSubmit={onConnect}>
        <input
          className={styles.input}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="luma.auth-session-key value"
          aria-label="Luma session cookie"
          value={cookie}
          onChange={(e) => setCookie(e.target.value)}
          required
        />
        <button className={styles.button} type="submit" disabled={busy}>
          {busy ? "Checking…" : "Connect Luma"}
        </button>
      </form>
      {error ? <p className={styles.error}>{error}</p> : null}
      <p className={styles.fineprint}>
        This is a login to your Luma account. It’s checked with Luma, then
        stored encrypted in an HttpOnly cookie for this browser, sent only to
        Luma, and forgotten when you disconnect or sign out. Treat it like a
        password.
      </p>
    </details>
  );
}
