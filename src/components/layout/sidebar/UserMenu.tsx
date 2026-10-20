"use client"

import Link from "next/link"
import { useSession } from "next-auth/react"
import { ChevronsUpDown, HelpCircle, LogOut, MonitorSmartphone } from "lucide-react"
import { logout } from "@/lib/actions/session"
import { cn } from "@/lib/utils"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

/** "OFFICE_ADMIN" → "Office admin"; undefined → "". */
export function formatRole(role?: string): string {
  if (!role) return ""
  const words = role.toLowerCase().split("_")
  return [words[0][0].toUpperCase() + words[0].slice(1), ...words.slice(1)].join(" ")
}

/**
 * Sidebar footer chip (avatar, name, role) opening a menu with My Account,
 * Help and Sign out. On the collapsed rail only the avatar shows, with a
 * tooltip.
 */
export function UserMenu({ collapsed }: Readonly<{ collapsed: boolean }>) {
  const { data: session } = useSession()
  const name = session?.user?.name ?? ""
  const role = formatRole(session?.user?.role)
  const initial = (name.trim()[0] ?? "?").toUpperCase()

  const trigger = (
    <DropdownMenuTrigger
      aria-label="Account menu"
      className={cn(
        "flex w-full items-center gap-3 rounded-lg text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        collapsed ? "justify-center p-1.5" : "px-2 py-2"
      )}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary" aria-hidden="true">
        {initial}
      </span>
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-foreground">{name}</span>
            <span className="block truncate text-xs text-muted-foreground">{role}</span>
          </span>
          <ChevronsUpDown className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </>
      )}
    </DropdownMenuTrigger>
  )

  return (
    <DropdownMenu>
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side="right">{name || "Account"}</TooltipContent>
        </Tooltip>
      ) : trigger}
      <DropdownMenuContent side={collapsed ? "right" : "top"} align="start" className="w-56">
        {name ? <DropdownMenuLabel className="truncate">{name}</DropdownMenuLabel> : null}
        <DropdownMenuItem asChild>
          <Link href="/account"><MonitorSmartphone aria-hidden="true" />My Account</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/help"><HelpCircle aria-hidden="true" />Help</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => logout()}>
          <LogOut aria-hidden="true" />Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
