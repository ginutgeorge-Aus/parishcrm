import { renderToStaticMarkup } from "react-dom/server"

jest.mock("next/navigation", () => ({
  redirect: jest.fn((to: string) => { throw new Error(`NEXT_REDIRECT ${to}`) }),
}))
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({ prisma: { eventManager: { findMany: jest.fn() } } }))
jest.mock("@/lib/featureFlags")

import MyEventsPage from "@/app/(organiser)/my-events/page"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getEnabledFeatures } from "@/lib/featureFlags"
import { resolveFeatures } from "@/lib/features"

const withFeatures = (o: Record<string, boolean>) =>
  (getEnabledFeatures as jest.Mock).mockResolvedValue(resolveFeatures(o))

beforeEach(() => {
  jest.clearAllMocks()
  ;(auth as jest.Mock).mockResolvedValue({ user: { id: "5", role: "EVENT_ORGANISER" } })
  ;(prisma.eventManager.findMany as jest.Mock).mockResolvedValue([])
})

// A client navigation back to /my-events keeps the layout mounted, so the
// page must apply the Events fallback itself.
it("sends the organiser to their classes while Events is off and Sunday School is on", async () => {
  withFeatures({ events: false, sundaySchool: true })
  await expect(MyEventsPage()).rejects.toThrow("NEXT_REDIRECT /my-classes")
  expect(prisma.eventManager.findMany).not.toHaveBeenCalled()
})

it("shows the notice, not assigned events, while Events and Sunday School are both off", async () => {
  withFeatures({ events: false, sundaySchool: false })
  const html = renderToStaticMarkup(await MyEventsPage())
  expect(html).toContain("Nothing to manage right now")
  expect(prisma.eventManager.findMany).not.toHaveBeenCalled()
})

it("lists assigned events while Events is on", async () => {
  withFeatures({ events: true })
  const html = renderToStaticMarkup(await MyEventsPage())
  expect(html).toContain("My Events")
})
