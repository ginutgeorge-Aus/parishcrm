import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Shared page header: an `h1` title with an optional breadcrumb/eyebrow above,
 * description and meta (badges, status) below, and an action row on the right.
 * Stacks on phone and wraps the action row so a 375px viewport never scrolls
 * sideways; from `sm:` the actions sit beside the title. Every dashboard page
 * should use this so each has exactly one `h1` (WCAG heading navigation); pages
 * not yet migrated still hand-roll theirs.
 * `className` goes on the root (use it for `mb-6`, `print:hidden`, etc.).
 */
export function PageHeader({
  title,
  eyebrow,
  description,
  meta,
  actions,
  badge,
  align = "center",
  className,
}: {
  title: ReactNode
  /** Breadcrumb or short label rendered above the title. */
  eyebrow?: ReactNode
  /** Supporting line under the title. */
  description?: ReactNode
  /** Badges / status rendered under the title. */
  meta?: ReactNode
  /** Buttons and links; wrap onto extra lines on phone. */
  actions?: ReactNode
  /** Status badge shown inline beside the title (outside the h1). */
  badge?: ReactNode
  /** Vertical alignment of the action row against tall left content on `sm:` and up. */
  align?: "center" | "start"
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:justify-between",
        align === "start" ? "sm:items-start" : "sm:items-center",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow}
        {badge ? (
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-foreground break-words">{title}</h1>
            {badge}
          </div>
        ) : (
          <h1 className="text-2xl font-semibold text-foreground break-words">{title}</h1>
        )}
        {description && <div className="mt-1 text-sm text-muted-foreground">{description}</div>}
        {meta}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 empty:hidden sm:gap-3">{actions}</div>}
    </div>
  )
}
