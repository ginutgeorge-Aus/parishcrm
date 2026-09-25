import { prisma } from "@/lib/prisma"
import { isP2002 } from "@/lib/validation"

export type PaymentAccountLite = {
  id: number
  name: string
  kind: "BANK" | "CASH"
  isDefault: boolean
  isActive: boolean
}

const select = { id: true, name: true, kind: true, isDefault: true, isActive: true } as const

export async function getPaymentAccounts(
  opts: { kind?: "BANK" | "CASH"; activeOnly?: boolean } = {}
): Promise<PaymentAccountLite[]> {
  const where: { kind?: "BANK" | "CASH"; isActive?: boolean } = {}
  if (opts.kind) where.kind = opts.kind
  if (opts.activeOnly) where.isActive = true
  return prisma.paymentAccount.findMany({
    where,
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    select,
  }) as Promise<PaymentAccountLite[]>
}

export async function getCashAccount(): Promise<PaymentAccountLite> {
  const existing = await prisma.paymentAccount.findFirst({
    where: { kind: "CASH", isActive: true },
    select,
  })
  if (existing) return existing as PaymentAccountLite
  // Self-heal: petty-cash posting assumes a single active CASH account, and its
  // ledger mirrors carry that id. A fresh install provisioned via `migrate
  // deploy` (which never runs the seed) has none, so the mirrors would post
  // paymentAccountId=null — permanently invisible to every cash balance and
  // reconciliation, with no backfill when an account is later created.
  // The upsert/reactivation below both insert or activate a CASH row, which the
  // `PaymentAccount_one_active_cash` partial-unique index guards. Between the
  // findFirst above and either write, another path can create or activate a
  // CASH account under a *different* name — the write then loses that race with
  // a P2002. In every such case a usable active CASH account now exists, so
  // refetch and adopt it rather than letting the conflict escape and fail the
  // caller's receipt/expense/transfer/import.
  const winnerOrThrow = async (e: unknown): Promise<PaymentAccountLite> => {
    if (!isP2002(e)) throw e
    const winner = await prisma.paymentAccount.findFirst({
      where: { kind: "CASH", isActive: true },
      select,
    })
    if (winner) return winner as PaymentAccountLite
    throw e
  }
  // Provision the canonical "Petty Cash" on demand (name matches the seed),
  // mirroring getXferAccountId's self-heal. Upsert-on-name (name is @unique)
  // resolves a concurrent same-name create to the existing row instead of P2002.
  let row
  try {
    row = await prisma.paymentAccount.upsert({
      where: { name: "Petty Cash" },
      update: {},
      create: { name: "Petty Cash", kind: "CASH", isActive: true },
      select,
    })
  } catch (e) {
    return winnerOrThrow(e)
  }
  // A namesake row can exist that ISN'T an active CASH account (an admin can
  // freely name/rename a BANK account "Petty Cash"). Adopting it would post
  // every petty-cash mirror against a bank account and corrupt both balances —
  // so verify kind + active on the upsert result, never treating an
  // incompatible name collision as success.
  if (row.kind === "CASH" && row.isActive) return row as PaymentAccountLite
  if (row.kind === "CASH") {
    // A deactivated cash account of the canonical name — reactivate it, adopting
    // a concurrent active-CASH winner if one appeared since the findFirst.
    try {
      return (await prisma.paymentAccount.update({
        where: { id: row.id },
        data: { isActive: true },
        select,
      })) as PaymentAccountLite
    } catch (e) {
      return winnerOrThrow(e)
    }
  }
  // The canonical name is held by a non-CASH account — provision the cash
  // account under a distinct name. "Cash" itself can also be taken (a second
  // bank namesake, or a concurrent petty-cash request that reached this branch
  // first), so probe successive names; on a unique-name collision refetch, in
  // case a concurrent invocation already created the active CASH account, and
  // only fall through to the next candidate when the collision was a non-CASH /
  // inactive namesake.
  for (let i = 0; i < 50; i++) {
    const name = i === 0 ? "Cash" : `Cash ${i + 1}`
    try {
      return (await prisma.paymentAccount.create({
        data: { name, kind: "CASH", isActive: true },
        select,
      })) as PaymentAccountLite
    } catch (e) {
      if (!isP2002(e)) throw e
      const winner = await prisma.paymentAccount.findFirst({
        where: { kind: "CASH", isActive: true },
        select,
      })
      if (winner) return winner as PaymentAccountLite
    }
  }
  throw new Error("getCashAccount: could not provision an active cash account")
}
