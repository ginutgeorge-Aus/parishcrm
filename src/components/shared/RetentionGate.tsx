import type { ReactNode } from "react"
import { isWithinRetention } from "@/lib/retention"

/**
 * Renders a Delete control only when the record is past the 7-year ATO retention period. Inside it the
 * server refuses every delete, so show a muted note with the correction path instead of a dead button.
 * @param date Record date (same value the server guard checks).
 * @param children The Delete button, shown only outside the retention window.
 */
export function RetentionGate({ date, children }: Readonly<{ date: Date; children: ReactNode }>) {
  if (!isWithinRetention(date)) return <>{children}</>
  return (
    <span className="text-xs text-muted-foreground max-w-48">
      Kept for 7 years (ATO). Edit it to correct it; if its period is locked, an admin must unlock it first.
    </span>
  )
}
