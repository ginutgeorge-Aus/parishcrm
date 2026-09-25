// Dashboard runs ~18 parallel queries plus field decryption; without a
// route-level skeleton the user stares at a blank <main> on cold load.
// Mirrors the page's Money / People / Needs-attention card-grid layout.
export default function Loading() {
  return (
    <div className="space-y-8" aria-hidden="true">
      <div className="h-8 w-64 rounded bg-muted animate-pulse" />

      {/* Money — 4 stat cards */}
      <div className="space-y-3">
        <div className="h-5 w-24 rounded bg-muted animate-pulse" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      </div>

      {/* People — 4 stat cards */}
      <div className="space-y-3">
        <div className="h-5 w-24 rounded bg-muted animate-pulse" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      </div>

      {/* Needs attention — 2 wide cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="h-48 rounded-lg bg-muted animate-pulse" />
        ))}
      </div>
    </div>
  )
}
