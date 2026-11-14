import { NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import { getEventParticipants, LumaError } from "@/app/lib/luma";
import { enrichParticipant } from "@/app/lib/enrich";

/**
 * Body: `{ "url": "https://luma.com/<event>", "personId": "usr-…" }`.
 * Returns `Enrichment` for that participant.
 *
 * The client names a person, not URLs: the server looks them up in the
 * (cached) event data and only fetches the links Luma lists for them. So this
 * route can't be used to make us fetch arbitrary pages on someone's dime.
 */
export async function POST(request: Request) {
  if (!(await getSession())) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    url?: unknown;
    personId?: unknown;
  } | null;
  if (typeof body?.url !== "string" || typeof body.personId !== "string") {
    return NextResponse.json(
      { error: "Expected { url, personId }" },
      { status: 400 },
    );
  }

  try {
    const { participants } = await getEventParticipants(body.url);
    const person = participants.find((p) => p.id === body.personId);
    if (!person) {
      return NextResponse.json(
        { error: "No such participant on that event" },
        { status: 404 },
      );
    }
    return NextResponse.json(await enrichParticipant(person));
  } catch (err) {
    if (err instanceof LumaError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Enrichment failed:", err);
    return NextResponse.json({ error: "Enrichment failed" }, { status: 502 });
  }
}
