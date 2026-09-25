"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"

// Segment error boundary for the auth pages (/AUDIT-073). Log only the opaque
// digest — these pages are unauthenticated and an error could echo a submitted
// credential or token.
export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Auth page error", error.digest)
  }, [error.digest])

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="text-center">
        <h1 className="text-lg font-semibold text-foreground mb-2">Something went wrong</h1>
        <p className="text-sm text-muted-foreground mb-4">An unexpected error occurred. Please try again.</p>
        <Button onClick={reset}>Try again</Button>
      </div>
    </div>
  )
}
