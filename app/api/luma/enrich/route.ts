import { NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import { getEventParticipants, LumaError } from "@/app/lib/luma";
import { enrichParticipants } from "@/app/lib/enrich";
import { YouApiError } from "@/app/lib/you";
import type { EnrichedParticipant, EventParticipants } from "@/app/lib/types";

export type EnrichedEvent = Omit<EventParticipants, "participants"> & {
  participants: EnrichedParticipant[];
};

/**
 * Body: `{ "url": "https://luma.com/<event>" }`. Returns `EnrichedEvent`.
 *
 * Takes the event URL rather than a participant list so the names being looked
 * up are ones we fetched ourselves — a client-supplied list would let anyone
 * spend our you.com budget on arbitrary searches. The participant fetch is
 * cached, so the only new cost here is the per-person enrichment.
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
    const event = await getEventParticipants(body.url);
    return NextResponse.json({
      ...event,
      participants: await enrichParticipants(event.participants),
    } satisfies EnrichedEvent);
  } catch (err) {
    if (err instanceof LumaError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Enrichment failed:", err);
    const message =
      err instanceof YouApiError && err.status === 429
        ? "you.com rate limit hit. Try again in a minute."
        : "Couldn't enrich that event. Try again.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
