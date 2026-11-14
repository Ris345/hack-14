import { NextResponse, type NextRequest } from "next/server";
import { appUrl } from "@/app/lib/env";
import { exchangeCode } from "@/app/lib/google";
import { setSession, takeTransaction } from "@/app/lib/session";

/** Send the user home with a code the page turns into a readable message. */
function fail(reason: string) {
  return NextResponse.redirect(`${appUrl()}/?error=${reason}`);
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  // The user hit "Cancel", or Google refused the request outright.
  if (params.get("error")) return fail("access_denied");

  const code = params.get("code");
  const state = params.get("state");
  const tx = await takeTransaction();

  if (!code || !state || !tx) return fail("auth_failed");
  // The state check is what stops a forged callback from logging this browser
  // into an attacker's account.
  if (state !== tx.state) return fail("auth_failed");

  try {
    const user = await exchangeCode(code, tx.verifier, tx.nonce);
    await setSession(user);
  } catch (err) {
    console.error("OAuth callback failed:", err);
    return fail("auth_failed");
  }

  return NextResponse.redirect(appUrl());
}
