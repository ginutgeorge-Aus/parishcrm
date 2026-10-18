/** @jest-environment node */
// The send-reminders and send-celebrations cron routes: skip (200) while their
// feature is off, otherwise hand off to the sweep and return its result.
jest.mock("@/lib/featureFlags")
jest.mock("@/lib/reminderSweep", () => ({ sendDueReminders: jest.fn() }))
jest.mock("@/lib/celebrationSweep", () => ({ sendDueCelebrations: jest.fn() }))

import { NextRequest } from "next/server"
import { POST as reminders } from "@/app/api/cron/send-reminders/route"
import { POST as celebrations } from "@/app/api/cron/send-celebrations/route"
import { cronFeatureSkip } from "@/lib/featureFlags"
import { sendDueReminders } from "@/lib/reminderSweep"
import { sendDueCelebrations } from "@/lib/celebrationSweep"

const req = () => new NextRequest("http://localhost/api/cron/x", { method: "POST", headers: { authorization: "Bearer t" } })

const ROUTES = [
  ["send-reminders", reminders, sendDueReminders, "events"],
  ["send-celebrations", celebrations, sendDueCelebrations, "celebrations"],
] as const

beforeEach(() => jest.clearAllMocks())

it.each(ROUTES)("%s skips while its feature is off", async (_name, POST, sweep, key) => {
  ;(cronFeatureSkip as jest.Mock).mockResolvedValueOnce(Response.json({ skipped: "feature off" }))
  const res = await POST(req())
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ skipped: "feature off" })
  expect(cronFeatureSkip).toHaveBeenCalledWith("Bearer t", key)
  expect(sweep).not.toHaveBeenCalled()
})

it.each(ROUTES)("%s runs the sweep while its feature is on", async (_name, POST, sweep) => {
  ;(sweep as jest.Mock).mockResolvedValue({ status: 200, body: { sent: 2 } })
  const res = await POST(req())
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ sent: 2 })
  expect(sweep).toHaveBeenCalledWith("Bearer t", expect.any(Date))
})
