"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"

// Segment error boundary for the print pages (/AUDIT-073). Log only the opaque
// digest — print views decrypt member/financial data and the raw error may carry it.
export default function PrintError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Print page error", error.digest)
  }, [error.digest])

  return (
    <div className="flex min-h-screen items-center justify-center p-6 print:hidden">
      <div className="text-center">
        <h2 className="text-lg font-semibold text-foreground mb-2">Something went wrong</h2>
        <p className="text-sm text-muted-foreground mb-4">This document couldn&apos;t be generated.</p>
        <Button onClick={reset}>Try again</Button>
      </div>
    </div>
  )
}
