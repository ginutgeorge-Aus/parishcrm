import { NextRequest, NextResponse } from "next/server"
import { sweepExpiredCheckouts } from "@/lib/checkoutSweep"
import { bearerOk } from "@/lib/cronAuth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    // Loud, not silent: an unset secret means abandoned-checkout PII is never
    // purged. Surface it to App Insights (console.error) and fail the cron run
    // (5xx) so the misconfiguration is visible rather than a green no-op.
    console.error("[sweep-checkouts] CRON_SECRET unset — abandoned-checkout PII sweep is DISABLED")
    return NextResponse.json({ error: "CRON_SECRET unset: sweep disabled" }, { status: 503 })
  }
  if (!bearerOk(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { expired } = await sweepExpiredCheckouts()
  return NextResponse.json({ expired })
}
