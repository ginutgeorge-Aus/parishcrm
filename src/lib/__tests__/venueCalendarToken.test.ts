/** @jest-environment node */
jest.mock("server-only", () => ({}))
jest.mock("@/lib/prisma", () => ({ prisma: { appSetting: { findUnique: jest.fn() } } }))

import { prisma } from "@/lib/prisma"
import { calendarUrl, mintCalendarToken, readCalendarToken, tokenMatches } from "@/lib/venueCalendarToken"

it("mints distinct URL-safe tokens of at least 192 bits", () => {
  const a = mintCalendarToken(), b = mintCalendarToken()
  expect(a).not.toBe(b)
  expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/)
})
it("tokenMatches is exact, case-sensitive and false for empty or different-length input", () => {
  const t = mintCalendarToken()
  expect(tokenMatches(t, t)).toBe(true)
  expect(tokenMatches(t.toUpperCase(), t)).toBe(false)
  expect(tokenMatches("", t)).toBe(false)
  expect(tokenMatches(t, "")).toBe(false)
  expect(tokenMatches(t + "x", t)).toBe(false)
})
it("readCalendarToken returns the stored value or null", async () => {
  ;(prisma.appSetting.findUnique as jest.Mock).mockResolvedValueOnce({ value: "abc" })
  expect(await readCalendarToken()).toBe("abc")
  expect(prisma.appSetting.findUnique).toHaveBeenCalledWith({ where: { key: "venueUsage.calendarToken" } })
  ;(prisma.appSetting.findUnique as jest.Mock).mockResolvedValueOnce(null)
  expect(await readCalendarToken()).toBeNull()
  ;(prisma.appSetting.findUnique as jest.Mock).mockResolvedValueOnce({ value: "" })
  expect(await readCalendarToken()).toBeNull()
})
it("calendarUrl joins AUTH_URL and the token, null on a bad base", () => {
  process.env.AUTH_URL = "https://app.example.com"
  expect(calendarUrl("tok")).toBe("https://app.example.com/venue/tok")
  process.env.AUTH_URL = "not a url"
  expect(calendarUrl("tok")).toBeNull()
})
