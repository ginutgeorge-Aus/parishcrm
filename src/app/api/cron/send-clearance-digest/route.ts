import { NextResponse } from "next/server"
import { bearerOk } from "@/lib/cronAuth"
import { runClearanceDigestLocked } from "@/lib/clearanceDigest"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Manual / external trigger for the monthly clearance digest (the in-app
 * scheduler normally runs it on the 1st). Bearer-authed with CRON_SECRET.
 * Shares the scheduler's lease so runs never overlap, but `force` lets an
 * operator re-send after this month's digest already went out.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error("[send-clearance-digest] CRON_SECRET unset — clearance digest endpoint is DISABLED")
    return NextResponse.json({ error: "CRON_SECRET unset: disabled" }, { status: 503 })
  }
  if (!bearerOk(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const result = await runClearanceDigestLocked(new Date(), { force: true })
  if (result === "locked") return NextResponse.json({ error: "Another digest run is in progress" }, { status: 409 })
  return NextResponse.json(result)
}
