/** @jest-environment node */
jest.mock("@/lib/crypto", () => ({ encrypt: jest.fn((v: string) => `enc:${v}`) }))
import { createReceiptEntry, createExpenseEntry } from "@/lib/actions/pettyCashEntry"

function mockTx() {
  return {
    pettyCashReceipt: { create: jest.fn().mockResolvedValue({ id: 1, date: new Date("2026-06-14"), amount: "20", accountId: 3 }) },
    pettyCashExpense: { create: jest.fn().mockResolvedValue({ id: 2, date: new Date("2026-06-14"), amount: "5", accountId: 4 }) },
    transaction: { create: jest.fn().mockResolvedValue({ id: 9 }) },
  } as any
}

it("persists importKey on the receipt when provided", async () => {
  const tx = mockTx()
  await createReceiptEntry(tx, {
    sessionId: 1, date: new Date("2026-06-14"), accountId: 3, accountName: "Cash",
    amount: "20", sessionTitle: "14-JUN-2026", importKey: "k1",
  })
  expect(tx.pettyCashReceipt.create).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ importKey: "k1" }) })
  )
})

it("persists importKey on the expense when provided", async () => {
  const tx = mockTx()
  await createExpenseEntry(tx, {
    sessionId: 1, date: new Date("2026-06-14"), accountId: 4, accountName: "Stationery",
    amount: "5", payee: "Officeworks", description: "pens", sessionTitle: "14-JUN-2026", importKey: "k2",
  })
  expect(tx.pettyCashExpense.create).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ importKey: "k2" }) })
  )
})

it("encrypts receipt notes at rest", async () => {
  const tx = mockTx()
  await createReceiptEntry(tx, {
    sessionId: 1, date: new Date("2026-06-14"), accountId: 3, accountName: "Cash",
    amount: "20", notes: "John Smith", sessionTitle: "14-JUN-2026",
  })
  expect(tx.pettyCashReceipt.create).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ notes: "enc:John Smith" }) })
  )
})

it("encrypts expense payee and description at rest", async () => {
  const tx = mockTx()
  await createExpenseEntry(tx, {
    sessionId: 1, date: new Date("2026-06-14"), accountId: 4, accountName: "Stationery",
    amount: "5", payee: "Officeworks", description: "pens", sessionTitle: "14-JUN-2026",
  })
  expect(tx.pettyCashExpense.create).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ payee: "enc:Officeworks", description: "enc:pens" }) })
  )
})

it("stores null receipt notes without encrypting", async () => {
  const tx = mockTx()
  await createReceiptEntry(tx, {
    sessionId: 1, date: new Date("2026-06-14"), accountId: 3, accountName: "Cash",
    amount: "20", notes: null, sessionTitle: "14-JUN-2026",
  })
  expect(tx.pettyCashReceipt.create).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ notes: null }) })
  )
})

it("defaults importKey to null when omitted (single-entry UI path)", async () => {
  const tx = mockTx()
  await createReceiptEntry(tx, {
    sessionId: 1, date: new Date("2026-06-14"), accountId: 3, accountName: "Cash",
    amount: "20", sessionTitle: "14-JUN-2026",
  })
  expect(tx.pettyCashReceipt.create).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ importKey: null }) })
  )
})
