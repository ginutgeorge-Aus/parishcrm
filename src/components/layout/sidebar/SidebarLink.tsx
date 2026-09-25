import Link from "next/link"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { NavItem } from "@/components/layout/sidebar/navData"

export function SidebarLink({
  item,
  active,
  collapsed,
  onNavigate,
}: {
  item: NavItem
  active: boolean
  collapsed: boolean
  onNavigate: () => void
}) {
  const { href, label, icon: Icon, badge } = item

  const link = (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? (badge ? `${label} (${badge})` : label) : undefined}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-3 rounded-md text-sm transition-colors border-l-2",
        collapsed ? "justify-center px-2 py-2" : "px-3 py-2",
        active
          ? "border-gold bg-white/10 font-medium text-gold"
          : "border-transparent text-primary-foreground/70 hover:bg-white/10 hover:text-primary-foreground"
      )}
    >
      <span className="relative shrink-0">
        <Icon className="w-4 h-4" aria-hidden="true" />
        {collapsed && badge ? (
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-warning" aria-hidden="true" />
        ) : null}
      </span>
      {!collapsed && (
        <>
          <span className="flex-1">{label}</span>
          {badge ? (
            <span className="ml-auto rounded-full bg-warning px-2 py-0.5 text-xs font-semibold text-warning-foreground">
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
