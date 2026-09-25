"use client"

import { useRouter } from "next/navigation"
import { currentFYYear } from "@/lib/fiscalYear"

type Account = { id: number; code: string; name: string }

/**
 * Account + financial-year selectors for the General Ledger report. Both push
 * a URL preserving the other param — unlike the shared YearSelector, which
 * resets the whole query string (it's used on single-param report pages).
 * Native <select> on purpose: keeps server-driven filtering simple and RTL
 * tests straightforward.
 */
export function GeneralLedgerControls({
  accounts,
  accountId,
  year,
}: {
  accounts: Account[]
  accountId: number | null
  year: number
}) {
  const router = useRouter()
  const fyNow = currentFYYear()
  const years = Array.from({ length: 5 }, (_, i) => fyNow - 3 + i)

  function push(next: { accountId?: number | null; year?: number }) {
    const a = next.accountId !== undefined ? next.accountId : accountId
    const y = next.year !== undefined ? next.year : year
    const params = new URLSearchParams()
    params.set("year", String(y))
    if (a) params.set("account", String(a))
    router.push(`/accounting/reports/general-ledger?${params.toString()}`)
  }

  const selectClass = "min-h-11 rounded-md border border-input bg-background px-2 text-sm"

  return (
    <>
      <select
        aria-label="Account"
        className={selectClass}
        value={accountId ?? ""}
        onChange={(e) => push({ accountId: e.target.value ? parseInt(e.target.value, 10) : null })}
      >
        <option value="">Select account…</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.code} — {a.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Financial year"
        className={selectClass}
        value={year}
        onChange={(e) => push({ year: parseInt(e.target.value, 10) })}
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {y}–{y + 1}
          </option>
        ))}
      </select>
    </>
  )
}
