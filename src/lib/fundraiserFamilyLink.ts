import type { Prisma } from "@/lib/generated/prisma/client"
import { logAuditGuardedTx } from "@/lib/auditGuard"
import { toCents, type Money } from "@/lib/formatting"
import { MAX_OWED_CENTS } from "@/lib/fundraiserMath"

/**
 * FundraiserEntry.familyId is onDelete: Restrict, so a family with fundraiser
 * history can only be deleted after its entries are moved (merge) or unlinked
 * (retention delete). Both write helpers run inside the caller's transaction,
 * which already holds the family row lock(s), so no entry can be added to the
 * family meanwhile (addEntry share-locks the family row).
 */

/** What a merge did (or will do) with the source family's fundraiser entries. */
export type FundraiserReassignCounts = { moved: number; folded: number; unlinked: number }
/** Counts plus the target entry ids whose amount changed (their open card checkouts must be expired). */
export type FundraiserReassignResult = FundraiserReassignCounts & { foldedEntryIds: number[] }

/** The fields the merge rule needs from an entry. */
export type ReassignRow = { id: number; fundraiserId: number; familyId: number | null; quantity: number; unitPrice: Money }

/** One source entry's fate in a merge. */
export type ReassignStep =
  | { kind: "move"; src: ReassignRow }
  | { kind: "fold"; src: ReassignRow; dst: ReassignRow; quantity: number }
  | { kind: "unlink"; src: ReassignRow }

/**
 * The merge rule, as a pure function (shared by the merge preview and the
 * merge itself). Per source entry:
 * - target has no entry in that fundraiser: move it (familyId = target);
 * - target has one at the same unit price, and the combined total stays within
 *   the per-entry cap: fold it in (quantities summed);
 * - otherwise (different price snapshot, or the sum would exceed the cap): keep
 *   it as its own row, unlinked, under the source family's name.
 *   (fundraiserId, familyId) is unique, so it cannot be a second linked row.
 * @param rows entries of both families
 * @param sourceId family being merged away
 * @param targetId surviving family
 * @returns one step per source entry, in id order
 */
export function planFundraiserReassign(rows: ReassignRow[], sourceId: number, targetId: number): ReassignStep[] {
  const sorted = [...rows].sort((a, b) => a.id - b.id)
  const targetByFundraiser = new Map(sorted.filter((r) => r.familyId === targetId).map((r) => [r.fundraiserId, r]))
  return sorted.filter((r) => r.familyId === sourceId).map((src): ReassignStep => {
    const dst = targetByFundraiser.get(src.fundraiserId)
    if (!dst) return { kind: "move", src }
    const priceCents = toCents(src.unitPrice)
    const quantity = dst.quantity + src.quantity
    if (priceCents === toCents(dst.unitPrice) && quantity * priceCents <= MAX_OWED_CENTS) {
      return { kind: "fold", src, dst, quantity }
    }
    return { kind: "unlink", src }
  })
}

/**
 * Count the steps of a merge plan by kind.
 * @param steps output of `planFundraiserReassign`
 * @returns moved / folded / unlinked counts
 */
export function countReassignSteps(steps: ReassignStep[]): FundraiserReassignCounts {
  const counts: FundraiserReassignCounts = { moved: 0, folded: 0, unlinked: 0 }
  for (const s of steps) {
    if (s.kind === "move") counts.moved++
    else if (s.kind === "fold") counts.folded++
    else counts.unlinked++
  }
  return counts
}

/**
 * Re-home the source family's fundraiser entries onto the merge target, before
 * the source family is deleted, following `planFundraiserReassign`. A fold
 * moves payments, reminder sends and checkout sessions to the target entry,
 * then deletes the source entry (its pay link and bank reference stop working;
 * the old bank reference is kept in the audit row so a late transfer quoting
 * it can be traced). Every entry of both families is row-locked first, in id
 * order: a concurrent payment or quantity edit locks the entry row, and a
 * reminder-send insert takes a key-share lock on it, so none can interleave.
 * One audit row per touched entry, guarded (`logAuditGuardedTx`): a failed
 * audit write throws `AuditWriteError` and rolls the merge back.
 * The caller must expire open card checkouts on `foldedEntryIds` after commit
 * (their amount changed).
 * @param tx interactive-transaction client (caller holds both family row locks)
 * @param sourceId family being merged away
 * @param targetId surviving family
 * @param sourceName source family's name, kept on entries that are unlinked
 * @param actor acting user id for the audit rows
 * @returns counts of moved, folded and unlinked entries, and the folded-into entry ids
 */
export async function reassignFundraiserEntriesTx(
  tx: Prisma.TransactionClient,
  sourceId: number,
  targetId: number,
  sourceName: string,
  actor: number | null,
): Promise<FundraiserReassignResult> {
  // nosemgrep: crm-no-raw-sql — row lock; Prisma has no locking API
  const locked = await tx.$queryRaw<{ id: number }[]>`
    SELECT id FROM "FundraiserEntry" WHERE "familyId" IN (${sourceId}, ${targetId}) ORDER BY id FOR UPDATE` // nosemgrep: crm-no-raw-sql
  if (locked.length === 0) return { moved: 0, folded: 0, unlinked: 0, foldedEntryIds: [] }
  const rows = await tx.fundraiserEntry.findMany({
    where: { id: { in: locked.map((r) => r.id) } },
    select: { id: true, fundraiserId: true, familyId: true, quantity: true, unitPrice: true, bankRef: true },
    orderBy: { id: "asc" },
  })
  const bankRefOf = new Map(rows.map((r) => [r.id, r.bankRef]))
  const steps = planFundraiserReassign(rows, sourceId, targetId)
  const foldedEntryIds = new Set<number>()

  for (const step of steps) {
    const { src } = step
    if (step.kind === "move") {
      await tx.fundraiserEntry.update({ where: { id: src.id }, data: { familyId: targetId } })
      await entryAudit(tx, actor, src.id, { mode: "moved", fromFamilyId: sourceId, toFamilyId: targetId })
    } else if (step.kind === "fold") {
      const { dst, quantity } = step
      await tx.fundraiserPayment.updateMany({ where: { entryId: src.id }, data: { entryId: dst.id } })
      await tx.fundraiserReminderSend.updateMany({ where: { entryId: src.id }, data: { entryId: dst.id } })
      // The webhook credits the staging row's entry; the caller expires these after commit.
      await tx.checkoutSession.updateMany({ where: { fundraiserEntryId: src.id }, data: { fundraiserEntryId: dst.id } })
      await tx.fundraiserEntry.update({ where: { id: dst.id }, data: { quantity } })
      await tx.fundraiserEntry.delete({ where: { id: src.id } })
      // A second fold into the same target builds on this quantity.
      dst.quantity = quantity
      foldedEntryIds.add(dst.id)
      await entryAudit(tx, actor, dst.id, {
        mode: "folded", fromEntryId: src.id, fromBankRef: bankRefOf.get(src.id), fromFamilyId: sourceId,
        addedQuantity: src.quantity, quantity,
      })
    } else {
      await tx.fundraiserEntry.update({ where: { id: src.id }, data: { familyId: null, familyNameSnapshot: sourceName } })
      await entryAudit(tx, actor, src.id, { mode: "unlinked", fromFamilyId: sourceId, reason: "merge-clash" })
    }
  }
  return { ...countReassignSteps(steps), foldedEntryIds: [...foldedEntryIds] }
}

/**
 * Drop the family link from all of a family's fundraiser entries before a
 * past-retention hard delete, keeping the family's name on each entry so the
 * fundraiser ledger still reads correctly. Payments stay on the entries.
 * Audit rows are guarded: a failed write throws `AuditWriteError`.
 * @param tx interactive-transaction client (caller holds the family row lock)
 * @param familyId family about to be deleted
 * @param familyName name to keep on the entries
 * @param actor acting user id for the audit rows
 * @returns number of entries unlinked
 */
export async function unlinkFundraiserEntriesTx(
  tx: Prisma.TransactionClient,
  familyId: number,
  familyName: string,
  actor: number | null,
): Promise<number> {
  const entries = await tx.fundraiserEntry.findMany({ where: { familyId }, select: { id: true } })
  if (entries.length === 0) return 0
  await tx.fundraiserEntry.updateMany({
    where: { id: { in: entries.map((e) => e.id) } },
    data: { familyId: null, familyNameSnapshot: familyName },
  })
  for (const e of entries) {
    await entryAudit(tx, actor, e.id, { mode: "unlinked", fromFamilyId: familyId, reason: "family-deleted" })
  }
  return entries.length
}

/**
 * Write one guarded FUNDRAISER_ENTRY_REASSIGN audit row (ids and flags only, never PII).
 * @param tx transaction client
 * @param actor acting user id
 * @param entryId affected entry
 * @param metadata what happened
 */
async function entryAudit(tx: Prisma.TransactionClient, actor: number | null, entryId: number, metadata: Record<string, unknown>): Promise<void> {
  await logAuditGuardedTx(tx, actor, "FUNDRAISER_ENTRY_REASSIGN", "FundraiserEntry", entryId, metadata)
}
