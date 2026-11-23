jest.mock("server-only", () => ({}))
jest.mock("@/auth", () => ({ auth: jest.fn(async () => ({ user: { id: "1", role: "ADMIN" } })) }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/demoMode", () => ({ assertNotDemo: () => null }))
jest.mock("@/lib/featureFlags", () => ({ featureGuard: async () => null }))
jest.mock("@/lib/accountingLock", () => ({ ACCOUNTING_LOCK_DATE_KEY: "accountingLockDate", holdAccountingLock: jest.fn() }))
jest.mock("@/lib/auditGuard", () => ({ logAuditGuardedTx: jest.fn(), auditTxErrorResult: jest.fn(() => null) }))
const upsert = jest.fn()
jest.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: async (fn: (tx: unknown) => Promise<void>) => fn({ appSetting: { upsert } }),
  },
}))

import { setAccountingLockDate } from "../accountingSettings"
import { sydneyTodayYMD } from "@/lib/dates"

const form = (date: string) => {
  const fd = new FormData()
  fd.set("date", date)
  return fd
}

beforeEach(() => upsert.mockClear())

describe("setAccountingLockDate future-date guard", () => {
  it("rejects a lock date after today in Sydney", async () => {
    const res = await setAccountingLockDate(undefined, form("2999-01-01"))
    expect(res).toEqual({ error: "Lock date cannot be in the future" })
    expect(upsert).not.toHaveBeenCalled()
  })

  it("accepts today (Sydney) and clearing the lock", async () => {
    expect(await setAccountingLockDate(undefined, form(sydneyTodayYMD()))).toEqual({ success: "Saved" })
    expect(await setAccountingLockDate(undefined, form(""))).toEqual({ success: "Saved" })
    expect(upsert).toHaveBeenCalledTimes(2)
  })

  it("accepts a past date", async () => {
    expect(await setAccountingLockDate(undefined, form("2020-06-30"))).toEqual({ success: "Saved" })
  })
})
