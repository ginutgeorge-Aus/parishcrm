import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { schedulerHealth } from "@/lib/jobStatus"

// Liveness + readiness probe for the container host. Public (no auth) —
// excluded from the middleware matcher. Never leak DB error detail in the body.
export const dynamic = "force-dynamic"

/**
 * Liveness/readiness probe: 200 when the DB answers, 503 otherwise.
 * @returns JSON status (+ coarse scheduler state).
 */
export async function GET() {
  try {
    // Cheap readiness ping — no table, no business data. Constant SQL, no
    // interpolation, no user input — the one allowed raw query in the app.
    // nosemgrep: crm-no-raw-sql
    await prisma.$queryRaw`SELECT 1`
    // Body carries status only — version/db detail aids fingerprinting.
    // Version is visible to authenticated users in /settings.
    // `scheduler` is coarse (ok|stale|off|unknown) and never fails the probe: a restart
    // loop would not fix a stuck timer, but monitors can alert on "stale".
    return NextResponse.json({ status: "ok", scheduler: await schedulerHealth() }, { status: 200 })
  } catch {
    return NextResponse.json({ status: "error" }, { status: 503 })
  }
}
