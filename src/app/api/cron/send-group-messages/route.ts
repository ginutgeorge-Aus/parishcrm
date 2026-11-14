import { NextResponse } from "next/server"
import { bearerOk } from "@/lib/cronAuth"
import { runGroupMessageSweep } from "@/lib/groupMessageDeliver"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Manual/external trigger for the group-email retry sweep, for deployments with
 * `IN_APP_CRON=false` (the in-app scheduler runs the same sweep). Bearer-authed;
 * 503 when `CRON_SECRET` is unset. Returns numeric counts only, never an address.
 * @param req the incoming request
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error("[send-group-messages] CRON_SECRET unset — group email retry sweep is DISABLED")
    return NextResponse.json({ error: "CRON_SECRET unset: disabled" }, { status: 503 })
  }
  if (!bearerOk(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    return NextResponse.json(await runGroupMessageSweep(new Date()))
  } catch (err) {
    console.error(`[send-group-messages] sweep failed: ${err instanceof Error ? err.name : "error"}`)
    return NextResponse.json({ error: "Sweep failed" }, { status: 500 })
  }
}
