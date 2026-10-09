import { NextResponse } from "next/server"
import { bearerOk } from "@/lib/cronAuth"
import { runClearanceDigestLocked } from "@/lib/clearanceDigest"
import { sydneyMonthKey } from "@/lib/dates"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Manual / external trigger for the monthly clearance digest (the in-app
 * scheduler runs it on the 1st when CLEARANCE_DIGEST=true; this explicit call
 * needs no flag). Bearer-authed with CRON_SECRET. Shares the scheduler's lease
 * so runs never overlap. By default it respects the once-per-Sydney-month
 * guard: when this month's digest already went out it sends nothing and
 * returns 200 `{ status: "already-sent", month }`, so an external scheduler that
 * calls daily or retries cannot resend. `?force=1` resends deliberately.
 * @param req authenticated POST request
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
  const force = new URL(req.url).searchParams.get("force") === "1"
  const now = new Date()
  const result = await runClearanceDigestLocked(now, { force })
  if (result === "locked") return NextResponse.json({ error: "Another digest run is in progress" }, { status: 409 })
  if (result === "done") return NextResponse.json({ status: "already-sent", month: sydneyMonthKey(now) })
  return NextResponse.json(result)
}
