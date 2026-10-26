/** @jest-environment node */
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({ prisma: { appSetting: { upsert: jest.fn() } } }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/demoMode", () => ({ assertNotDemo: jest.fn(() => null) }))
jest.mock("@/lib/venueUsageSettings", () => ({ readVenueUsageSettings: jest.fn() }))
jest.mock("@/lib/venueCalendarToken", () => ({
  mintCalendarToken: () => "NEWTOKEN",
  calendarUrl: (t: string) => "https://app.example.com/venue/" + t,
}))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { assertNotDemo } from "@/lib/demoMode"
import { readVenueUsageSettings } from "@/lib/venueUsageSettings"
import { resetVenueCalendarLink } from "@/lib/actions/venueCalendar"

const asRole = (role: string | null) =>
  (auth as jest.Mock).mockResolvedValue(role ? { user: { id: "7", role } } : null)

beforeEach(() => {
  jest.clearAllMocks()
  ;(readVenueUsageSettings as jest.Mock).mockResolvedValue({ enabled: true })
})

it("is ADMIN only", async () => {
  for (const role of ["PASTOR", "OFFICE_ADMIN", "VIEWER", null]) {
    asRole(role); expect(await resetVenueCalendarLink()).toEqual({ error: "Unauthorized" })
  }
  expect(prisma.appSetting.upsert).not.toHaveBeenCalled()
})
it("is blocked in demo mode and when the feature is off", async () => {
  asRole("ADMIN"); (assertNotDemo as jest.Mock).mockReturnValueOnce({ error: "Not available in demo mode" })
  expect(await resetVenueCalendarLink()).toEqual({ error: "Not available in demo mode" })
  ;(readVenueUsageSettings as jest.Mock).mockResolvedValue({ enabled: false })
  expect(await resetVenueCalendarLink()).toEqual({ error: "Venue usage is not enabled" })
})
it("writes a fresh token over any old one, audits without the token, returns the URL", async () => {
  asRole("ADMIN")
  expect(await resetVenueCalendarLink()).toEqual({ success: "Calendar link reset", url: "https://app.example.com/venue/NEWTOKEN" })
  expect(prisma.appSetting.upsert).toHaveBeenCalledWith({
    where: { key: "venueUsage.calendarToken" },
    create: { key: "venueUsage.calendarToken", value: "NEWTOKEN" },
    update: { value: "NEWTOKEN" },
  })
  expect(logAudit).toHaveBeenCalledWith(7, "VENUE_CALENDAR_LINK_RESET", "AppSetting", undefined, {})
  expect(JSON.stringify((logAudit as jest.Mock).mock.calls)).not.toContain("NEWTOKEN")
})
