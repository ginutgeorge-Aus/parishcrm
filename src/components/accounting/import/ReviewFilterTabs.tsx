import { cn } from "@/lib/utils"
import type { ReviewFilter, ReviewStats } from "@/lib/bankReviewFilter"

const TABS: { id: ReviewFilter; label: string; count: (s: ReviewStats) => number }[] = [
  { id: "all", label: "All", count: (s) => s.total },
  { id: "needsCategory", label: "Needs category", count: (s) => s.needsCategory },
  { id: "matched", label: "Matched member", count: (s) => s.matched },
  { id: "duplicates", label: "Duplicates", count: (s) => s.duplicates },
  { id: "skipped", label: "Skipped", count: (s) => s.skipped },
]

/** View-only filter pills for the review table; scrolls horizontally on phones. */
export function ReviewFilterTabs({
  value,
  stats,
  onChange,
}: Readonly<{ value: ReviewFilter; stats: ReviewStats; onChange: (f: ReviewFilter) => void }>) {
  return (
    <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" aria-label="Filter rows">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-pressed={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            "min-h-11 shrink-0 rounded-full border bg-card px-3 text-sm text-muted-foreground",
            value === t.id && "border-primary bg-primary text-primary-foreground",
          )}
        >
          {t.label} {t.count(stats)}
        </button>
      ))}
    </div>
  )
}
