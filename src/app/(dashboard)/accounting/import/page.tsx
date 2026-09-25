import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { canAccessAccounting } from "@/lib/roleGuard"
import { BankImportClient } from "@/components/accounting/BankImportClient"
import { getPaymentAccounts } from "@/lib/paymentAccounts"

export default async function BankImportPage() {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) redirect("/")

  const [accounts, families, paymentAccounts] = await Promise.all([
    prisma.account.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, type: true },
    }),
    prisma.family.findMany({
      where: { archivedAt: null }, // don't offer archived families in the match picker
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        people: {
          select: { id: true, firstName: true, lastName: true, bankingName: true },
          orderBy: { firstName: "asc" },
        },
      },
    }),
    // Bank statements only ever cover a BANK-kind account, never the cash account.
    getPaymentAccounts({ kind: "BANK", activeOnly: true }),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-foreground">Bank Import</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Import transactions from an ANZ bank statement PDF
        </p>
      </div>
      <BankImportClient accounts={accounts} families={families} paymentAccounts={paymentAccounts} />
    </div>
  )
}
