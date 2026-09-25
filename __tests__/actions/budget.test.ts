/** @jest-environment node */
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    budget: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    account: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  },
}))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { upsertBudgets, getPrevYearBudgets, saveBudgetVarianceNote } from "@/lib/actions/budget"

const mockSession = auth as jest.Mock
const mockUpsert = prisma.budget.upsert as jest.Mock
const mockFindMany = prisma.budget.findMany as jest.Mock
const mockUpdateMany = prisma.budget.updateMany as jest.Mock
const mockAccountFindMany = prisma.account.findMany as jest.Mock
const mockTransaction = prisma.$transaction as jest.Mock
const mockRevalidate = revalidatePath as jest.Mock

function makeFormData(fields: Record<string, string>) {
  const fd = new FormData()
  Object.entries(fields).forEach(([k, v]) => fd.set(k, v))
  return fd
}

beforeEach(() => jest.clearAllMocks())

describe("upsertBudgets", () => {
  it("blocks PASTOR", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    const result = await upsertBudgets(undefined, makeFormData({ year: "2026" }))
    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it("blocks unauthenticated", async () => {
    mockSession.mockResolvedValue(null)
    const result = await upsertBudgets(undefined, makeFormData({ year: "2026" }))
    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it("returns error for non-numeric year", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const result = await upsertBudgets(undefined, makeFormData({ year: "abc" }))
    expect(result).toEqual({ error: "Invalid year" })
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it("skips blank entries and upserts non-blank ones", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    // accountIds 1 and 3 must exist for the FK check
    mockAccountFindMany.mockResolvedValue([{ id: 1 }, { id: 3 }])
    mockUpsert.mockResolvedValue({})

    const fd = makeFormData({
      year: "2026",
      amount_1: "12000.00",
      amount_2: "",
      amount_3: "9600",
    })

    const result = await upsertBudgets(undefined, fd)

    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockUpsert).toHaveBeenCalledTimes(2)
    // Amount is passed to the Decimal column as the validated string, not
    // parseFloat'd — avoids IEEE-754 round-trip (matches).
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { year_accountId: { year: 2026, accountId: 1 } },
      update: { amount: "12000.00" },
      create: { year: 2026, accountId: 1, amount: "12000.00" },
    })
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { year_accountId: { year: 2026, accountId: 3 } },
      update: { amount: "9600" },
      create: { year: 2026, accountId: 3, amount: "9600" },
    })
    expect(result).toEqual({ success: "Budget saved" })
    expect(mockRevalidate).toHaveBeenCalledWith("/accounting/budget")
  })

  it("returns success and skips upsert when all entries blank", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const fd = makeFormData({ year: "2026", amount_1: "", amount_2: "" })
    const result = await upsertBudgets(undefined, fd)
    expect(mockUpsert).not.toHaveBeenCalled()
    expect(result).toEqual({ success: "Budget saved" })
  })

  it("rejects a negative amount", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockAccountFindMany.mockResolvedValue([{ id: 5 }])
    const result = await upsertBudgets(undefined, makeFormData({ year: "2026", amount_5: "-10" }))
    expect(result).toEqual({ error: "Budget amounts must be between 0 and 99,999,999.99" })
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it("rejects an amount over the max", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockAccountFindMany.mockResolvedValue([{ id: 5 }])
    const result = await upsertBudgets(undefined, makeFormData({ year: "2026", amount_5: "100000000" }))
    expect(result).toEqual({ error: "Budget amounts must be between 0 and 99,999,999.99" })
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it("rejects an amount with more than 2 decimal places", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const result = await upsertBudgets(undefined, makeFormData({ year: "2026", amount_5: "100.999" }))
    expect(result).toEqual({ error: "Budget amounts must have at most 2 decimal places" })
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it("rejects an unknown accountId", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockAccountFindMany.mockResolvedValue([]) // account 5 does not exist
    const result = await upsertBudgets(undefined, makeFormData({ year: "2026", amount_5: "100" }))
    expect(result).toEqual({ error: "One or more accounts are inactive or no longer exist" })
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it("filters the account existence check to active accounts only", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockAccountFindMany.mockResolvedValue([{ id: 5 }])
    mockUpsert.mockResolvedValue({})
    await upsertBudgets(undefined, makeFormData({ year: "2026", amount_5: "100" }))
    expect(mockAccountFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [5] }, isActive: true } })
    )
  })

  it("rejects a budget on a deactivated account (findMany skips it)", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockAccountFindMany.mockResolvedValue([]) // account 5 exists but is inactive → filtered out
    const result = await upsertBudgets(undefined, makeFormData({ year: "2026", amount_5: "100" }))
    expect(result).toEqual({ error: "One or more accounts are inactive or no longer exist" })
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it("rejects more than MAX_BUDGET_ENTRIES entries", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const fields: Record<string, string> = { year: "2026" }
    for (let i = 1; i <= 501; i++) fields[`amount_${i}`] = "100"
    const result = await upsertBudgets(undefined, makeFormData(fields))
    expect(result).toEqual({ error: "Too many budget entries" })
    expect(mockAccountFindMany).not.toHaveBeenCalled()
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  // an accountId parsed from a form key past the PG int4 max used to
  // reach Prisma unchecked and overflow with an unhandled 500. It's skipped
  // the same way an unparseable (NaN) key already was.
  it("skips an accountId form key past the PG int4 max instead of reaching Prisma", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockAccountFindMany.mockResolvedValue([{ id: 5 }])
    mockUpsert.mockResolvedValue({})
    const result = await upsertBudgets(
      undefined,
      makeFormData({ year: "2026", amount_5: "100", amount_2147483648: "200" })
    )
    expect(mockAccountFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: [5] }, isActive: true } }))
    expect(mockUpsert).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ success: "Budget saved" })
  })

  it("commits all valid upserts in a single $transaction", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockAccountFindMany.mockResolvedValue([{ id: 5 }, { id: 6 }])
    mockUpsert.mockResolvedValue({}) // resolved promise so $transaction(Promise.all) settles
    const result = await upsertBudgets(undefined, makeFormData({ year: "2026", amount_5: "100", amount_6: "200" }))
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockUpsert).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ success: "Budget saved" })
  })
})

describe("saveBudgetVarianceNote", () => {
  it("blocks read-only accounting roles (AUDITOR)", async () => {
    mockSession.mockResolvedValue({ user: { id: "9", role: "AUDITOR" } })
    const result = await saveBudgetVarianceNote(2026, 5, "over on utilities")
    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it("blocks OFFICE_ADMIN (read-only accounting)", async () => {
    mockSession.mockResolvedValue({ user: { id: "9", role: "OFFICE_ADMIN" } })
    const result = await saveBudgetVarianceNote(2026, 5, "note")
    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it("allows PASTOR to save a note", async () => {
    mockSession.mockResolvedValue({ user: { id: "9", role: "PASTOR" } })
    mockUpdateMany.mockResolvedValue({ count: 1 })
    const result = await saveBudgetVarianceNote(2026, 5, "  seasonal spike  ")
    // Note is trimmed before write.
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { year: 2026, accountId: 5 },
      data: { note: "seasonal spike" },
    })
    expect(result).toEqual({ success: "Note saved" })
    expect(mockRevalidate).toHaveBeenCalledWith("/accounting/reports/budget-vs-actual")
  })

  it("clears the note when passed blank (null, not empty string)", async () => {
    mockSession.mockResolvedValue({ user: { id: "9", role: "ADMIN" } })
    mockUpdateMany.mockResolvedValue({ count: 1 })
    await saveBudgetVarianceNote(2026, 5, "   ")
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { year: 2026, accountId: 5 },
      data: { note: null },
    })
  })

  it("rejects an invalid year", async () => {
    mockSession.mockResolvedValue({ user: { id: "9", role: "ADMIN" } })
    const result = await saveBudgetVarianceNote(1999, 5, "note")
    expect(result).toEqual({ error: "Invalid year" })
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it("rejects an invalid accountId", async () => {
    mockSession.mockResolvedValue({ user: { id: "9", role: "ADMIN" } })
    const result = await saveBudgetVarianceNote(2026, 0, "note")
    expect(result).toEqual({ error: "Invalid account" })
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it("rejects an accountId past the PG int4 max", async () => {
    mockSession.mockResolvedValue({ user: { id: "9", role: "ADMIN" } })
    const result = await saveBudgetVarianceNote(2026, 2147483648, "note")
    expect(result).toEqual({ error: "Invalid account" })
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it("rejects a note over the length cap", async () => {
    mockSession.mockResolvedValue({ user: { id: "9", role: "ADMIN" } })
    const result = await saveBudgetVarianceNote(2026, 5, "x".repeat(1001))
    expect(result).toEqual({ error: "Note must be 1000 characters or fewer" })
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it("errors when no budget row exists for the line (count 0)", async () => {
    mockSession.mockResolvedValue({ user: { id: "9", role: "ADMIN" } })
    mockUpdateMany.mockResolvedValue({ count: 0 })
    const result = await saveBudgetVarianceNote(2026, 5, "note")
    expect(result).toEqual({ error: "No budget set for this line" })
    expect(mockRevalidate).not.toHaveBeenCalled()
  })
})

describe("getPrevYearBudgets", () => {
  it("returns empty array for non-admin", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    const result = await getPrevYearBudgets(2026)
    expect(result).toEqual([])
    expect(mockFindMany).not.toHaveBeenCalled()
  })

  it("returns empty array when unauthenticated", async () => {
    mockSession.mockResolvedValue(null)
    const result = await getPrevYearBudgets(2026)
    expect(result).toEqual([])
    expect(mockFindMany).not.toHaveBeenCalled()
  })

  it("queries year-1 and maps amounts to strings", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindMany.mockResolvedValue([
      { accountId: 1, amount: { toString: () => "12000.00" } },
      { accountId: 3, amount: { toString: () => "9600.00" } },
    ])

    const result = await getPrevYearBudgets(2026)

    expect(mockFindMany).toHaveBeenCalledWith({
      where: { year: 2025 },
      select: { accountId: true, amount: true },
    })
    expect(result).toEqual([
      { accountId: 1, amount: "12000.00" },
      { accountId: 3, amount: "9600.00" },
    ])
  })

  it("returns empty array when no prev year budgets", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindMany.mockResolvedValue([])
    const result = await getPrevYearBudgets(2026)
    expect(result).toEqual([])
  })
})
