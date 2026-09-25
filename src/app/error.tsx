"use client"

import { useEffect, useRef } from "react"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    // Log only the opaque Next.js digest — the raw error may carry decrypted PII.
    console.error("Application error", error.digest)
  }, [error.digest])

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-foreground mb-2">Something went wrong</h2>
        <p className="text-sm text-muted-foreground mb-1">An unexpected error occurred.</p>
        <p className="text-sm text-muted-foreground mb-4">If this keeps happening, use the Feedback button to report it.</p>
        <button
          onClick={reset}
          className="rounded-[4px] bg-[#111111] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a1a1a] transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
