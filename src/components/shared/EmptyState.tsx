import Link from "next/link"
import type { LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/** One call-to-action link shown under an empty state. */
export type EmptyStateAction = {
  label: string
  href: string
  /** First action is the primary one by default; later ones render outlined. */
  variant?: "default" | "outline"
}

/**
 * Shared empty-state block for list pages: icon, title, short description and
 * optional action links. Callers decide which actions the viewer may see (role
 * checks live at the call site), so a read-only role just gets the text.
 *
 * Use one of two flavours:
 * - "no data yet" — explain what goes here and offer the primary action
 *   (Add person, Import CSV…)
 * - "no matches" — filters hid everything; offer a Clear filters link
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  actions = [],
  className,
}: Readonly<{
  icon?: LucideIcon
  title: string
  description?: string
  actions?: EmptyStateAction[]
  className?: string
}>) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-lg border border-dashed border-border bg-card px-4 py-10 text-center sm:px-6 sm:py-12",
        className
      )}
    >
      {Icon && (
        <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-muted" aria-hidden="true">
          <Icon className="size-6 text-muted-foreground" />
        </div>
      )}
      <p className="font-medium text-foreground">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {actions.length > 0 && (
        <div className="mt-5 flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:justify-center print:hidden">
          {actions.map((a, i) => (
            <Button
              key={a.href}
              asChild
              variant={a.variant ?? (i === 0 ? "default" : "outline")}
              className="min-h-11 sm:min-h-0"
            >
              <Link href={a.href}>{a.label}</Link>
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
