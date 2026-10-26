import { centsToNumber } from "@/lib/formatting"
import type { ReviewStats } from "@/lib/bankReviewFilter"

const AUD = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" })

/** Stat tiles above the review table: rows, needs category, duplicates, in/out of rows to import. */
export function ReviewSummary({ stats }: Readonly<{ stats: ReviewStats }>) {
  const tiles = [
    { label: "Rows", value: <>{stats.total}</> },
    { label: "Need category", value: <span className={stats.needsCategory > 0 ? "text-warning" : undefined}>{stats.needsCategory}</span> },
    { label: "Duplicates", value: <>{stats.duplicates}</> },
    {
      label: "In / Out",
      value: (
        <>
          <span className="text-income">{AUD.format(centsToNumber(stats.incomeCents))}</span>{" "}
          <span className="text-expense">{AUD.format(centsToNumber(stats.expenseCents))}</span>
        </>
      ),
    },
  ]
  return (
    <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-lg border bg-card px-3 py-2">
          <dt className="text-xs text-muted-foreground">{t.label}</dt>
          <dd className="text-lg font-semibold tabular">{t.value}</dd>
        </div>
      ))}
    </dl>
  )
}
