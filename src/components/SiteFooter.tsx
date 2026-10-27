import Link from "next/link"
import { cn } from "@/lib/utils"
import { PRODUCT_NAME } from "@/lib/settingsConstants"

// Shared site footer rendered by the dashboard, auth, and public layouts.
// Carries the copyright line, the product credit, and a link to the
// privacy policy so both are reachable from every page. Each layout passes its
// own wrapper classes via `className` to preserve existing spacing/borders.
// Server-rendered, so the copyright year is computed server-side (no hydration
// mismatch) and rolls over automatically.
/**
 * Renders the shared site footer. `compactOnMobile` hides the copyright line
 * below the `sm` breakpoint so the footer collapses to the single credit +
 * privacy line on phones (dashboard).
 * @param churchName - Church name shown in the copyright line.
 * @param className - Wrapper classes supplied by the host layout.
 * @param compactOnMobile - Hide the copyright line below `sm` (keeps the privacy link).
 */
export function SiteFooter({
  churchName,
  className,
  compactOnMobile = false,
}: Readonly<{ churchName: string; className?: string; compactOnMobile?: boolean }>) {
  const year = new Date().getFullYear()
  return (
    <footer className={cn("text-center text-xs text-muted-foreground space-y-0.5", className)}>
      <p className={compactOnMobile ? "hidden sm:block" : undefined}>&copy; {year} {churchName}. All rights reserved.</p>
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
