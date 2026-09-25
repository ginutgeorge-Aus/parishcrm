"use client"

import { useActionState, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { upsertBudgets, getPrevYearBudgets } from "@/lib/actions/budget"
import { currentFYYear } from "@/lib/fiscalYear"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { Button } from "@/components/ui/button"

type Account = {
  id: number
  code: string
  name: string
  type: "INCOME" | "EXPENSE"
}

type BudgetRow = {
  accountId: number
  amount: string
}

type Props = {
  accounts: Account[]
  budgets: BudgetRow[]
  year: number
}

const YEAR_RANGE = 2

export function BudgetForm({ accounts, budgets, year }: Props) {
  const router = useRouter()
  const [state, formAction, saving] = useActionState(upsertBudgets, undefined)

  const fyNow = currentFYYear()
  const years = Array.from(
    { length: YEAR_RANGE * 2 + 1 },
    (_, i) => fyNow - YEAR_RANGE + i
  )

  const budgetMap = Object.fromEntries(budgets.map((b) => [b.accountId, b.amount]))
  const [values, setValues] = useState<Record<number, string>>(budgetMap)
  // Switching FY navigates via ?year= (router.push below), which re-renders this
  // client component in place with new `year`/`budgets` props rather than
  // remounting — so `values` (seeded once from the initial budgets) would keep
  // the previous year's figures. Reset it when the year prop changes.
  const [prevYear, setPrevYear] = useState(year)
  if (year !== prevYear) {
    setPrevYear(year)
    setValues(budgetMap)
  }
  const [copyError, setCopyError] = useState<string | null>(null)
  const [copying, startCopy] = useTransition()
  const incomeAccounts = accounts.filter((a) => a.type === "INCOME")
  const expenseAccounts = accounts.filter((a) => a.type === "EXPENSE")

  function handleCopy() {
    setCopyError(null)
    startCopy(async () => {
      try {
        const prev = await getPrevYearBudgets(year)
        if (prev.length === 0) {
          setCopyError(`No budget found for FY${year - 1}–${year}`)
          return
        }
        setValues((v) => {
          const next = { ...v }
          for (const { accountId, amount } of prev) {
            next[accountId] = amount
          }
          return next
        })
      } catch {
        setCopyError("Failed to load previous year budget")
      }
    })
  }

  function renderRows(accts: Account[]) {
    return accts.map((a) => (
      <tr key={a.id} className="border-b border-border">
        <td className="py-2 px-3 font-mono text-sm text-muted-foreground">{a.code}</td>
        <td className="py-2 px-3 text-sm">{a.name}</td>
        <td className="py-2 px-3 text-right">
          <input
            type="number"
            aria-label={`Budget for ${a.name}`}
            name={`amount_${a.id}`}
            step="0.01"
            min="0"
            value={values[a.id] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [a.id]: e.target.value }))}
            className="w-36 rounded border border-input bg-background px-2 py-1 text-sm text-right focus:outline-hidden focus:ring-2 focus:ring-ring"
            placeholder="—"
          />
        </td>
      </tr>
    ))
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="year" value={year} />

      <div className="flex items-center gap-4 mb-6">
        <label htmlFor="financial-year" className="text-sm font-medium text-foreground">Financial Year</label>
        <Select value={String(year)} onValueChange={(v: string) => router.push(`?year=${v}`)} disabled={copying}>
          <SelectTrigger id="financial-year" className="w-32" disabled={copying}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}–{y + 1}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <FormFeedback state={state} className="mb-4" />

      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full">
          <thead className="bg-muted text-left">
            <tr>
              <th className="py-2 px-3 text-xs font-semibold uppercase text-muted-foreground tracking-wide">
                Code
              </th>
              <th className="py-2 px-3 text-xs font-semibold uppercase text-muted-foreground tracking-wide">
                Category
              </th>
              <th className="py-2 px-3 text-xs font-semibold uppercase text-muted-foreground tracking-wide text-right">
                Budget ($)
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="bg-info/10">
              <td
                colSpan={3}
                className="py-1.5 px-3 text-xs font-bold uppercase text-info tracking-wide"
              >
                Income
              </td>
            </tr>
            {renderRows(incomeAccounts)}
            <tr className="bg-warning/10">
              <td
                colSpan={3}
                className="py-1.5 px-3 text-xs font-bold uppercase text-warning tracking-wide"
              >
                Expenses
              </td>
            </tr>
            {renderRows(expenseAccounts)}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button
          type="submit"
          disabled={saving || copying}
        >
          {saving ? "Saving…" : "Save budget"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={handleCopy}
          disabled={copying}
        >
          {copying ? "Copying…" : `Copy from FY${year - 1}–${year}`}
        </Button>
        {copying && (
          <span className="text-xs text-muted-foreground" aria-busy={true}>
            Copying previous year budget…
          </span>
        )}
        <FormFeedback state={{ error: copyError }} />
      </div>
    </form>
  )
}
