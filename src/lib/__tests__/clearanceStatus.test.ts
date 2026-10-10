/** @jest-environment node */
import { clearanceStatus, daysUntilExpiry } from "@/lib/clearanceStatus"

const TODAY = new Date("2026-10-06T00:00:00.000Z")
const d = (s: string) => new Date(`${s}T00:00:00.000Z`)

describe("daysUntilExpiry", () => {
  it("is null with no expiry date", () => {
    expect(daysUntilExpiry(null, TODAY)).toBeNull()
  })
  it("is 0 on the expiry date, positive before, negative after", () => {
    expect(daysUntilExpiry(d("2026-10-06"), TODAY)).toBe(0)
    expect(daysUntilExpiry(d("2026-10-16"), TODAY)).toBe(10)
    expect(daysUntilExpiry(d("2026-10-05"), TODAY)).toBe(-1)
  })
})

describe("clearanceStatus", () => {
  const verifiedAt = new Date("2026-09-01T00:00:00Z")
  it("treats expiry == today as still valid (EXPIRING, not EXPIRED)", () => {
    expect(clearanceStatus({ verifiedAt, expiresAt: d("2026-10-06") }, TODAY)).toBe("EXPIRING")
    expect(clearanceStatus({ verifiedAt, expiresAt: d("2026-10-05") }, TODAY)).toBe("EXPIRED")
  })
  it("gives UNVERIFIED precedence over EXPIRING and never expires without a date", () => {
    expect(clearanceStatus({ verifiedAt: null, expiresAt: d("2026-10-20") }, TODAY)).toBe("UNVERIFIED")
    expect(clearanceStatus({ verifiedAt, expiresAt: null }, TODAY)).toBe("VERIFIED")
    expect(clearanceStatus(null, TODAY)).toBe("MISSING")
  })
})
