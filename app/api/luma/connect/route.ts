import { NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import {
  clearLumaSession,
  getLumaSession,
  storeLumaLogin,
} from "@/app/lib/luma-session";
import { LumaAuthError } from "@/app/lib/luma-api";
import type { LumaConnection } from "@/app/lib/types";

/**
 * Connect the user's Luma login so lookups can return full guest lists.
 *
 * - `GET`    → `LumaConnection`: whether a Luma login is stored, and whose.
 * - `POST`   `{ "cookie": "<luma.auth-session-key>" }` → checks it with Luma,
 *            then stores it encrypted (see `luma-session.ts`).
 * - `DELETE` → forgets it.
 *
 * The cookie value is never logged and never returned.
 */

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const luma = await getLumaSession(user.sub);
  const body: LumaConnection = luma
    ? { connected: true, name: luma.name }
    : { connected: false };
  return NextResponse.json(body);
}

export async function POST(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { cookie?: unknown } | null;
  const cookie = typeof body?.cookie === "string" ? cleanCookie(body.cookie) : "";
  if (!cookie) {
    return NextResponse.json(
      { error: "Paste the value of your luma.auth-session-key cookie." },
      { status: 400 },
    );
  }

  try {
    const { name } = await storeLumaLogin(user.sub, cookie);
    const res: LumaConnection = { connected: true, name };
    return NextResponse.json(res);
  } catch (err) {
    if (err instanceof LumaAuthError) {
      return NextResponse.json(
        { error: "Luma didn't accept that login. Copy the cookie again while signed in to luma.com." },
        { status: 400 },
      );
    }
    // Deliberately not logging `err` with request details: they'd carry the cookie.
    console.error("Luma connect failed:", err instanceof Error ? err.message : "unknown error");
    return NextResponse.json(
      { error: "Couldn't reach Luma. Try again." },
      { status: 502 },
    );
  }
}

export async function DELETE() {
  if (!(await getSession())) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  await clearLumaSession();
  return new NextResponse(null, { status: 204 });
}

/**
 * Accept what people actually paste: the bare value, `name=value`, a whole
 * `Cookie:` header, or the value wrapped in quotes.
 */
function cleanCookie(raw: string): string {
  let v = raw.trim().replace(/^cookie:\s*/i, "");
  const named = v.match(/(?:^|;\s*)luma\.auth-session-key=([^;]+)/);
  if (named) v = named[1];
  v = v.trim().replace(/^["']|["']$/g, "");
  // A cookie value has no whitespace, semicolons or commas.
  return /^[^\s;,]{10,4096}$/.test(v) ? v : "";
}
