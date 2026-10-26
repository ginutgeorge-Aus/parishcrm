/** @jest-environment node */
import VenueCalendarPage, { metadata } from "../page"
import { prisma } from "@/lib/prisma"
import { rateLimit } from "@/lib/rateLimit"
import { readVenueUsageSettings } from "@/lib/venueUsageSettings"
import { notFound } from "next/navigation"
import { readCalendarToken } from "@/lib/venueCalendarToken"

jest.mock("next/navigation", () => ({ notFound: jest.fn() }))
jest.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "9.9.9.9" }),
}))
jest.mock("@/lib/prisma", () => ({ prisma: { venueUsage: { findMany: jest.fn() } } }))
jest.mock("@/lib/rateLimit", () => ({ rateLimit: jest.fn() }))
jest.mock("@/lib/venueUsageSettings", () => ({ readVenueUsageSettings: jest.fn() }))
jest.mock("@/lib/venueCalendarToken", () => ({
  ...jest.requireActual("@/lib/venueCalendarToken"),
  readCalendarToken: jest.fn(),
}))
jest.mock("@/lib/dates", () => ({ ...jest.requireActual("@/lib/dates"), sydneyTodayYMD: () => "2026-10-25" }))
jest.mock("@/components/venue-usage/VenueCalendarView", () => ({ VenueCalendarView: () => null }))

/** Props passed to the (stubbed) view by the rendered page element. */
const propsOf = (el: unknown) => (el as { props: { month: string; entries: { date: string }[] } }).props

/** Render the page with a token and optional month. */
const run = async (token: string, month?: string) =>
  VenueCalendarPage({ params: Promise.resolve({ token }), searchParams: Promise.resolve({ month }) })

beforeEach(() => {
  jest.resetAllMocks()
  ;(notFound as unknown as jest.Mock).mockImplementation(() => {
    throw new Error("NEXT_NOT_FOUND")
  })
  ;(rateLimit as jest.Mock).mockReturnValue(true)
  ;(readVenueUsageSettings as jest.Mock).mockResolvedValue({ enabled: true, venueName: "Example Hall" })
  ;(readCalendarToken as jest.Mock).mockResolvedValue("good-token")
  ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue([])
})

it("is not indexable and sends no referrer", () => {
  expect(metadata.robots).toEqual({ index: false, follow: false })
  expect(metadata.referrer).toBe("no-referrer")
})
it("404s an unknown token without touching the database", async () => {
  await expect(run("bad-token")).rejects.toThrow("NEXT_NOT_FOUND")
  expect(prisma.venueUsage.findMany).not.toHaveBeenCalled()
})
it("404s when the feature is off or no token is set (indistinguishable)", async () => {
  ;(readVenueUsageSettings as jest.Mock).mockResolvedValue({ enabled: false, venueName: "X" })
  await expect(run("good-token")).rejects.toThrow("NEXT_NOT_FOUND")
  ;(readVenueUsageSettings as jest.Mock).mockResolvedValue({ enabled: true, venueName: "X" })
  ;(readCalendarToken as jest.Mock).mockResolvedValue(null)
  await expect(run("good-token")).rejects.toThrow("NEXT_NOT_FOUND")
})
it("a reset token invalidates the old link", async () => {
  ;(readCalendarToken as jest.Mock).mockResolvedValue("new-token")
  await expect(run("good-token")).rejects.toThrow("NEXT_NOT_FOUND")
  await expect(run("new-token")).resolves.toBeTruthy()
})
it("queries only public fields and never notes", async () => {
  await run("good-token", "2026-11")
  const arg = (prisma.venueUsage.findMany as jest.Mock).mock.calls[0][0]
  expect(Object.keys(arg.select).sort()).toEqual(["date", "endTime", "id", "purpose", "startTime", "status"])
  expect(arg.where.status).toEqual({ in: ["REQUESTED", "CONFIRMED"] })
  expect(arg.take).toBe(200)
  expect(JSON.stringify(arg)).not.toContain("notes")
})
it("clamps the month and maps dates to YYYY-MM-DD", async () => {
  ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue([
    { id: 1, date: new Date("2026-11-01T00:00:00Z"), startTime: "17:00", endTime: "20:00", purpose: "Service", status: "CONFIRMED" },
  ])
  const el = await run("good-token", "2019-01")
  expect(propsOf(el).month).toBe("2025-10")
  const el2 = await run("good-token", "2026-11")
  expect(propsOf(el2).entries[0].date).toBe("2026-11-01")
})
it("rate-limits by IP before any lookup", async () => {
  ;(rateLimit as jest.Mock).mockReturnValue(false)
  const el = await run("good-token")
  expect(rateLimit).toHaveBeenCalledWith("venueCal:9.9.9.9", 60, 60_000)
  expect(readCalendarToken).not.toHaveBeenCalled()
  expect(JSON.stringify(el)).toContain("Too many requests")
})
