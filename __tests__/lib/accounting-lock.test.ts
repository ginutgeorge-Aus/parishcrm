// __tests__/lib/accounting-lock.test.ts
/** @jest-environment node */

jest.mock("@/lib/prisma", () => ({
  prisma: { appSetting: { findUnique: jest.fn() } },
}))

import { isDateLocked, getAccountingLockDate, assertUnlocked } from "@/lib/accountingLock"
import { prisma } from "@/lib/prisma"

const mockFind = prisma.appSetting.findUnique as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe("isDateLocked", () => {
  const lock = new Date("2026-06-30")
  it("returns false when lock is null", () => {
    expect(isDateLocked(new Date("2020-01-01"), null)).toBe(false)
  })
  it("locks a date before the lock date", () => {
    expect(isDateLocked(new Date("2026-06-29"), lock)).toBe(true)
  })
  it("locks a date exactly on the lock date (inclusive)", () => {
    expect(isDateLocked(new Date("2026-06-30"), lock)).toBe(true)
  })
  it("does not lock a date after the lock date", () => {
    expect(isDateLocked(new Date("2026-07-01"), lock)).toBe(false)
  })
  it("locks a date on the lock date with a non-zero time component", () => {
    // A transaction stored at 2026-06-30T13:45 UTC must still be locked — the
    // raw-timestamp compare used to let it slip past.
    expect(isDateLocked(new Date("2026-06-30T13:45:00.000Z"), lock)).toBe(true)
  })
  it("does not lock the day after the lock date with a time component", () => {
    expect(isDateLocked(new Date("2026-07-01T13:45:00.000Z"), lock)).toBe(false)
  })
})

describe("getAccountingLockDate", () => {
  it("returns null when the setting is absent", async () => {
    mockFind.mockResolvedValue(null)
    expect(await getAccountingLockDate()).toBeNull()
  })
  it("returns null when the value is empty", async () => {
    mockFind.mockResolvedValue({ key: "accountingLockDate", value: "" })
    expect(await getAccountingLockDate()).toBeNull()
  })
  it("parses YYYY-MM-DD to UTC midnight", async () => {
    mockFind.mockResolvedValue({ key: "accountingLockDate", value: "2026-06-30" })
    expect(await getAccountingLockDate()).toEqual(new Date("2026-06-30"))
  })
})

describe("assertUnlocked", () => {
  it("returns an error string for a locked date", async () => {
    mockFind.mockResolvedValue({ key: "accountingLockDate", value: "2026-06-30" })
    expect(await assertUnlocked(new Date("2026-06-15"))).toBe(
      "This date is in a locked accounting period (on or before 2026-06-30)."
    )
  })
  it("returns null for an unlocked date", async () => {
    mockFind.mockResolvedValue({ key: "accountingLockDate", value: "2026-06-30" })
    expect(await assertUnlocked(new Date("2026-07-15"))).toBeNull()
  })
  it("returns null when no lock is set", async () => {
    mockFind.mockResolvedValue(null)
    expect(await assertUnlocked(new Date("2020-01-01"))).toBeNull()
  })
})
