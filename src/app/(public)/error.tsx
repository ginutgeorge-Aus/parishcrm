"use client"

import { useEffect, useRef } from "react"

// Segment error boundary for the public event pages (/AUDIT-073). Without it
// an uncaught render error (e.g. a decrypt failure mid-registration) falls through
// to the root boundary. We log only the opaque digest — never the raw error —
// because this runs for unauthenticated visitors and the error may carry PII.
export default function PublicError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    console.error("Public page error", error.digest)
  }, [error.digest])

  // Move focus to the heading on mount so screen-reader / keyboard users land
  // on the error message instead of staying on the now-replaced content (2.4.3).
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="text-center">
        <h1 ref={headingRef} tabIndex={-1} className="text-[clamp(1.25rem,3vw,1.5rem)] font-semibold text-foreground mb-2 outline-none">Something went wrong</h1>
        <p className="text-sm text-muted-foreground mb-4">
          We couldn&apos;t load this page. Please try again in a moment.
        </p>
        <button
          onClick={reset}
          className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
