import Link from "next/link"
import { cn } from "@/lib/utils"

/**
 * One filter chip: a link, so the filter works without JS and is bookmarkable.
 * Full 44px tap height on phones, compact from `sm:` up. Shared by
 * /follow-ups and /prayer-requests.
 * @param href the filtered page URL
 * @param active whether this chip is the current filter (sets aria-current)
 */
export function FilterChip({ href, active, children }: Readonly<{ href: string; active: boolean; children: React.ReactNode }>) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "inline-flex min-h-11 items-center rounded-full border px-3 text-sm sm:min-h-0 sm:py-1",
        active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
      )}
    >
      {children}
    </Link>
  )
}
