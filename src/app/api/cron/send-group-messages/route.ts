import { NextResponse } from "next/server"
import { bearerOk } from "@/lib/cronAuth"
import { runGroupMessageSweep } from "@/lib/groupMessageDeliver"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * External trigger for the group-email retry sweep, for deployments that run
 * with IN_APP_CRON=false (the in-app scheduler runs the same job every tick).
 * Bearer-authed with CRON_SECRET. Safe to call often: delivery claims are atomic.
 * @param req authenticated POST request
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error("[send-group-messages] CRON_SECRET unset — group email retry endpoint is DISABLED")
    return NextResponse.json({ error: "CRON_SECRET unset: disabled" }, { status: 503 })
  }
  if (!bearerOk(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return NextResponse.json(await runGroupMessageSweep(new Date()))
}
