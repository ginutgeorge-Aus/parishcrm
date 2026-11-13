/** @jest-environment node */
import {
  countReassignSteps, planFundraiserReassign, reassignFundraiserEntriesTx, unlinkFundraiserEntriesTx,
} from "@/lib/fundraiserFamilyLink"
import { logAuditTx } from "@/lib/audit"
import { AuditWriteError } from "@/lib/auditGuard"
import type { Prisma } from "@/lib/generated/prisma/client"

jest.mock("@/lib/audit", () => ({ logAuditTx: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@/lib/logger", () => ({ logger: { error: jest.fn() } }))

type Row = { id: number; fundraiserId: number; familyId: number | null; quantity: number; unitPrice: string }

/**
 * Minimal transaction-client double for the helpers.
 * @param rows entries visible to the lock + findMany
 * @returns the tx and its mocks
 */
function makeTx(rows: Row[]) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue(rows.map((r) => ({ id: r.id }))),
    fundraiserEntry: {
      findMany: jest.fn().mockResolvedValue(rows.map((r) => ({ ...r, bankRef: `REF${r.id}`, unitPrice: { toString: () => r.unitPrice } }))),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: rows.length }),
      delete: jest.fn().mockResolvedValue({}),
    },
    fundraiserPayment: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    fundraiserReminderSend: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    checkoutSession: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
  }
  return { tx, client: tx as unknown as Prisma.TransactionClient }
}

beforeEach(() => jest.clearAllMocks())

describe("reassignFundraiserEntriesTx", () => {
  it("does nothing when neither family has entries", async () => {
    const { tx, client } = makeTx([])
    expect(await reassignFundraiserEntriesTx(client, 1, 2, "Old", 9)).toEqual({ moved: 0, folded: 0, unlinked: 0, foldedEntryIds: [] })
    expect(tx.fundraiserEntry.findMany).not.toHaveBeenCalled()
    expect(logAuditTx).not.toHaveBeenCalled()
  })

  it("locks every entry of both families in id order before reading them", async () => {
    const { tx, client } = makeTx([])
    await reassignFundraiserEntriesTx(client, 1, 2, "Old", 9)
    const sql = (tx.$queryRaw.mock.calls[0][0] as string[]).join("?")
    expect(sql).toContain('"familyId" IN (?, ?)')
    expect(sql).toContain("ORDER BY id FOR UPDATE")
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual([1, 2])
  })

  it("moves an entry when the target has none in that fundraiser", async () => {
    const { tx, client } = makeTx([{ id: 10, fundraiserId: 5, familyId: 1, quantity: 2, unitPrice: "10.00" }])
    expect(await reassignFundraiserEntriesTx(client, 1, 2, "Old", 9)).toEqual({ moved: 1, folded: 0, unlinked: 0, foldedEntryIds: [] })
    expect(tx.fundraiserEntry.update).toHaveBeenCalledWith({ where: { id: 10 }, data: { familyId: 2 } })
    expect(tx.fundraiserEntry.delete).not.toHaveBeenCalled()
    expect(logAuditTx).toHaveBeenCalledWith(client, 9, "FUNDRAISER_ENTRY_REASSIGN", "FundraiserEntry", 10, expect.objectContaining({ mode: "moved" }))
  })

  it("folds into the target's entry at the same price: sums quantity, moves children, deletes the source entry", async () => {
    const { tx, client } = makeTx([
      { id: 10, fundraiserId: 5, familyId: 1, quantity: 2, unitPrice: "10.00" },
      { id: 20, fundraiserId: 5, familyId: 2, quantity: 3, unitPrice: "10" },
    ])
    expect(await reassignFundraiserEntriesTx(client, 1, 2, "Old", 9)).toEqual({ moved: 0, folded: 1, unlinked: 0, foldedEntryIds: [20] })
    expect(tx.fundraiserPayment.updateMany).toHaveBeenCalledWith({ where: { entryId: 10 }, data: { entryId: 20 } })
    expect(tx.fundraiserReminderSend.updateMany).toHaveBeenCalledWith({ where: { entryId: 10 }, data: { entryId: 20 } })
    expect(tx.checkoutSession.updateMany).toHaveBeenCalledWith({ where: { fundraiserEntryId: 10 }, data: { fundraiserEntryId: 20 } })
    expect(tx.fundraiserEntry.update).toHaveBeenCalledWith({ where: { id: 20 }, data: { quantity: 5 } })
    expect(tx.fundraiserEntry.delete).toHaveBeenCalledWith({ where: { id: 10 } })
    // Children move before the source entry is deleted (payments cascade on delete).
    expect(tx.fundraiserPayment.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(tx.fundraiserEntry.delete.mock.invocationCallOrder[0])
    // The old bank ref is kept in the audit row so a late transfer quoting it can be traced.
    expect(logAuditTx).toHaveBeenCalledWith(client, 9, "FUNDRAISER_ENTRY_REASSIGN", "FundraiserEntry", 20,
      expect.objectContaining({ mode: "folded", fromEntryId: 10, fromBankRef: "REF10", quantity: 5 }))
  })

  it("keeps the entry as its own unlinked row with the source name when the prices differ", async () => {
    const { tx, client } = makeTx([
      { id: 10, fundraiserId: 5, familyId: 1, quantity: 2, unitPrice: "10.00" },
      { id: 20, fundraiserId: 5, familyId: 2, quantity: 3, unitPrice: "12.00" },
    ])
    expect(await reassignFundraiserEntriesTx(client, 1, 2, "Old", 9)).toEqual({ moved: 0, folded: 0, unlinked: 1, foldedEntryIds: [] })
    expect(tx.fundraiserEntry.update).toHaveBeenCalledWith({ where: { id: 10 }, data: { familyId: null, familyNameSnapshot: "Old" } })
    expect(tx.fundraiserPayment.updateMany).not.toHaveBeenCalled()
    expect(tx.fundraiserEntry.delete).not.toHaveBeenCalled()
  })

  it("does not fold when the combined total would exceed the per-entry cap", async () => {
    const { tx, client } = makeTx([
      { id: 10, fundraiserId: 5, familyId: 1, quantity: 9000, unitPrice: "100.00" },
      { id: 20, fundraiserId: 5, familyId: 2, quantity: 9000, unitPrice: "100.00" },
    ])
    expect(await reassignFundraiserEntriesTx(client, 1, 2, "Old", 9)).toEqual({ moved: 0, folded: 0, unlinked: 1, foldedEntryIds: [] })
    expect(tx.fundraiserEntry.delete).not.toHaveBeenCalled()
  })

  it("handles several fundraisers in one merge independently", async () => {
    const { client } = makeTx([
      { id: 10, fundraiserId: 5, familyId: 1, quantity: 1, unitPrice: "5.00" },
      { id: 11, fundraiserId: 6, familyId: 1, quantity: 1, unitPrice: "5.00" },
      { id: 12, fundraiserId: 7, familyId: 1, quantity: 1, unitPrice: "5.00" },
      { id: 20, fundraiserId: 6, familyId: 2, quantity: 1, unitPrice: "5.00" },
      { id: 21, fundraiserId: 7, familyId: 2, quantity: 1, unitPrice: "6.00" },
    ])
    expect(await reassignFundraiserEntriesTx(client, 1, 2, "Old", 9)).toEqual({ moved: 1, folded: 1, unlinked: 1, foldedEntryIds: [20] })
  })

  it("a failed audit write throws AuditWriteError (not a raw Prisma error), so the merge rolls back", async () => {
    ;(logAuditTx as jest.Mock).mockRejectedValueOnce(Object.assign(new Error("fk"), { code: "P2003" }))
    const { client } = makeTx([{ id: 10, fundraiserId: 5, familyId: 1, quantity: 2, unitPrice: "10.00" }])
    await expect(reassignFundraiserEntriesTx(client, 1, 2, "Old", 9)).rejects.toBeInstanceOf(AuditWriteError)
  })
})

describe("planFundraiserReassign", () => {
  it("is what the preview counts: move / fold / unlink per source entry", () => {
    const rows = [
      { id: 10, fundraiserId: 5, familyId: 1, quantity: 1, unitPrice: "5.00" },
      { id: 11, fundraiserId: 6, familyId: 1, quantity: 1, unitPrice: "5.00" },
      { id: 12, fundraiserId: 7, familyId: 1, quantity: 1, unitPrice: "5.00" },
      { id: 20, fundraiserId: 6, familyId: 2, quantity: 1, unitPrice: "5" },
      { id: 21, fundraiserId: 7, familyId: 2, quantity: 1, unitPrice: "6.00" },
    ]
    const steps = planFundraiserReassign(rows, 1, 2)
    expect(steps.map((s) => [s.src.id, s.kind])).toEqual([[10, "move"], [11, "fold"], [12, "unlink"]])
    expect(countReassignSteps(steps)).toEqual({ moved: 1, folded: 1, unlinked: 1 })
  })
})

describe("unlinkFundraiserEntriesTx", () => {
  it("returns 0 and writes nothing when the family has no entries", async () => {
    const { tx, client } = makeTx([])
    expect(await unlinkFundraiserEntriesTx(client, 3, "Smith", 9)).toBe(0)
    expect(tx.fundraiserEntry.updateMany).not.toHaveBeenCalled()
    expect(logAuditTx).not.toHaveBeenCalled()
  })

  it("nulls the link, keeps the family name, and audits each entry", async () => {
    const { tx, client } = makeTx([
      { id: 10, fundraiserId: 5, familyId: 3, quantity: 1, unitPrice: "5.00" },
      { id: 11, fundraiserId: 6, familyId: 3, quantity: 1, unitPrice: "5.00" },
    ])
    expect(await unlinkFundraiserEntriesTx(client, 3, "Smith", 9)).toBe(2)
    expect(tx.fundraiserEntry.findMany).toHaveBeenCalledWith({ where: { familyId: 3 }, select: { id: true } })
    expect(tx.fundraiserEntry.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [10, 11] } },
      data: { familyId: null, familyNameSnapshot: "Smith" },
    })
    const calls = (logAuditTx as jest.Mock).mock.calls
    expect(calls.map((c) => c[4])).toEqual([10, 11])
    expect(calls[0][5]).toEqual({ mode: "unlinked", fromFamilyId: 3, reason: "family-deleted" })
    // Audit metadata carries ids/flags only, never the family name (PII).
    expect(JSON.stringify(calls)).not.toContain("Smith")
  })
})
