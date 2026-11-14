import { NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";

/** The signed-in user, or 401. The page calls this on mount. */
export async function GET() {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  return NextResponse.json(user);
}
