import { parseMembershipSettings, getMembershipSettings } from "@/lib/membershipSettings"
import { prisma } from "@/lib/prisma"

jest.mock("next/cache", () => ({ unstable_cache: (fn: (...a: unknown[]) => unknown) => fn }))
jest.mock("@/lib/prisma", () => ({ prisma: { appSetting: { findMany: jest.fn() } } }))
jest.mock("@/lib/logger", () => ({ logger: { error: jest.fn() } }))
const mockFindMany = prisma.appSetting.findMany as jest.Mock
const r = (key: string, value: string) => ({ key, value })

describe("parseMembershipSettings", () => {
  it("defaults to generic when unset", () => {
    expect(parseMembershipSettings([])).toEqual({ parishFields: false, minDues: null, homeAddressLabel: "", arrivalDateLabel: "" })
  })
  it("enables parish fields only on exact 'true'", () => {
    expect(parseMembershipSettings([r("membershipParishFields", "true")]).parishFields).toBe(true)
    expect(parseMembershipSettings([r("membershipParishFields", "TRUE")]).parishFields).toBe(false)
    expect(parseMembershipSettings([r("membershipParishFields", "1")]).parishFields).toBe(false)
  })
  it.each([["80", 80], [" 12.5 ", 12.5], ["0", 0], ["100000", 100000]])("parses min dues %s", (v, want) => {
    expect(parseMembershipSettings([r("membershipMinDues", v)]).minDues).toBe(want)
  })
  it("reads trimmed overseas-field labels (blank = hidden)", () => {
    const s = parseMembershipSettings([r("membershipHomeAddressLabel", " Address in India "), r("membershipArrivalDateLabel", "Date of arrival in Australia")])
    expect(s.homeAddressLabel).toBe("Address in India")
    expect(s.arrivalDateLabel).toBe("Date of arrival in Australia")
  })
  it.each(["", "  ", "-1", "abc", "100001", "Infinity", "NaN"])("treats %p as no minimum", (v) => {
    expect(parseMembershipSettings([r("membershipMinDues", v)]).minDues).toBeNull()
  })
})

describe("getMembershipSettings", () => {
  it("reads rows", async () => {
    mockFindMany.mockResolvedValue([r("membershipParishFields", "true"), r("membershipMinDues", "80")])
    await expect(getMembershipSettings()).resolves.toEqual({ parishFields: true, minDues: 80, homeAddressLabel: "", arrivalDateLabel: "" })
  })
  it("falls back to defaults on DB error", async () => {
    mockFindMany.mockRejectedValue(new Error("db down"))
    await expect(getMembershipSettings()).resolves.toEqual({ parishFields: false, minDues: null, homeAddressLabel: "", arrivalDateLabel: "" })
  })
})
