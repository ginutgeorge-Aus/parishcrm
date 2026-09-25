/** @jest-environment node */

// buildTransactionWhere is pure, but the module imports the prisma singleton at
// load — stub it so no engine boots for these no-DB assertions.
jest.mock("@/lib/prisma", () => ({ prisma: {} }))

import { buildTransactionWhere } from "@/lib/reports/transactionsQuery"

// Freeze to a fixed mid-FY date so the FY-default 'from' assertion is stable
// across the 1 July FY boundary.
beforeEach(() => jest.useFakeTimers({ now: new Date("2026-06-01T00:00:00Z") }))
afterEach(() => jest.useRealTimers())

describe("buildTransactionWhere — fund filter", () => {
  it("fund='none' → fundId: null (unassigned only)", () => {
    const { where } = buildTransactionWhere({ fund: "none" })
    expect(where).toHaveProperty("fundId", null)
  })

  it("fund=<valid id> → fundId: <number>", () => {
    const { where } = buildTransactionWhere({ fund: "12" })
    expect(where).toHaveProperty("fundId", 12)
  })

  it("fund=<invalid id> (0/NaN) → no fundId key (filter dropped)", () => {
    expect(buildTransactionWhere({ fund: "0" }).where).not.toHaveProperty("fundId")
    expect(buildTransactionWhere({ fund: "abc" }).where).not.toHaveProperty("fundId")
  })

  it("no fund param → no fundId key", () => {
    expect(buildTransactionWhere({}).where).not.toHaveProperty("fundId")
  })
})

describe("buildTransactionWhere — malformed id filters", () => {
  it("a numeric-prefixed garbage account id ('12abc') is dropped, not truncated to 12", () => {
    // Prisma treats an explicit `undefined` value the same as an absent key
    // (filter not applied) — the bug under test is the truncation to 12, not
    // key presence, so assert on the resolved value rather than `in`.
    expect(buildTransactionWhere({ account: "12abc" }).where.accountId).toBeUndefined()
  })

  it("a numeric-prefixed garbage family id ('5xyz') is dropped, not truncated to 5", () => {
    expect(buildTransactionWhere({ family: "5xyz" }).where.familyId).toBeUndefined()
  })

  it("a valid account id still passes through", () => {
    expect(buildTransactionWhere({ account: "12" }).where).toHaveProperty("accountId", 12)
  })
})

describe("buildTransactionWhere — type allow-list + paymentAccount shape", () => {
  it("drops an invalid type rather than passing it to Prisma", () => {
    const { where, type } = buildTransactionWhere({ type: "BOGUS" })
    expect(type).toBeUndefined()
    expect(where).not.toHaveProperty("type")
  })

  it("keeps a valid type value", () => {
    const { type } = buildTransactionWhere({ type: "EXPENSE" })
    expect(type).toBe("EXPENSE")
  })

  // paymentAccount is now a numeric PaymentAccount.id (FK, not an enum) — this
  // pure fn only validates shape (positive int); the caller confirms the id
  // actually exists against its DB-fetched account list.
  it("drops a non-numeric paymentAccount id rather than passing it to Prisma", () => {
    const { where, paymentAccountId } = buildTransactionWhere({ paymentAccount: "HACK" })
    expect(paymentAccountId).toBeUndefined()
    expect(where).not.toHaveProperty("paymentAccountId")
  })

  it("keeps a valid positive-int paymentAccount id", () => {
    const { paymentAccountId } = buildTransactionWhere({ paymentAccount: "3" })
    expect(paymentAccountId).toBe(3)
  })
})

describe("buildTransactionWhere — default FY range", () => {
  it("defaults 'from' to 1 July of the current FY when no date param", () => {
    const { where } = buildTransactionWhere({})
    // 2026-06-01 is in FY 2025 (Jul 2025 – Jun 2026).
    expect(where.date.gte).toEqual(new Date("2025-07-01"))
    expect(where.date).not.toHaveProperty("lte")
  })

  // without an upper bound, a future/next-FY-dated row (e.g. a
  // backdated or mis-keyed entry) silently folds into the current FY's
  // income/expense/net tiles. Half-open range mirrors plQuery/budgetVsActualQuery.
  // Cast to a loose shape — the real return type is a discriminated union over
  // whether `lt`/`lte` is present, which TS can't narrow from a runtime check.
  it("caps the default upper bound at the end of the current FY", () => {
    const { where } = buildTransactionWhere({})
    const date = where.date as { gte: Date; lt?: Date; lte?: Date }
    expect(date.lt).toEqual(new Date("2026-07-01"))
    expect(where.date).not.toHaveProperty("lte")
  })

  it("an explicit 'to' still works and overrides the default cap", () => {
    const { where } = buildTransactionWhere({ to: "2026-08-15" })
    const date = where.date as { gte: Date; lt?: Date; lte?: Date }
    expect(date.lte).toEqual(new Date("2026-08-15T23:59:59.999Z"))
    expect(where.date).not.toHaveProperty("lt")
  })

  it("an explicit 'from' with no 'to' still caps the default upper bound", () => {
    const { where } = buildTransactionWhere({ from: "2020-01-01" })
    const date = where.date as { gte: Date; lt?: Date; lte?: Date }
    expect(date.gte).toEqual(new Date("2020-01-01"))
    expect(date.lt).toEqual(new Date("2026-07-01"))
  })

  it("an invalid 'to' falls back to the default cap rather than being unbounded", () => {
    const { where } = buildTransactionWhere({ to: "not-a-date" })
    const date = where.date as { gte: Date; lt?: Date; lte?: Date }
    expect(date.lt).toEqual(new Date("2026-07-01"))
    expect(where.date).not.toHaveProperty("lte")
  })

  // 2024-02-31 has no day 31 in February — JS `new Date()` silently
  // rolls it forward to 2024-03-02 instead of rejecting it. Treat it as
  // invalid, same as any other unparseable date.
  it("a calendar-invalid 'to' (2024-02-31) falls back to the default cap, not a rolled-forward date", () => {
    const { where } = buildTransactionWhere({ to: "2024-02-31" })
    const date = where.date as { gte: Date; lt?: Date; lte?: Date }
    expect(date.lt).toEqual(new Date("2026-07-01"))
    expect(where.date).not.toHaveProperty("lte")
  })

  it("a calendar-invalid 'from' (2024-02-31) falls back to the FY default, not a rolled-forward date", () => {
    const { where } = buildTransactionWhere({ from: "2024-02-31" })
    const date = where.date as { gte: Date; lt?: Date; lte?: Date }
    expect(date.gte).toEqual(new Date("2025-07-01"))
  })
})
