import { NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import {
  setPendingTwoFactor,
  storeLumaLogin,
  takePendingTwoFactor,
} from "@/app/lib/luma-session";
import {
  LumaAuthError,
  LumaSignInError,
  LumaVerificationRequired,
  sendSignInCode,
  signInWithCode,
  signInWithPassword,
  signInWithTwoFactor,
  startEmailSignIn,
  type SignInResult,
} from "@/app/lib/luma-api";
import type { LumaSignInStep } from "@/app/lib/types";

/**
 * Sign in to Luma from inside the app with Luma's own email-code flow, so the
 * user never has to copy a cookie — works the same on a phone.
 *
 * One step per request; the response says what to ask for next:
 *
 *   { step: "start",      email }            → next: "code" | "password"
 *   { step: "resend",     email }            → next: "code"
 *   { step: "code",       email, code }      → next: "done" | "two-factor"
 *   { step: "password",   email, password }  → next: "done" | "two-factor"
 *   { step: "two-factor", otp }              → next: "done"
 *
 * Errors carry `code: "verification_required"` (Luma wants a browser-only human
 * check) or `code: "sso"` (the account signs in through an identity provider);
 * both mean "use the paste fallback". Codes, passwords and the resulting
 * session are passed straight to Luma / the encrypted cookie, never logged.
 */
export async function POST(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const text = (key: string) =>
    typeof body[key] === "string" ? (body[key] as string).trim() : "";

  try {
    switch (body.step) {
      case "start":
      case "resend": {
        const email = text("email").toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return fail("Enter the email you use for Luma.", 400);
        }
        if (body.step === "resend") {
          await sendSignInCode(email);
          return next("code");
        }
        const how = await startEmailSignIn(email);
        if (how === "sso") {
          return fail(
            "This Luma account signs in through your organization's login, which only works on luma.com. Use “Other ways to connect” below.",
            409,
            "sso",
          );
        }
        return next(how === "password" ? "password" : "code");
      }

      case "code": {
        const email = text("email").toLowerCase();
        const code = text("code").replace(/\s+/g, "");
        if (!email || !/^\d{4,8}$/.test(code)) {
          return fail("Enter the code from Luma's email.", 400);
        }
        return finish(user.sub, await signInWithCode(email, code));
      }

      case "password": {
        const email = text("email").toLowerCase();
        const password = typeof body.password === "string" ? body.password : "";
        if (!email || !password) return fail("Enter your Luma password.", 400);
        return finish(user.sub, await signInWithPassword(email, password));
      }

      case "two-factor": {
        const otp = text("otp").replace(/\s+/g, "");
        if (!/^\d{6,8}$/.test(otp)) return fail("Enter the 6-digit code from your authenticator app.", 400);
        const pending = await takePendingTwoFactor(user.sub);
        if (!pending) return fail("That sign-in timed out. Start again.", 400);
        return finish(
          user.sub,
          await signInWithTwoFactor(pending.userApiId, pending.shallowSecret, otp),
        );
      }

      default:
        return fail("Unknown step.", 400);
    }
  } catch (err) {
    if (err instanceof LumaVerificationRequired) {
      return fail(
        "Luma wants to verify you're human, which only works on luma.com itself. Use “Other ways to connect” below.",
        409,
        "verification_required",
      );
    }
    if (err instanceof LumaSignInError) {
      // Luma's own words: "Invalid code", "Too many attempts", …
      return fail(err.message, 400);
    }
    if (err instanceof LumaAuthError) {
      return fail("Luma signed you in but the login didn't work. Try again.", 502);
    }
    // Never log `err` with its request: it may carry a code or password.
    console.error("Luma sign-in failed:", err instanceof Error ? err.message : "unknown error");
    return fail("Couldn't reach Luma. Try again.", 502);
  }
}

async function finish(appUserSub: string, result: SignInResult) {
  if (result.kind === "two-factor") {
    await setPendingTwoFactor(appUserSub, {
      userApiId: result.userApiId,
      shallowSecret: result.shallowSecret,
    });
    return next("two-factor");
  }
  const { name } = await storeLumaLogin(appUserSub, result.cookie);
  return NextResponse.json({
    next: "done",
    connection: { connected: true, name },
  } satisfies LumaSignInStep);
}

function next(step: Exclude<LumaSignInStep["next"], "done">) {
  return NextResponse.json({ next: step } satisfies LumaSignInStep);
}

function fail(error: string, status: number, code?: "verification_required" | "sso") {
  return NextResponse.json({ error, code }, { status });
}
