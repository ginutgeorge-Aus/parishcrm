"use client"

import { useMemo } from "react"
import Image from "next/image"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { Bell, Inbox, Menu, Plus, Settings, UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { FeedbackDialog } from "@/components/layout/FeedbackDialog"
import { useShell } from "@/components/layout/ShellContext"
import { buildQuickAddItems } from "@/components/layout/topbar/quickAdd"
import { isAdmin } from "@/lib/roleGuard"
import type { FeatureKey } from "@/lib/features"
import type { UserRole } from "@/lib/generated/prisma/enums"

/**
 * Sticky bar above page content: hamburger + crest + church name on mobile,
 * "+ New" quick-add menu, then Feedback, notifications bell and (admins)
 * Settings on the right.
 */
export function TopBar({
  churchName,
  role: serverRole,
  pendingUpdates = 0,
  membershipPending = 0,
  features,
}: Readonly<{
  churchName: string
  /** Server-known role, so admin/quick-add controls render on first paint; falls back to the client session. */
  role?: UserRole
  pendingUpdates?: number
  membershipPending?: number
  /** Enabled features (array: Sets don't cross the server→client boundary); omitted = all on. */
  features?: FeatureKey[]
}>) {
  const { data: session } = useSession()
  const role = serverRole ?? session?.user?.role
  const { mobileOpen, setMobileOpen, menuButtonRef, drawerId } = useShell()

  const featureSet = useMemo(() => (features ? new Set(features) : undefined), [features])
  const quickAdd = useMemo(() => buildQuickAddItems(role, featureSet), [role, featureSet])

  const notices = [
    { href: "/families/updates", label: "Family Updates", icon: Inbox, count: pendingUpdates },
    { href: "/memberships", label: "Membership Forms", icon: UserPlus, count: membershipPending },
  ].filter((n) => n.count > 0)
  const pending = notices.reduce((sum, n) => sum + n.count, 0)

  return (
    <TooltipProvider>
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-card px-4 print:hidden md:px-8">
        <button
          ref={menuButtonRef}
          onClick={() => setMobileOpen(true)}
          className="-ml-2.5 p-2.5 text-muted-foreground hover:text-foreground md:hidden"
          aria-label="Open menu"
          aria-expanded={mobileOpen}
          aria-controls={drawerId}
        >
          <Menu className="w-5 h-5" />
        </button>
        <span className="flex min-w-0 items-center gap-2 md:hidden">
          {/* eslint-disable-next-line no-restricted-syntax -- white backdrop is intentional: crest artwork, must stay white in dark mode */}
          <span className="flex items-center rounded bg-white p-0.5">
            <Image src="/api/branding/crest" alt="" width={128} height={145} className="h-8 w-auto" unoptimized />
          </span>
          <span className="truncate font-display text-base font-semibold tracking-tight">{churchName}</span>
        </span>

        {quickAdd.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-label="New" className="ml-auto md:ml-0">
                <Plus aria-hidden="true" />
                <span className="hidden md:inline">New</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" collisionPadding={8}>
              {quickAdd.map(({ href, label, icon: Icon }) => (
                <DropdownMenuItem key={href} asChild>
                  <Link href={href}><Icon aria-hidden="true" />{label}</Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <div className={quickAdd.length > 0 ? "flex items-center gap-2 md:ml-auto" : "ml-auto flex items-center gap-2"}>
          <FeedbackDialog />
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="relative"
                    aria-label={pending > 0 ? `Notifications (${pending} pending)` : "Notifications"}
                  >
                    <Bell aria-hidden="true" />
                    {pending > 0 ? (
                      <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-destructive" aria-hidden="true" />
                    ) : null}
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">Notifications</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" collisionPadding={8} className="w-64">
              <DropdownMenuLabel>Needs attention</DropdownMenuLabel>
              {notices.length === 0 ? (
                <p className="px-2 py-3 text-sm text-muted-foreground">You&apos;re all caught up.</p>
              ) : (
                notices.map(({ href, label, icon: Icon, count }) => (
                  <DropdownMenuItem key={href} asChild>
                    <Link href={href}>
                      <Icon aria-hidden="true" />
                      <span className="flex-1">{label}</span>
                      <span className="rounded-full bg-warning px-2 py-0.5 text-xs font-semibold text-warning-foreground">{count}</span>
                    </Link>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {isAdmin(role) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button asChild variant="outline" size="icon" className="hidden md:inline-flex">
                  <Link href="/settings" aria-label="Settings"><Settings aria-hidden="true" /></Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Settings</TooltipContent>
            </Tooltip>
          )}
        </div>
      </header>
    </TooltipProvider>
  )
}
