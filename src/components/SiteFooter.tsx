import Link from "next/link"
import { cn } from "@/lib/utils"
import { PRODUCT_NAME } from "@/lib/settingsConstants"

// Shared site footer rendered by the dashboard, auth, and public layouts.
// Carries the copyright line, the product credit, and a link to the
// privacy policy so both are reachable from every page. Each layout passes its
// own wrapper classes via `className` to preserve existing spacing/borders.
// Server-rendered, so the copyright year is computed server-side (no hydration
// mismatch) and rolls over automatically.
export function SiteFooter({ churchName, className }: { churchName: string; className?: string }) {
  const year = new Date().getFullYear()
  return (
    <footer className={cn("text-center text-xs text-muted-foreground space-y-0.5", className)}>
      <p>&copy; {year} {churchName}. All rights reserved.</p>
      <p>
        Powered by {PRODUCT_NAME} &middot;{" "}
        <Link
          href="/privacy"
          className="inline-flex min-h-11 items-center px-2 underline hover:text-foreground"
        >
          Privacy Policy
        </Link>
      </p>
    </footer>
  )
}
