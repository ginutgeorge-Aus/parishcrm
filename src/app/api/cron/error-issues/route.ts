import { NextResponse } from "next/server"
import { bearerOk } from "@/lib/cronAuth"
import { runErrorDigestLocked } from "@/lib/errorDigest"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error("[error-issues] CRON_SECRET unset — prod-error issue filing is DISABLED")
    return NextResponse.json({ error: "CRON_SECRET unset: disabled" }, { status: 503 })
  }
  if (!bearerOk(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  // Same lock as the in-app scheduler (no overlapping runs → no duplicate
  // issues), but `force` so a manual trigger still runs after this week's digest.
  const result = await runErrorDigestLocked(new Date(), { force: true })
  if (!result) return NextResponse.json({ error: "Another digest run is in progress" }, { status: 409 })
  return NextResponse.json(result)
}
