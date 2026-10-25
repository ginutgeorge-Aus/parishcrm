/** @jest-environment node */
import VenueUsagePage from "../page"
import { auth } from "@/auth"
import { readCalendarToken } from "@/lib/venueCalendarToken"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => {
    throw new Error("REDIRECT")
  }),
}))
jest.mock("@/lib/venueUsageSettings", () => ({
  readVenueUsageSettings: jest.fn().mockResolvedValue({ enabled: true, venueName: "Example Hall" }),
}))
jest.mock("@/lib/venueCalendarToken", () => ({
  readCalendarToken: jest.fn(),
  calendarUrl: jest.fn((t: string) => `https://app.example.com/venue/${t}`),
}))
jest.mock("@/lib/prisma", () => ({ prisma: { venueUsage: { findMany: jest.fn().mockResolvedValue([]) } } }))
jest.mock("@/components/venue-usage/VenueUsageClient", () => ({ VenueUsageClient: () => null }))

beforeEach(() => jest.clearAllMocks())

/** Render the page element and return the props it passes to the client component. */
async function clientProps(role: string) {
  ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role } })
  const el = await VenueUsagePage({ searchParams: Promise.resolve({}) })
  const client = (el.props.children as { props: Record<string, unknown> }[]).find((c) => c?.props && "calendarUrl" in c.props)
  return client!.props
}

it("passes the calendar URL to an editor, and reset only to an ADMIN", async () => {
  ;(readCalendarToken as jest.Mock).mockResolvedValue("tok")
  const pastor = await clientProps("PASTOR")
  expect(pastor.calendarUrl).toBe("https://app.example.com/venue/tok")
  expect(pastor.canResetCalendar).toBe(false)
  const admin = await clientProps("ADMIN")
  expect(admin.canResetCalendar).toBe(true)
})
it("passes null when no token exists", async () => {
  ;(readCalendarToken as jest.Mock).mockResolvedValue(null)
  expect((await clientProps("ADMIN")).calendarUrl).toBeNull()
})
it("redirects a non-editor before reading the token", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { id: "3", role: "VIEWER" } })
  await expect(VenueUsagePage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT")
  expect(readCalendarToken).not.toHaveBeenCalled()
})
