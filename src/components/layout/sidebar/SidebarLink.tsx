import Link from "next/link"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { NavItem } from "@/components/layout/sidebar/navData"

/**
 * One sidebar link with an optional count badge. With a badge, an item that
 * has an `attentionHref` links there (the narrower list the badge counts).
 * @param item the nav item
 * @param active whether this item is the current page
 * @param collapsed icon-rail mode
 * @param onNavigate called on click (closes the mobile drawer)
 */
export function SidebarLink({
  item,
  active,
  collapsed,
  onNavigate,
}: Readonly<{
  item: NavItem
  active: boolean
  collapsed: boolean
  onNavigate: () => void
}>) {
  const { href, label, icon: Icon, badge, badgeInformational } = item
  // Amber means "needs action"; informational counts get a neutral tone so a
  // long-lived one (unverified release checks) doesn't read as an alert.
  // A badge that counts a narrower list than the page (e.g. my due follow-ups)
  // links to that narrower view; active-state matching still uses `href`.
  const linkHref = badge && item.attentionHref ? item.attentionHref : href
  const dotTone = badgeInformational ? "bg-muted-foreground" : "bg-warning"
  const pillTone = badgeInformational ? "bg-muted text-muted-foreground" : "bg-warning text-warning-foreground"

  const link = (
    <Link
      href={linkHref}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? (badge ? `${label} (${badge})` : label) : undefined}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-3 rounded-lg text-sm transition-colors",
        collapsed ? "justify-center px-2 py-2" : "px-3 py-2",
        active
          ? "bg-gold/15 font-medium text-foreground shadow-[inset_3px_0_0_var(--color-gold)]"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      <span className="relative shrink-0">
        <Icon className="w-4 h-4" aria-hidden="true" />
        {collapsed && badge ? (
          <span className={cn("absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full", dotTone)} aria-hidden="true" />
        ) : null}
      </span>
      {!collapsed && (
        <>
          <span className="flex-1">{label}</span>
          {badge ? (
            <span className={cn("ml-auto rounded-full px-2 py-0.5 text-xs font-semibold", pillTone)}>
              {badge}
            </span>
          ) : null}
        </>
      )}
    </Link>
  )

  if (!collapsed) return link

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}
