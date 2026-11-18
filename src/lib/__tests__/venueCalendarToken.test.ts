/** @jest-environment node */
jest.mock("server-only", () => ({}))
jest.mock("@/lib/prisma", () => ({ prisma: { appSetting: { findUnique: jest.fn() } } }))

import { prisma } from "@/lib/prisma"
import { calendarUrl, mintCalendarToken, readCalendarToken } from "@/lib/venueCalendarToken"
import { hashToken, storedTokenMatches } from "@/lib/tokenHash"

it("mints distinct URL-safe tokens of at least 192 bits", () => {
  const a = mintCalendarToken(), b = mintCalendarToken()
  expect(a).not.toBe(b)
  expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/)
})
it("a minted token matches its stored digest exactly: case-sensitive, false for empty or different-length input", () => {
  const t = mintCalendarToken()
  const stored = hashToken(t)
  expect(storedTokenMatches(t, stored)).toBe(true)
  expect(storedTokenMatches(t.toUpperCase(), stored)).toBe(false)
  expect(storedTokenMatches("", stored)).toBe(false)
  expect(storedTokenMatches(t, "")).toBe(false)
  expect(storedTokenMatches(t + "x", stored)).toBe(false)
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
