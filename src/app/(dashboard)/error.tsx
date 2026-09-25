"use client"

import { useEffect } from "react"

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log only the opaque Next.js digest — never the raw error, which may carry
    // decrypted member/financial fragments a future client reporter would leak.
    console.error("Dashboard page error", error.digest)
  }, [error.digest])

  return (
    <div className="flex h-full min-h-96 items-center justify-center">
      <div className="text-center">
        <h2 className="text-lg font-semibold text-foreground mb-2">Something went wrong</h2>
        <p className="text-sm text-muted-foreground mb-1">An unexpected error occurred on this page.</p>
        <p className="text-sm text-muted-foreground mb-4">If this keeps happening, use the Feedback button to report it.</p>
        <button
          onClick={reset}
          className="rounded bg-slate-900 min-w-[44px] min-h-[44px] px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
