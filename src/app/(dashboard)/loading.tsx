import { LoadingStatus } from "@/components/shared/LoadingStatus"

// Dashboard runs ~18 parallel queries plus field decryption; without a
// route-level skeleton the user stares at a blank <main> on cold load.
// Mirrors the page's layout: title + stats strip, Needs-attention list,
// Money (primary figure + balances), People widgets.
export default function Loading() {
  return (
    <LoadingStatus className="space-y-8">
      <div className="space-y-2">
        <div className="h-8 w-64 rounded bg-muted animate-pulse" />
        <div className="h-4 w-full max-w-md rounded bg-muted animate-pulse" />
      </div>

      {/* Needs attention — list rows */}
      <div className="space-y-3">
        <div className="h-6 w-40 rounded bg-muted animate-pulse" />
        <div className="h-32 rounded-lg bg-muted animate-pulse" />
      </div>

      {/* Money — primary figure + balance tiles */}
      <div className="space-y-3">
        <div className="h-6 w-24 rounded bg-muted animate-pulse" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className="h-28 rounded-lg bg-muted animate-pulse" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />
            ))}
          </div>
        </div>
      </div>

      {/* People — celebration widgets */}
      <div className="space-y-3">
        <div className="h-6 w-24 rounded bg-muted animate-pulse" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-40 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      </div>
    </LoadingStatus>
  )
}
