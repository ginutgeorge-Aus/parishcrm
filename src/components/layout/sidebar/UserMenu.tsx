"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { unstable_rethrow } from "next/navigation"
import { useSession } from "next-auth/react"
import { ChevronsUpDown, CircleAlert, HelpCircle, LogOut, MonitorSmartphone } from "lucide-react"
import { logout } from "@/lib/actions/session"
import { cn } from "@/lib/utils"
import { ROLE_LABELS } from "@/lib/roleLabels"
import type { UserRole } from "@/lib/generated/prisma/enums"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

/** Display label for a role (same as the Users page); undefined → "". */
export function formatRole(role?: string): string {
  if (!role) return ""
  return ROLE_LABELS[role as UserRole] ?? role
}

/**
 * Sidebar footer chip (avatar, name, role) opening a menu with My Account,
 * Help and Sign out. On the collapsed rail only the avatar shows, with a
 * tooltip. `onNavigate` runs when a link item is picked (closes the mobile drawer).
 */
export function UserMenu({ collapsed, onNavigate }: Readonly<{ collapsed: boolean; onNavigate?: () => void }>) {
  const { data: session } = useSession()
  const name = session?.user?.name ?? ""
  const role = formatRole(session?.user?.role)
  const initial = (name.trim()[0] ?? "?").toUpperCase()
  const [signOutFailed, setSignOutFailed] = useState(false)
  const [, startTransition] = useTransition()

  /**
   * Signs out. A successful logout() rejects with Next's redirect control-flow
   * error — let it through so navigation happens; a genuine failure (session
   * revoke failed) shows inline instead of failing silently.
   */
  function signOut() {
    setSignOutFailed(false)
    startTransition(async () => {
      try {
        await logout()
      } catch (err) {
        unstable_rethrow(err)
        setSignOutFailed(true)
      }
    })
  }

  const accountLabel = name ? `Account menu: ${name}` : "Account menu"
  const trigger = (
    <DropdownMenuTrigger
      // Expanded, the visible name + role is the accessible name; collapsed shows only the initial.
      aria-label={collapsed ? accountLabel : undefined}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg text-left text-sm transition-colors hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
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
    <>
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
          <Link href="/account" onClick={onNavigate}><MonitorSmartphone aria-hidden="true" />My Account</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/help" onClick={onNavigate}><HelpCircle aria-hidden="true" />Help</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut}>
          <LogOut aria-hidden="true" />Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    {signOutFailed && (collapsed ? (
      // 64px rail: a compact icon stays visible; the full message is screen-reader text + tooltip.
      <p role="alert" title="Sign out failed. Try again." className="flex justify-center pt-1 text-destructive">
        <CircleAlert className="size-4" aria-hidden="true" />
        <span className="sr-only">Sign out failed. Try again.</span>
      </p>
    ) : (
      <p role="alert" className="px-2 pt-1 text-xs text-destructive">Sign out failed. Try again.</p>
    ))}
    </>
  )
}
