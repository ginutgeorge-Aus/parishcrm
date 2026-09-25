import { NextRequest, NextResponse } from "next/server"
import { sendDueReminders } from "@/lib/reminderSweep"

export async function POST(req: NextRequest) {
  const { status, body } = await sendDueReminders(req.headers.get("authorization"), new Date())
  return NextResponse.json(body, { status })
}
