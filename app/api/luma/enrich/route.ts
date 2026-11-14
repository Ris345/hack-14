import { NextResponse } from "next/server";
import { getLumaSession } from "@/app/lib/luma-session";
import { getEventParticipants, LumaError } from "@/app/lib/luma";
import { enrichParticipant, enrichParticipants } from "@/app/lib/enrich";
import { YouApiError } from "@/app/lib/you";
import type { EnrichedParticipant, EventParticipants } from "@/app/lib/types";

/**
 * One person: a LinkedIn search plus three page fetches (20 s crawl each, in
 * parallel) — well under a minute. Explicit so hosts with a shorter default
 * (Vercel) don't cut it off. The whole-event mode can exceed this for big
 * events; the UI enriches per person.
 */
export const maxDuration = 60;

export type EnrichedEvent = Omit<EventParticipants, "participants"> & {
  participants: EnrichedParticipant[];
};

/**
 * Body: `{ "url": "https://luma.com/<event>", "personId"?: "usr-…" }`.
 *
 * - With `personId`: returns `Enrichment` for that one participant. The UI
 *   calls it once per person so each card fills in as soon as it's ready.
 * - Without: returns `EnrichedEvent`, every participant enriched (slow — up to
 *   a search plus three page fetches per person, four people at a time).
 *
 * Takes the event URL rather than names or links so the people being looked
 * up are ones we fetched ourselves — a client-supplied list would let anyone
 * spend our you.com budget on arbitrary searches and pages. The participant
 * fetch is cached, so the only new cost here is the enrichment itself.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    url?: unknown;
    personId?: unknown;
  } | null;
  if (typeof body?.url !== "string" || !body.url.trim()) {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }
  if (body.personId !== undefined && typeof body.personId !== "string") {
    return NextResponse.json(
      { error: "personId must be a string" },
      { status: 400 },
    );
  }

  try {
    // Same view as the lookup, so people from the full guest list are found.
    // (Cached, so this costs nothing after the lookup itself.)
    const event = await getEventParticipants(
      body.url,
      await getLumaSession(),
    );

    if (body.personId !== undefined) {
      const person = event.participants.find((p) => p.id === body.personId);
      if (!person) {
        return NextResponse.json(
          { error: "No such participant on that event" },
          { status: 404 },
        );
      }
      return NextResponse.json(await enrichParticipant(person));
    }

    return NextResponse.json({
      ...event,
      participants: await enrichParticipants(event.participants),
    } satisfies EnrichedEvent);
  } catch (err) {
    if (err instanceof LumaError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      );
    }
    console.error("Enrichment failed:", err);
    const message =
      err instanceof YouApiError && err.status === 429
        ? "you.com rate limit hit. Try again in a minute."
        : "Couldn't enrich that event. Try again.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
