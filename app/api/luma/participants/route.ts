import { NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import { getEventParticipants, LumaError } from "@/app/lib/luma";
import { YouApiError } from "@/app/lib/you";

/**
 * Body: `{ "url": "https://luma.com/<event>" }`. Returns `EventParticipants`.
 *
 * Signed-in users only: every new event costs a metered you.com call.
 */
export async function POST(request: Request) {
  if (!(await getSession())) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    url?: unknown;
  } | null;
  if (typeof body?.url !== "string" || !body.url.trim()) {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }

  try {
    return NextResponse.json(await getEventParticipants(body.url));
  } catch (err) {
    if (err instanceof LumaError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Luma participants lookup failed:", err);
    const message =
      err instanceof YouApiError && err.status === 429
        ? "you.com rate limit hit. Try again in a minute."
        : "Couldn't fetch that event. Try again.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
