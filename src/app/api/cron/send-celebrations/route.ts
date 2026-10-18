import { NextRequest, NextResponse } from "next/server"
import { sendDueCelebrations } from "@/lib/celebrationSweep"
import { cronFeatureSkip } from "@/lib/featureFlags"

export async function POST(req: NextRequest) {
  const off = await cronFeatureSkip(req.headers.get("authorization"), "celebrations")
  if (off) return off
  const { status, body } = await sendDueCelebrations(req.headers.get("authorization"), new Date())
  return NextResponse.json(body, { status })
}
