import { NextRequest, NextResponse } from "next/server"
import { sendDueCelebrations } from "@/lib/celebrationSweep"

export async function POST(req: NextRequest) {
  const { status, body } = await sendDueCelebrations(req.headers.get("authorization"), new Date())
  return NextResponse.json(body, { status })
}
