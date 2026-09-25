// Shared loading skeleton for detail/form routes (person/family/user new,
// edit, and detail pages) nested under a list route. Without this, Next.js
// falls back to the parent segment's loading.tsx — e.g. ListPageSkeleton's
// title + search bar + N pulsing rows — which reads as a table flash on a
// two-field form. Lighter shape: heading + a handful of
// field-height blocks, no search bar.
export function DetailPageSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-6 max-w-3xl" aria-hidden="true">
      <div className="h-7 w-48 rounded bg-muted animate-pulse" />
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-10 w-full rounded bg-muted animate-pulse" />
        ))}
      </div>
    </div>
  )
}
