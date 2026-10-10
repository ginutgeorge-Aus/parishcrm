import { LoadingStatus } from "@/components/shared/LoadingStatus"

// Accounting home is a dashboard, not a list: mirrors its heading + actions,
// 4 summary stat cards, payment-account balance cards and recent-transactions
// rows so the skeleton matches the page the user is waiting for.
export default function Loading() {
  return (
    <LoadingStatus className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="h-7 w-48 rounded bg-muted animate-pulse" />
        <div className="h-9 w-40 rounded bg-muted animate-pulse" />
      </div>

      {/* Summary — 4 stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />
        ))}
      </div>

      {/* Account balances */}
      <div className="space-y-2">
        <div className="h-5 w-40 rounded bg-muted animate-pulse" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      </div>

      {/* Recent transactions */}
      <div className="space-y-2">
        <div className="h-5 w-48 rounded bg-muted animate-pulse" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-10 w-full rounded bg-muted animate-pulse" />
        ))}
      </div>
    </LoadingStatus>
  )
}
