import type { Prisma } from "@/lib/generated/prisma/client"

/**
 * The account's name when it exists, has the expected type, and is active (unless `allowInactive`); else null.
 * Takes the client so createTransaction/updateTransaction and the petty-cash receipt/expense actions can re-run it
 * inside their Serializable write. Lives outside the "use server" action modules so it is not a callable action.
 * @param db - Prisma client or transaction client
 * @param accountId - Account id
 * @param type - required account type
 * @param options - allowInactive keeps a deactivated account valid (edits of historical rows)
 */
export async function accountMatches(
  db: Prisma.TransactionClient,
  accountId: number,
  type: "INCOME" | "EXPENSE",
  options?: { allowInactive?: boolean }
): Promise<{ name: string } | null> {
  const account = await db.account.findUnique({
    where: { id: accountId },
    select: { type: true, isActive: true, name: true },
  })
  if (!account || account.type !== type) return null
  if (!options?.allowInactive && !account.isActive) return null
  return { name: account.name }
}
