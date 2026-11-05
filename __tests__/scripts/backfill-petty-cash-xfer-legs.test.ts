/** @jest-environment node */
// #487 backfill: null paymentAccountId on XFER_OUT_ legs -> the single cash account.

import { backfillXferLegs, type XferLegDb } from "../../scripts/backfill-petty-cash-xfer-legs"

type Row = { bankRef: string | null; paymentAccountId: number | null }

/**
 * In-memory Transaction + PaymentAccount fake.
 *
 * @param rows - transaction rows
 * @param cashIds - ids of active CASH accounts
 */
function fakeDb(rows: Row[], cashIds: number[]) {
  const match = (r: Row) => !!r.bankRef?.startsWith("XFER_OUT_") && r.paymentAccountId === null
  const updateMany = jest.fn(async ({ data }: { data: { paymentAccountId: number } }) => {
    const hit = rows.filter(match)
    hit.forEach((r) => { r.paymentAccountId = data.paymentAccountId })
    return { count: hit.length }
  })
  const db: XferLegDb = {
    transaction: { count: async () => rows.filter(match).length, updateMany },
    paymentAccount: { findMany: async () => cashIds.map((id) => ({ id })) },
  }
  return { db, updateMany }
}

const seed = (): Row[] => [
  { bankRef: "XFER_OUT_ANZ_1", paymentAccountId: null },
  { bankRef: "XFER_OUT_ANZ_2", paymentAccountId: null },
  { bankRef: "XFER_OUT_ANZ_3", paymentAccountId: 5 },
  { bankRef: "ANZ_9", paymentAccountId: null },
  { bankRef: null, paymentAccountId: null },
]

beforeEach(() => { jest.spyOn(console, "log").mockImplementation(() => {}) })
afterEach(() => jest.restoreAllMocks())

describe("backfillXferLegs", () => {
  it("dry run reports the count and writes nothing", async () => {
    const rows = seed()
    const { db, updateMany } = fakeDb(rows, [7])
    expect(await backfillXferLegs(db, false)).toEqual({ found: 2, updated: 0 })
    expect(updateMany).not.toHaveBeenCalled()
    expect(rows[0].paymentAccountId).toBeNull()
  })

  it("apply sets only the null XFER_OUT_ legs to the cash account", async () => {
    const rows = seed()
    const { db } = fakeDb(rows, [7])
    expect(await backfillXferLegs(db, true)).toEqual({ found: 2, updated: 2 })
    expect(rows.map((r) => r.paymentAccountId)).toEqual([7, 7, 5, null, null])
  })

  it("is idempotent on re-run", async () => {
    const { db, updateMany } = fakeDb(seed(), [7])
    await backfillXferLegs(db, true)
    updateMany.mockClear()
    expect(await backfillXferLegs(db, true)).toEqual({ found: 0, updated: 0 })
    expect(updateMany).not.toHaveBeenCalled()
  })

  it.each([
    [[], "no-cash-account"],
    [[7, 8], "multiple-cash-accounts"],
  ] as const)("cash accounts %j -> no write (%s)", async (ids, skipped) => {
    const rows = seed()
    const { db, updateMany } = fakeDb(rows, [...ids])
    expect(await backfillXferLegs(db, true)).toEqual({ found: 2, updated: 0, skipped })
    expect(updateMany).not.toHaveBeenCalled()
  })
})
