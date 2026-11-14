import { NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import { getLumaSession } from "@/app/lib/luma-session";
import { getEventParticipants, LumaError } from "@/app/lib/luma";
import { YouApiError } from "@/app/lib/you";

/**
 * Up to ~50 s: a you.com page fetch has a 30 s crawl timeout plus headroom.
 * Explicit so hosts with a shorter default (Vercel) don't cut it off. 60 s is
 * allowed on every Vercel plan.
 */
export const maxDuration = 60;

/**
 * Body: `{ "url": "https://luma.com/<event>" }`. Returns `EventParticipants`.
 *
 * Signed-in users only: every new event costs a metered you.com call. If the
 * user connected their Luma login, the response is the full guest list they
 * can see (`source: "guest-list"`) instead of the public featured guests.
 */
export async function POST(request: Request) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    url?: unknown;
  } | null;
  if (typeof body?.url !== "string" || !body.url.trim()) {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }

  try {
    const luma = await getLumaSession(user.sub);
    return NextResponse.json(await getEventParticipants(body.url, luma));
  } catch (err) {
    if (err instanceof LumaError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      );
    }
    console.error("Luma participants lookup failed:", err);
    const message =
      err instanceof YouApiError && err.status === 429
        ? "you.com rate limit hit. Try again in a minute."
        : "Couldn't fetch that event. Try again.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
