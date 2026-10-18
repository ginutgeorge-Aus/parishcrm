import { NextRequest, NextResponse } from "next/server"
import { sendDueReminders } from "@/lib/reminderSweep"
import { cronFeatureSkip } from "@/lib/featureFlags"

export async function POST(req: NextRequest) {
  const off = await cronFeatureSkip(req.headers.get("authorization"), "events")
  if (off) return off
  const { status, body } = await sendDueReminders(req.headers.get("authorization"), new Date())
  return NextResponse.json(body, { status })
}
