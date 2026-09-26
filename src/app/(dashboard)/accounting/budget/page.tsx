import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { isAdmin } from "@/lib/roleGuard"
import { BudgetForm } from "@/components/accounting/BudgetForm"
import { currentFYYear } from "@/lib/fiscalYear"

type Props = {
  searchParams: Promise<{ year?: string }>
}

export default async function BudgetPage(props: Props) {
  const searchParams = await props.searchParams;
  const session = await auth()
  if (!isAdmin(session?.user?.role)) redirect("/")

  const fyNow = currentFYYear()
  const parsedYear = Number.parseInt(searchParams.year ?? String(fyNow), 10)
  const year = parsedYear >= 2000 && parsedYear <= 2100 ? parsedYear : fyNow

  const [accounts, budgetRows] = await Promise.all([
    prisma.account.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, type: true },
    }),
    prisma.budget.findMany({
      where: { year },
      select: { accountId: true, amount: true },
    }),
  ])

  const budgets = budgetRows.map((b) => ({
    accountId: b.accountId,
    amount: b.amount.toString(),
  }))

  return (
    <div>
      <h2 className="text-2xl font-semibold text-foreground mb-6">Budget Management</h2>
      <BudgetForm key={year} accounts={accounts} budgets={budgets} year={year} />
    </div>
  )
}
