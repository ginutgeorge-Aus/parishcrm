import { receiptMirrorData, receiptCreateData, assertSessionOpenTx, SessionClosedError } from "../pettyCashEntry"

jest.mock("@/lib/crypto", () => ({ encrypt: jest.fn((v: string) => `enc:${v}`) }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))

// the in-tx recheck is now a conditional updateMany (a real row-level
// write lock), not a plain findUnique read — findUnique only remains as the
// failure-path lookup that picks "Session not found" vs the closed message.
function makeTx(status: "OPEN" | "CLOSED" | null) {
  return {
    pettyCashSession: {
      updateMany: jest.fn(async () => ({ count: status === "OPEN" ? 1 : 0 })),
      findUnique: jest.fn(async () => (status === null ? null : { id: 1 })),
    },
  }
}
function txWith(status: "OPEN" | "CLOSED" | null) {
  return makeTx(status) as never
}

describe("assertSessionOpenTx ( in-tx close re-check, lock pattern)", () => {
  test("resolves for an OPEN session", async () => {
    await expect(assertSessionOpenTx(txWith("OPEN"), 1)).resolves.toBeUndefined()
  })

  test("throws SessionClosedError with default message for a CLOSED session", async () => {
    await expect(assertSessionOpenTx(txWith("CLOSED"), 1)).rejects.toThrow(SessionClosedError)
    await expect(assertSessionOpenTx(txWith("CLOSED"), 1)).rejects.toThrow("Session is closed")
  })

  test("throws the caller-supplied edit-path message when CLOSED", async () => {
    await expect(assertSessionOpenTx(txWith("CLOSED"), 1, "Cannot edit in closed session")).rejects.toThrow(
      "Cannot edit in closed session"
    )
  })

  test("throws SessionClosedError('Session not found') when the row is gone", async () => {
    await expect(assertSessionOpenTx(txWith(null), 1)).rejects.toThrow(SessionClosedError)
    await expect(assertSessionOpenTx(txWith(null), 1)).rejects.toThrow("Session not found")
  })

  test("re-asserts via a conditional updateMany (row-level lock), not a plain read", async () => {
    const raw = makeTx("OPEN")
    await assertSessionOpenTx(raw as never, 7)
    expect(raw.pettyCashSession.updateMany).toHaveBeenCalledWith({
      where: { id: 7, status: "OPEN" },
      data: { status: "OPEN" },
    })
  })
})

test("receiptCreateData carries fundId", () => {
  const d = receiptCreateData({ sessionId: 1, date: new Date("2026-07-01"), accountId: 2, amount: "10.00", fundId: 9 })
  expect(d.fundId).toBe(9)
})

test("receiptMirrorData carries fundId onto the mirror transaction", () => {
  const d = receiptMirrorData({ id: 5, date: new Date("2026-07-01"), amount: "10.00", accountId: 2, fundId: 9 }, "Offering", "01-JUL-2026")
  expect(d.fundId).toBe(9)
})

test("receiptMirrorData links a donor family as giving so it reaches the Giving Summary", () => {
  const d = receiptMirrorData(
    { id: 5, date: new Date("2026-07-01"), amount: "10.00", accountId: 2, fundId: null },
    "Offering", "01-JUL-2026",
    { personId: 7, familyId: 3 },
  )
  expect(d.familyId).toBe(3)
  expect(d.personId).toBe(7)
  expect(d.isGiving).toBe(true)
})

test("receiptMirrorData with no donor is not giving (unfamilied cash-in)", () => {
  const d = receiptMirrorData(
    { id: 5, date: new Date("2026-07-01"), amount: "10.00", accountId: 2, fundId: null },
    "Sales", "01-JUL-2026",
    { personId: null, familyId: null },
  )
  expect(d.familyId).toBeNull()
  expect(d.personId).toBeNull()
  expect(d.isGiving).toBe(false)
})
