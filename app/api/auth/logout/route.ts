import { NextResponse } from "next/server";
import { clearSession } from "@/app/lib/session";
import { clearLumaSession } from "@/app/lib/luma-session";

/**
 * POST only, so a prefetch or an <img> tag can't sign the user out. Also
 * forgets their Luma login: it's bound to this user and useless after.
 */
export async function POST() {
  await clearSession();
  await clearLumaSession();
  return new NextResponse(null, { status: 204 });
}
