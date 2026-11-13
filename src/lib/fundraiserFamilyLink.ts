import type { Prisma } from "@/lib/generated/prisma/client"
import { logAuditManyTx, type AuditEntry } from "@/lib/audit"
import { toCents } from "@/lib/formatting"
import { MAX_OWED_CENTS } from "@/lib/fundraiserMath"

/**
 * FundraiserEntry.familyId is onDelete: Restrict, so a family with fundraiser
 * history can only be deleted after its entries are moved (merge) or unlinked
 * (retention delete). Both helpers run inside the caller's transaction, which
 * already holds the family row lock(s), so no entry can be added to the family
 * meanwhile (addEntry share-locks the family row).
 */

/** What a merge did with the source family's fundraiser entries. */
export type FundraiserReassignResult = { moved: number; folded: number; unlinked: number }

type EntryRow = { id: number; fundraiserId: number; familyId: number | null; quantity: number; unitPrice: Prisma.Decimal }

/**
 * Re-home the source family's fundraiser entries onto the merge target, before
 * the source family is deleted. Per source entry:
 * - target has no entry in that fundraiser: the entry moves (familyId = target);
 * - target has one at the same unit price, and the combined total stays within
 *   the per-entry cap: the source entry is folded into it (quantities summed;
 *   payments, reminder sends and checkout sessions moved; source entry deleted);
 * - otherwise (different price snapshot, or the sum would exceed the cap): the
 *   entry stays as its own row, unlinked, with the source family's name in
 *   `familyNameSnapshot`. (fundraiserId, familyId) is unique, so it cannot be
 *   linked to the target as a second row.
 * Every entry of both families is row-locked first, in id order, so a
 * concurrent payment or quantity edit (both lock the entry row) cannot
 * interleave. One audit row per touched entry, in the transaction.
 * @param tx interactive-transaction client (caller holds both family row locks)
 * @param sourceId family being merged away
 * @param targetId surviving family
 * @param sourceName source family's name, kept on entries that are unlinked
 * @param actor acting user id for the audit rows
 * @returns counts of moved, folded and unlinked entries
 */
export async function reassignFundraiserEntriesTx(
  tx: Prisma.TransactionClient,
  sourceId: number,
  targetId: number,
  sourceName: string,
  actor: number | null,
): Promise<FundraiserReassignResult> {
  const result: FundraiserReassignResult = { moved: 0, folded: 0, unlinked: 0 }
  // nosemgrep: crm-no-raw-sql — row lock; Prisma has no locking API
  const locked = await tx.$queryRaw<{ id: number }[]>`
    SELECT id FROM "FundraiserEntry" WHERE "familyId" IN (${sourceId}, ${targetId}) ORDER BY id FOR UPDATE` // nosemgrep: crm-no-raw-sql
  if (locked.length === 0) return result
  const rows: EntryRow[] = await tx.fundraiserEntry.findMany({
    where: { id: { in: locked.map((r) => r.id) } },
    select: { id: true, fundraiserId: true, familyId: true, quantity: true, unitPrice: true },
    orderBy: { id: "asc" },
  })
  const targetByFundraiser = new Map(rows.filter((r) => r.familyId === targetId).map((r) => [r.fundraiserId, r]))
  const audits: AuditEntry[] = []

  for (const src of rows.filter((r) => r.familyId === sourceId)) {
    const dst = targetByFundraiser.get(src.fundraiserId)
    if (!dst) {
      await tx.fundraiserEntry.update({ where: { id: src.id }, data: { familyId: targetId } })
      result.moved++
      audits.push(entryAudit(actor, src.id, { mode: "moved", fromFamilyId: sourceId, toFamilyId: targetId }))
      continue
    }
    const priceCents = toCents(src.unitPrice)
    const quantity = dst.quantity + src.quantity
    if (priceCents === toCents(dst.unitPrice) && quantity * priceCents <= MAX_OWED_CENTS) {
      await tx.fundraiserPayment.updateMany({ where: { entryId: src.id }, data: { entryId: dst.id } })
      await tx.fundraiserReminderSend.updateMany({ where: { entryId: src.id }, data: { entryId: dst.id } })
      // Open card checkouts keep working: the webhook credits the staging row's entry.
      await tx.checkoutSession.updateMany({ where: { fundraiserEntryId: src.id }, data: { fundraiserEntryId: dst.id } })
      await tx.fundraiserEntry.update({ where: { id: dst.id }, data: { quantity } })
      await tx.fundraiserEntry.delete({ where: { id: src.id } })
      dst.quantity = quantity
      result.folded++
      audits.push(entryAudit(actor, dst.id, {
        mode: "folded", fromEntryId: src.id, fromFamilyId: sourceId, addedQuantity: src.quantity, quantity,
      }))
      continue
    }
    await tx.fundraiserEntry.update({
      where: { id: src.id },
      data: { familyId: null, familyNameSnapshot: sourceName },
    })
    result.unlinked++
    audits.push(entryAudit(actor, src.id, { mode: "unlinked", fromFamilyId: sourceId, reason: "merge-clash" }))
  }
  await logAuditManyTx(tx, audits)
  return result
}

/**
 * Drop the family link from all of a family's fundraiser entries before a
 * past-retention hard delete, keeping the family's name on each entry so the
 * fundraiser ledger still reads correctly. Payments stay on the entries.
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
  await logAuditManyTx(tx, entries.map((e) => entryAudit(actor, e.id, { mode: "unlinked", fromFamilyId: familyId, reason: "family-deleted" })))
  return entries.length
}

/**
 * One FUNDRAISER_ENTRY_REASSIGN audit row (ids and flags only, never PII).
 * @param actor acting user id
 * @param entryId affected entry
 * @param metadata what happened
 * @returns the audit row
 */
function entryAudit(actor: number | null, entryId: number, metadata: Record<string, unknown>): AuditEntry {
  return { userId: actor, action: "FUNDRAISER_ENTRY_REASSIGN", resourceType: "FundraiserEntry", resourceId: entryId, metadata }
}
