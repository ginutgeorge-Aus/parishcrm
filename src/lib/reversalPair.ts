import type { prisma } from "@/lib/prisma"

/**
 * True when the transaction is either half of an invoice-unmark reversal pair: the original payment
 * (offset by a row audited with `reversesTransactionId`) or the negative reversal row itself (its own
 * `TRANSACTION_CREATED` audit has `source: "invoice-unmark"`). Un-reconciling either half would let it
 * be edited or deleted alone, leaving the other half unmatched and the invoice income double counted.
 * @param db prisma client or transaction client
 * @param id transaction id to check
 */
export async function isReversalPairRow(db: Pick<typeof prisma, "auditLog">, id: number): Promise<boolean> {
  const hit = await db.auditLog.findFirst({
    where: {
      action: "TRANSACTION_CREATED",
      resourceType: "Transaction",
      OR: [
        { resourceId: id, metadata: { path: ["source"], equals: "invoice-unmark" } },
        { metadata: { path: ["reversesTransactionId"], equals: id } },
      ],
    },
    select: { id: true },
  })
  return hit != null
}
