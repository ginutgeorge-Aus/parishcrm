import { NextResponse } from "next/server"
import { bearerOk } from "@/lib/cronAuth"
import { DigestStageError, runErrorDigestLocked } from "@/lib/errorDigest"

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
  let result: Awaited<ReturnType<typeof runErrorDigestLocked>>
  try {
    result = await runErrorDigestLocked(new Date(), { force: true })
  } catch (e) {
    const stage = e instanceof DigestStageError ? e.stage : "unknown"
    const cause = e instanceof DigestStageError ? e.cause : e
    // console.error, not logger.error: logger persists to ErrorLog, which the digest reads.
    console.error(`[error-issues] digest failed at stage=${stage}: ${cause instanceof Error ? cause.message : "unknown"}`)
    // list/create fail talking to GitHub (bad gateway); purge or an unknown stage is a local failure.
    const upstream = stage === "list" || stage === "create"
    return NextResponse.json({ error: "digest failed", stage }, { status: upstream ? 502 : 500 })
  }
  if (result === "locked") return NextResponse.json({ error: "Another digest run is in progress" }, { status: 409 })
  return NextResponse.json(result)
}
