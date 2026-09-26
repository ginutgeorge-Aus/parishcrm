import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { canViewAccounting } from "@/lib/roleGuard"
import { rateLimit } from "@/lib/rateLimit"

/**
 * Shared entry guard for accounting report CSV exports: 401 unauthenticated,
 * 403 without accounting view, 429 past 10 exports/min per actor under
 * `export:<key>`. Returns the error response, or the actor id for logAudit.
 */
export async function guardAccountingExport(key: string): Promise<NextResponse | { actor: number }> {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canViewAccounting(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const actor = actorId(session)
  if (!rateLimit(`export:${key}:${actor}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }
  return { actor }
}
