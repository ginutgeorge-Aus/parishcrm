// Shared loading skeleton for list pages (people, families, users, events)
// whose Server Components run DB queries — shown via route-level loading.tsx so
// the user sees structured placeholders instead of a blank flash on navigation.
// Mirrors AccountingPageSkeleton; generic so non-accounting lists reuse it.
// rowHeight controls the per-row pulse height (default h-12 for card-style lists;
// h-10 for denser table rows used by AccountingPageSkeleton).
export function ListPageSkeleton({ rows = 8, rowHeight = "h-12" }: { rows?: number; rowHeight?: string }) {
  return (
    <div className="space-y-6" aria-hidden="true">
      {/* Heading + action button row */}
      <div className="flex items-center justify-between">
        <div className="h-7 w-48 rounded bg-muted animate-pulse" />
        <div className="h-9 w-32 rounded bg-muted animate-pulse" />
      </div>
      {/* Search / filter bar */}
      <div className="h-10 w-full rounded bg-muted animate-pulse" />
      {/* List rows */}
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className={`${rowHeight} w-full rounded bg-muted animate-pulse`} />
        ))}
      </div>
    </div>
  )
}
