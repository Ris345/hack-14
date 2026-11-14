import { NextResponse } from "next/server";
import { authorizationUrl, pkceChallenge, randomString } from "@/app/lib/google";
import { setTransaction } from "@/app/lib/session";

/**
 * Start the OAuth flow. This has to be a full browser navigation, not a fetch —
 * the user has to land on Google's own consent screen.
 */
export async function GET() {
  const state = randomString();
  const nonce = randomString();
  const verifier = randomString(48);

  await setTransaction({ state, nonce, verifier });

  return NextResponse.redirect(
    authorizationUrl({ state, nonce, challenge: await pkceChallenge(verifier) }),
  );
}
