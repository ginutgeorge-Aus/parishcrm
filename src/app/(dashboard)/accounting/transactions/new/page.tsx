import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { canAccessAccounting } from "@/lib/roleGuard"
import { createTransaction } from "@/lib/actions/transaction"
import { getActiveFunds } from "@/lib/actions/fund"
import { getPaymentAccounts } from "@/lib/paymentAccounts"
import { TransactionForm } from "@/components/accounting/TransactionForm"

export default async function NewTransactionPage() {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) redirect("/")

  const [accounts, families, funds, paymentAccounts] = await Promise.all([
    prisma.account.findMany({ where: { isActive: true }, orderBy: { code: "asc" } }),
    prisma.family.findMany({
      where: { archivedAt: null },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        people: { select: { id: true, firstName: true, lastName: true }, orderBy: { firstName: "asc" } },
      },
    }),
    getActiveFunds(),
    getPaymentAccounts({ activeOnly: true }),
  ])

  return (
    <div>
      <h2 className="text-2xl font-semibold text-foreground mb-6">New transaction</h2>
      <TransactionForm action={createTransaction} accounts={accounts} families={families} funds={funds} paymentAccounts={paymentAccounts} />
    </div>
  )
}
