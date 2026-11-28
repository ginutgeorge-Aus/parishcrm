"use client"

import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { LogOut } from "lucide-react"
import { logout } from "@/lib/actions/session"
import type { OrganiserHome } from "@/lib/organiserHome"

/**
 * Organiser top bar.
 * @param showEvents false hides the Events link while the events feature is off
 * @param showClasses false hides the Classes link while Sunday School is off
 * @param showGroups false hides the Groups link (TEACHER: classes only)
 * @param showRoster false hides the Roster link (only group-leader logins can use /my-roster)
 * @param home brand link label/target, resolved by the layout (`organiserHome`)
 */
export function OrganiserHeader({ showEvents = true, showClasses = true, showGroups = true, showRoster = true, home }: Readonly<{
  showEvents?: boolean
  showClasses?: boolean
  showGroups?: boolean
  showRoster?: boolean
  home: OrganiserHome
}>) {
  // Groups pages are not under "My Events"/"My Classes": use a neutral brand title there.
  const onGroups = usePathname()?.startsWith("/my-groups") ?? false
  return (
    <header className="flex flex-wrap items-center justify-between border-b bg-primary px-4 py-3 text-primary-foreground">
      <Link href={onGroups ? "/my-groups" : home.href} className="flex min-h-11 items-center gap-2">
        {/* eslint-disable-next-line no-restricted-syntax -- white backdrop is intentional: crest artwork, must stay white in dark mode */}
        <span className="rounded bg-white p-0.5">
          <Image src="/api/branding/crest" alt="" width={128} height={145} className="h-8 w-auto" unoptimized />
        </span>
        <span className="sr-only font-display text-lg font-semibold tracking-tight sm:not-sr-only">{onGroups ? "My Groups" : home.label}</span>
      </Link>
      <nav className="flex flex-wrap items-center gap-1 text-sm">
        {showEvents && (
          <Link href="/my-events" className="flex min-h-11 items-center rounded-md px-3 py-2 text-primary-foreground/80 hover:bg-white/10 hover:text-primary-foreground">
            Events
          </Link>
        )}
        {showClasses && (
          <Link href="/my-classes" className="flex min-h-11 items-center rounded-md px-3 py-2 text-primary-foreground/80 hover:bg-white/10 hover:text-primary-foreground">
            Classes
          </Link>
        )}
        {showGroups && (
          <Link href="/my-groups" className="flex min-h-11 items-center rounded-md px-3 py-2 text-primary-foreground/80 hover:bg-white/10 hover:text-primary-foreground">
            Groups
          </Link>
        )}
        {showRoster && (
          <Link href="/my-roster" className="flex min-h-11 items-center rounded-md px-3 py-2 text-primary-foreground/80 hover:bg-white/10 hover:text-primary-foreground">
            Roster
          </Link>
        )}
        <button
          onClick={() => logout()}
          aria-label="Sign out"
          className="flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm text-primary-foreground/80 hover:bg-white/10 hover:text-primary-foreground"
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </nav>
    </header>
  )
}
