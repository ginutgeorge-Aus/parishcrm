import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { canEdit } from "@/lib/roleGuard"
import { featureNotFound } from "@/lib/featureFlags"
import { exportEventCsv } from "@/lib/eventCsvExport"

/**
 * Registrations CSV for one event addressed by slug (see `exportEventCsv`). 404 while Events is off.
 * @param req the incoming request
 * @param props route params
 */
export async function GET(req: NextRequest, props: { params: Promise<{ slug: string }> }) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  // Editors, or an assigned event organiser (per-event check is in exportEventCsv).
  if (!canEdit(session.user.role) && session.user.role !== "EVENT_ORGANISER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const off = await featureNotFound("events")
  if (off) return off
  const { slug } = await props.params
  return exportEventCsv(req, session, slug ? { slug } : null)
}
