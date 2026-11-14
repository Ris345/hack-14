"use client";

import { useState, type FormEvent } from "react";
import {
  ApiError,
  connectLuma,
  disconnectLuma,
  lumaSignIn,
  type LumaConnection,
} from "./lib/api";
import styles from "./page.module.css";

type Step = "email" | "code" | "password" | "two-factor";

/**
 * Connect / disconnect the user's Luma login. Connected, event lookups return
 * the full guest list Luma shows them, not just the featured guests.
 *
 * Default: sign in with Luma's own emailed code, right here — works on a phone.
 * Fallback ("Other ways to connect"): paste the luma.com session cookie.
 */
export function LumaConnect({
  connection,
  onChange,
  defaultEmail,
}: {
  /** `null` while the status is still loading. */
  connection: LumaConnection | null;
  onChange: (next: LumaConnection) => void;
  /** The Google account's email: most people use the same one for Luma. */
  defaultEmail: string;
}) {
  const [step, setStep] = useState<Step>("email");
  // `?? ""` keeps the input controlled even if a caller omits the email.
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [secret, setSecret] = useState(""); // code, password or 2FA code
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showFallback, setShowFallback] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      // Luma won't let a server do this sign-in: point at the fallback.
      if (
        err instanceof ApiError &&
        (err.code === "verification_required" || err.code === "sso")
      ) {
        setShowFallback(true);
      }
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    void run(async () => {
      const res =
        step === "email"
          ? await lumaSignIn({ step: "start", email })
          : step === "code"
            ? await lumaSignIn({ step: "code", email, code: secret })
            : step === "password"
              ? await lumaSignIn({ step: "password", email, password: secret })
              : await lumaSignIn({ step: "two-factor", otp: secret });
      setSecret("");
      if (res.next === "done") {
        setStep("email");
        onChange(res.connection);
      } else {
        setStep(res.next);
      }
    });
  }

  function resend() {
    void run(async () => {
      await lumaSignIn({ step: "resend", email });
      setInfo("Sent a new code.");
    });
  }

  function startOver() {
    setStep("email");
    setSecret("");
    setError(null);
    setInfo(null);
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
        event. Sign in to Luma once and lookups will show it here too.
      </p>

      <form className={styles.form} onSubmit={onSubmit}>
        {step === "email" ? (
          <input
            className={styles.input}
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="Your Luma email"
            aria-label="Luma email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        ) : step === "password" ? (
          <input
            className={styles.input}
            type="password"
            autoComplete="current-password"
            placeholder="Luma password"
            aria-label="Luma password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            autoFocus
            required
          />
        ) : (
          <input
            className={styles.input}
            type="text"
            inputMode="numeric"
            // Lets iOS / Android offer the code straight from Mail / Messages.
            autoComplete="one-time-code"
            pattern="[0-9 ]*"
            placeholder={step === "code" ? "6-digit code from Luma" : "Authenticator code"}
            aria-label={step === "code" ? "Code from Luma's email" : "Two-factor code"}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            autoFocus
            required
          />
        )}
        <button className={styles.button} type="submit" disabled={busy}>
          {busy
            ? "…"
            : step === "email"
              ? "Email me a code"
              : step === "password"
                ? "Sign in"
                : "Connect"}
        </button>
      </form>

      {step === "code" ? (
        <p className={styles.muted}>
          Luma emailed a sign-in code to <strong>{email}</strong>.{" "}
          <button type="button" className={styles.linkButton} onClick={resend} disabled={busy}>
            Resend
          </button>{" "}
          ·{" "}
          <button type="button" className={styles.linkButton} onClick={startOver} disabled={busy}>
            Use a different email
          </button>
        </p>
      ) : step === "password" ? (
        <p className={styles.muted}>
          This Luma account uses a password. It goes straight to Luma and isn’t
          stored.{" "}
          <button type="button" className={styles.linkButton} onClick={startOver} disabled={busy}>
            Back
          </button>
        </p>
      ) : step === "two-factor" ? (
        <p className={styles.muted}>
          Your Luma account has two-factor authentication. Enter the code from
          your authenticator app.
        </p>
      ) : null}

      {info ? <p className={styles.muted}>{info}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}

      <details
        className={styles.fallback}
        open={showFallback}
        onToggle={(e) => setShowFallback(e.currentTarget.open)}
      >
        <summary>Other ways to connect</summary>
        <PasteCookie onConnected={onChange} />
      </details>

      <p className={styles.fineprint}>
        Signing in gives this app a Luma login for your account. It’s stored
        encrypted in an HttpOnly cookie for this browser, sent only to Luma,
        and forgotten when you disconnect or sign out.
      </p>
    </details>
  );
}

/** Desktop fallback: paste the `luma.auth-session-key` cookie from DevTools. */
function PasteCookie({ onConnected }: { onConnected: (next: LumaConnection) => void }) {
  const [cookie, setCookie] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!cookie.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      onConnected(await connectLuma(cookie));
      setCookie("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't connect Luma.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className={styles.muted}>
        On a computer where you’re signed in to luma.com, you can copy your
        login instead:
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
      <form className={styles.form} onSubmit={onSubmit}>
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
          {busy ? "Checking…" : "Connect"}
        </button>
      </form>
      {error ? <p className={styles.error}>{error}</p> : null}
    </>
  );
}
