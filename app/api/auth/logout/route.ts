import { NextResponse } from "next/server";
import { clearSession } from "@/app/lib/session";

/** POST only, so a prefetch or an <img> tag can't sign the user out. */
export async function POST() {
  await clearSession();
  return new NextResponse(null, { status: 204 });
}
