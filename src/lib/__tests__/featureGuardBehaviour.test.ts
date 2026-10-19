/** @jest-environment node */
// Behaviour tests per enforcement kind (page layout, Server Action, public API
// route, scheduler job), against the real featureFlags module: only the stored
// `features` row and the work behind each guard are mocked.
jest.mock("server-only", () => ({}))
jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => { throw new Error("NEXT_NOT_FOUND") }),
  redirect: jest.fn(),
}))
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    appSetting: { findUnique: jest.fn() },
    event: { update: jest.fn(), findUnique: jest.fn() },
    eventImage: { findFirst: jest.fn() },
  },
}))
jest.mock("@/lib/reminderSweep", () => ({ runReminderSweep: jest.fn() }))
jest.mock("@/lib/celebrationSweep", () => ({ runCelebrationSweep: jest.fn() }))
jest.mock("@/lib/clearanceDigest", () => ({ runClearanceDigest: jest.fn() }))
jest.mock("@/lib/checkoutSweep", () => ({ sweepExpiredCheckouts: jest.fn() }))

import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import EventsLayout from "@/app/(dashboard)/events/layout"
import { publishEvent } from "@/lib/actions/event"
import { FEATURE_OFF_MESSAGE } from "@/lib/features"
import { NextRequest } from "next/server"
import { GET as eventImage } from "@/app/api/events/[slug]/image/[kind]/route"
import { DEFAULT_JOBS } from "@/lib/schedulerRunner"
import { runReminderSweep } from "@/lib/reminderSweep"

const findUnique = prisma.appSetting.findUnique as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  findUnique.mockResolvedValue({ key: "features", value: '{"events":false}' })
})

it("segment layout 404s while its feature is off", async () => {
  await expect(EventsLayout({ children: null })).rejects.toThrow("NEXT_NOT_FOUND")
})

it("segment layout renders children while its feature is on", async () => {
  findUnique.mockResolvedValue(null)
  await expect(EventsLayout({ children: "page" })).resolves.toBe("page")
})

it("Server Action returns the off message to an authorized caller, before DB work", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  expect(await publishEvent(1, true)).toEqual({ error: FEATURE_OFF_MESSAGE })
  expect(prisma.event.update).not.toHaveBeenCalled()
})

it("Server Action rejects an anonymous caller without reading feature state or showing the admin wording", async () => {
  ;(auth as jest.Mock).mockResolvedValue(null)
  const res = await publishEvent(1, true)
  expect(res).toEqual({ error: "Unauthorized" })
  expect(JSON.stringify(res)).not.toContain("Settings → Features")
  expect(findUnique).not.toHaveBeenCalled()
  expect(prisma.event.update).not.toHaveBeenCalled()
})

it("Server Action rejects an unauthorized role without reading feature state", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { id: "2", role: "VIEWER" } })
  expect(await publishEvent(1, true)).toEqual({ error: "Unauthorized" })
  expect(findUnique).not.toHaveBeenCalled()
})

it("public API route returns a JSON 404 without its DB lookup while the feature is off", async () => {
  const req = new NextRequest("http://localhost/api/events/gala/image/banner", { headers: { "x-forwarded-for": "10.55.0.1" } })
  const res = await eventImage(req, { params: Promise.resolve({ slug: "gala", kind: "banner" }) })
  expect(res.status).toBe(404)
  expect(await res.json()).toEqual({ error: "Not found" })
  expect(prisma.eventImage.findFirst).not.toHaveBeenCalled()
})

it("scheduler job skips its sweep while the feature is off", async () => {
  expect(await DEFAULT_JOBS.reminders(new Date("2026-10-18T00:00:00Z"))).toEqual({ skipped: "feature off" })
  expect(runReminderSweep).not.toHaveBeenCalled()
})
