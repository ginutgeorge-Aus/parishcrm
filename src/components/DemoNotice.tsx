import { isDemoMode } from "@/lib/demoMode"

export function DemoNotice() {
  if (!isDemoMode()) return null
  return (
    <p className="mb-6 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
      Changes on this page are disabled in the live demo.
    </p>
  )
}
