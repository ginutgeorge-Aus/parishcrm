import type { ReactNode } from "react"
import { fmtAUD } from "@/lib/formatting"

/**
 * Format a balance with an explicit +/− marker so its sign never relies on
 * colour alone: "+$130.25", "−$5.50" (U+2212 minus), "$0.00" for zero.
 *
 * @param balance - Dollar amount (may be negative).
 */
export function formatSignedBalance(balance: number): string {
  if (balance > 0) return `+${fmtAUD(balance)}`
  if (balance < 0) return `−${fmtAUD(Math.abs(balance))}`
  return fmtAUD(0)
}

/**
 * A payment-account balance tile: tinted green in credit, red when overdrawn,
 * neutral for zero or an unknown (null → "—") balance, with a +/− marker on
 * the figure. Replaces the old `border-l-4` side-stripe cards.
 *
 * @param label - Account name.
 * @param balance - Balance in dollars, or null when it can't be computed yet.
 * @param children - Optional footnote under the figure (e.g. "as of …", a setup link).
 */
export function BalanceTile({
  label,
  balance,
  children,
}: Readonly<{ label: string; balance: number | null; children?: ReactNode }>) {
  let tint = "border bg-card"
  let ink = "text-muted-foreground"
  if (balance !== null && balance > 0) {
    tint = "bg-income/10"
    ink = "text-income"
  } else if (balance !== null && balance < 0) {
    tint = "bg-expense/10"
    ink = "text-expense"
  } else if (balance === 0) {
    ink = "text-foreground"
  }

  return (
    <div className={`rounded-lg px-4 py-3 ${tint}`}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular ${ink}`}>
        {balance === null ? "—" : formatSignedBalance(balance)}
      </p>
      {children}
    </div>
  )
}
