import { clearanceStatus, EXPIRING_WINDOW_DAYS, CLEARANCE_TYPE_LABELS } from "@/lib/clearanceStatus"

// "today" is the Sydney calendar date anchored at UTC midnight (sydneyToday()).
const TODAY = new Date("2026-10-06T00:00:00.000Z")
const day = (offset: number) => new Date(TODAY.getTime() + offset * 86_400_000)
const verified = new Date("2026-09-01T03:00:00.000Z")

describe("clearanceStatus", () => {
  it("is 60 days", () => expect(EXPIRING_WINDOW_DAYS).toBe(60))
  it("MISSING when there is no clearance", () => expect(clearanceStatus(null, TODAY)).toBe("MISSING"))
  it("EXPIRED when expiry is before today", () =>
    expect(clearanceStatus({ verifiedAt: verified, expiresAt: day(-1) }, TODAY)).toBe("EXPIRED"))
  it("EXPIRED beats UNVERIFIED", () =>
    expect(clearanceStatus({ verifiedAt: null, expiresAt: day(-30) }, TODAY)).toBe("EXPIRED"))
  it("expiry today is still valid -> EXPIRING", () =>
    expect(clearanceStatus({ verifiedAt: verified, expiresAt: day(0) }, TODAY)).toBe("EXPIRING"))
  it("EXPIRING at exactly 60 days", () =>
    expect(clearanceStatus({ verifiedAt: verified, expiresAt: day(60) }, TODAY)).toBe("EXPIRING"))
  it("UNVERIFIED beats EXPIRING (Expiring means verified but lapsing)", () =>
    expect(clearanceStatus({ verifiedAt: null, expiresAt: day(10) }, TODAY)).toBe("UNVERIFIED"))
  it("VERIFIED at 61 days out", () =>
    expect(clearanceStatus({ verifiedAt: verified, expiresAt: day(61) }, TODAY)).toBe("VERIFIED"))
  it("UNVERIFIED when valid but not verified", () =>
    expect(clearanceStatus({ verifiedAt: null, expiresAt: day(200) }, TODAY)).toBe("UNVERIFIED"))
  it("no expiry: UNVERIFIED / VERIFIED by verification only", () => {
    expect(clearanceStatus({ verifiedAt: null, expiresAt: null }, TODAY)).toBe("UNVERIFIED")
    expect(clearanceStatus({ verifiedAt: verified, expiresAt: null }, TODAY)).toBe("VERIFIED")
  })
  it("has labels for both types", () => {
    expect(CLEARANCE_TYPE_LABELS.WWCC).toBeTruthy()
    expect(CLEARANCE_TYPE_LABELS.SAFE_MINISTRY).toBeTruthy()
  })
})
