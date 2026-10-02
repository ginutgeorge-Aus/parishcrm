import { isDemoMode } from "@/lib/demoMode"

// Site-wide, non-dismissable. Hidden when printing (receipts, letters).
export function DemoBanner() {
  if (!isDemoMode()) return null
  return (
    <div role="status" className="print:hidden w-full bg-warning/15 border-b border-warning/40 px-4 py-2 text-center text-sm text-foreground">
      Live demo — shared sandbox, resets nightly. Don&apos;t enter real data.
    </div>
  )
}
