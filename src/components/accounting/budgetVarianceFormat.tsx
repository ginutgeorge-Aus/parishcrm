// Shared display helpers for the Budget vs Actual report ( extraction).
// Kept dependency-free of the query layer so the table + mobile-card
// components render identical figures.
import { fmtAUD } from "@/lib/formatting"

export function fmtSigned(n: number): string {
  const abs = fmtAUD(Math.abs(n))
  return n >= 0 ? `+${abs}` : `-${abs}`
}

export function fmtPct(variance: number, budget: number): string {
  if (budget === 0) return "—"
  const pct = (variance / budget) * 100
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`
}

// For INCOME: over budget (variance > 0) = good = green. Under = red.
// For EXPENSE: over budget (variance > 0) = bad = red. Under = green.
export function varianceColor(variance: number, isIncome: boolean): string {
  if (variance === 0) return "text-muted-foreground"
  const isGood = isIncome ? variance > 0 : variance < 0
  return isGood ? "text-income" : "text-expense"
}

// Magnitude-based flag — independent of the favorable/unfavorable
// color above. Shown for any line swinging further than the threshold from
// budget, in either direction.
export function VarianceFlag({ flagged }: { flagged: boolean }) {
  if (!flagged) return null
  return (
    <span
      role="img"
      aria-label="over variance threshold"
      title="Variance exceeds threshold"
      className="ml-1 inline-block rounded-full bg-gold/10 px-1 text-gold-foreground"
    >
      ⚠
    </span>
  )
}
