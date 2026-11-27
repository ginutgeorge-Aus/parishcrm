/** @jest-environment node */

jest.mock("@/lib/featureFlags")
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    accountOpeningBalance: {
      upsert: jest.fn(),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    // Client-supplied FK existence check, ahead of the upsert.
    paymentAccount: {
      findUnique: jest.fn().mockResolvedValue({ id: 1 }),
    },
    appSetting: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(),
    },
    // Advisory lock (holdAccountingLock) runs on tx.
    $queryRaw: jest.fn().mockResolvedValue([]),
    // Interactive transactions run their callback against the same mocks (the tx client mirrors prisma).
    $transaction: jest.fn(),
  },
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined), logAuditTx: jest.fn().mockResolvedValue(undefined) }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { logAuditTx } from "@/lib/audit"
import { AUDIT_FAILED_ERROR } from "@/lib/auditGuard"
import { upsertOpeningBalance, setAccountingLockDate } from "@/lib/actions/accountingSettings"

const mockAuth = auth as jest.Mock
const mockUpsert = prisma.accountOpeningBalance.upsert as jest.Mock
const mockAppSettingUpsert = prisma.appSetting.upsert as jest.Mock
const mockRevalidate = revalidatePath as jest.Mock
const mockLogAudit = logAuditTx as jest.Mock

function fd(fields: Record<string, string>) {
  const f = new FormData()
  Object.entries(fields).forEach(([k, v]) => f.set(k, v))
  return f
}

const validInput = {
  paymentAccountId: "1",
  amount: "5000.00",
  asOfDate: "2026-01-01",
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(prisma.$transaction as jest.Mock).mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma))
})

describe("upsertOpeningBalance", () => {
  it("blocks unauthenticated", async () => {
    mockAuth.mockResolvedValue(null)
    const result = await upsertOpeningBalance(undefined, fd(validInput))
    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it("blocks PASTOR (non-ADMIN)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    const result = await upsertOpeningBalance(undefined, fd(validInput))
    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it("rejects a non-numeric paymentAccountId", async () => {
    mockAuth.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const result = await upsertOpeningBalance(undefined, fd({ ...validInput, paymentAccountId: "INVALID" }))
    expect(result).toEqual({ error: expect.any(String) })
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it("accepts a negative amount (overdrawn account)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const result = await upsertOpeningBalance(undefined, fd({ ...validInput, amount: "-100" }))
    expect(result).toEqual({ success: "Saved" })
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ amount: "-100" }) }))
  })

  it("rejects an amount with more than 8 integer digits", async () => {
    mockAuth.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const result = await upsertOpeningBalance(undefined, fd({ ...validInput, amount: "123456789.00" }))
    expect(result).toEqual({ error: expect.any(String) })
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it("blocks a date on or before the lock date", async () => {
    mockAuth.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    ;(prisma.appSetting.findUnique as jest.Mock).mockResolvedValueOnce({ value: "2026-01-01" })
    const result = await upsertOpeningBalance(undefined, fd(validInput))
    expect(result).toEqual({ error: expect.stringContaining("locked period") })
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it("rejects missing asOfDate", async () => {
    mockAuth.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const result = await upsertOpeningBalance(undefined, fd({ ...validInput, asOfDate: "" }))
    expect(result).toEqual({ error: "As-of date is required" })
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it("rejects an impossible as-of date instead of normalising it", async () => {
    mockAuth.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const result = await upsertOpeningBalance(undefined, fd({ ...validInput, asOfDate: "2024-02-31" }))
    expect(result).toEqual({ error: "As-of date must be a valid YYYY-MM-DD date" })
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it("upserts and returns success for valid ADMIN input", async () => {
    mockAuth.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockUpsert.mockResolvedValue({})
    const result = await upsertOpeningBalance(undefined, fd(validInput))
    expect(result).toEqual({ success: "Saved" })
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { paymentAccountId: 1 },
        create: expect.objectContaining({ paymentAccountId: 1, amount: "5000.00" }),
        update: expect.objectContaining({ amount: "5000.00" }),
      })
    )
    expect(mockRevalidate).toHaveBeenCalledWith("/")
    expect(mockRevalidate).toHaveBeenCalledWith("/accounting/settings")
  })

  it("passes the amount to the Decimal column as a string, not a float", async () => {
    mockAuth.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockUpsert.mockResolvedValue({})
    await upsertOpeningBalance(undefined, fd({ ...validInput, amount: "100.10" }))
    const arg = mockUpsert.mock.calls[0][0]
    expect(arg.create.amount).toBe("100.10")
    expect(typeof arg.create.amount).toBe("string")
  })

  it("rejects an amount with more than 2 decimal places", async () => {
    mockAuth.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const result = await upsertOpeningBalance(undefined, fd({ ...validInput, amount: "100.123" }))
    expect(result).toEqual({ error: "Amount must be a dollar amount with up to 2 decimals" })
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it("returns AUDIT_FAILED_ERROR when the in-transaction audit write fails", async () => {
    mockAuth.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockUpsert.mockResolvedValue({})
    mockLogAudit.mockRejectedValueOnce(new Error("audit down"))
    expect(await upsertOpeningBalance(undefined, fd(validInput))).toEqual({ error: AUDIT_FAILED_ERROR })
    expect(mockRevalidate).not.toHaveBeenCalled()
  })

  it("returns error on DB failure", async () => {
    mockAuth.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockUpsert.mockRejectedValue(new Error("DB error"))
    const result = await upsertOpeningBalance(undefined, fd(validInput))
    expect(result).toEqual({ error: "Failed to save" })
  })
})

describe("setAccountingLockDate", () => {
  it.each([
    ["rejects a non-admin", "PASTOR", "2026-06-30", "Unauthorized"],
    ["rejects a malformed date", "ADMIN", "30-06-2026", "Date must be a valid YYYY-MM-DD date"],
    ["rejects an impossible calendar date instead of normalising it", "ADMIN", "2024-02-31", "Date must be a valid YYYY-MM-DD date"],
  ])("%s", async (_name, role, date, error) => {
    mockAuth.mockResolvedValue({ user: { role, id: "1" } })
    const result = await setAccountingLockDate(undefined, fd({ date }))
    expect(result).toEqual({ error })
    expect(mockAppSettingUpsert).not.toHaveBeenCalled()
  })

  it("sets the lock date and audits it", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockAppSettingUpsert.mockResolvedValue({})
    const result = await setAccountingLockDate(undefined, fd({ date: "2026-06-30" }))
    expect(result).toEqual({ success: "Saved" })
    expect(mockAppSettingUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "accountingLockDate" },
        create: { key: "accountingLockDate", value: "2026-06-30" },
        update: { value: "2026-06-30" },
      })
    )
    expect(mockLogAudit).toHaveBeenCalledWith(prisma, 1, "ACCOUNTING_LOCK_DATE_SET", "AppSetting", undefined, {
      lockDate: "2026-06-30",
    })
  })

  it("AUD-3-01: takes the exclusive accounting-lock advisory lock before writing the setting", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    const order: string[] = []
    ;(prisma.$queryRaw as jest.Mock).mockImplementationOnce(async (strings: TemplateStringsArray) => {
      order.push(strings.join(""))
      return []
    })
    mockAppSettingUpsert.mockImplementationOnce(async () => {
      order.push("upsert")
      return {}
    })
    await setAccountingLockDate(undefined, fd({ date: "2026-06-30" }))
    expect(order).toHaveLength(2)
    expect(order[0]).toMatch(/pg_advisory_xact_lock\(/)
    expect(order[1]).toBe("upsert")
  })

  it("returns AUDIT_FAILED_ERROR when the in-transaction audit write fails", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockAppSettingUpsert.mockResolvedValue({})
    mockLogAudit.mockRejectedValueOnce(new Error("audit down"))
    expect(await setAccountingLockDate(undefined, fd({ date: "2026-06-30" }))).toEqual({ error: AUDIT_FAILED_ERROR })
  })

  it("clears the lock date with an empty string", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockAppSettingUpsert.mockResolvedValue({})
    const result = await setAccountingLockDate(undefined, fd({ date: "" }))
    expect(result).toEqual({ success: "Saved" })
    expect(mockLogAudit).toHaveBeenCalledWith(prisma, 1, "ACCOUNTING_LOCK_DATE_SET", "AppSetting", undefined, {
      lockDate: null,
    })
  })
})
