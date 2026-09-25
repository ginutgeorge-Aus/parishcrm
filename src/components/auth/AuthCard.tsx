import type { ReactNode } from "react"
import Image from "next/image"

// Shared card chrome for the unauthenticated auth pages (forgot / reset).
// Previously the same class string was hand-rolled verbatim in each page.
// (Login renders its own logo inside a shadcn Card, so it doesn't use this.)
// churchName (from getChurchSettings) names the org in the logo alt text so
// screen-reader users hear the configured church, not a generic placeholder
//; falls back to "Church" when unset.
export function AuthCard({ children, churchName }: { children: ReactNode; churchName?: string }) {
  return (
    <div className="w-full max-w-sm space-y-6 rounded-lg border bg-card p-8 shadow-xs">
      <Image
        src="/api/branding/logo"
        alt={`${churchName || "Church"} logo`}
        width={512}
        height={466}
        priority
        unoptimized
        className="mx-auto h-auto w-40"
      />
      {children}
    </div>
  )
}
