"use client"

import Image from "next/image"
import Link from "next/link"
import { LogOut } from "lucide-react"
import { logout } from "@/lib/actions/session"

/**
 * Organiser top bar.
 * @param showEvents false hides the Events link while the events feature is off
 * @param showClasses false hides the Classes link while Sunday School is off
 */
export function OrganiserHeader({ showEvents = true, showClasses = true }: Readonly<{ showEvents?: boolean; showClasses?: boolean }>) {
  // With Events off the brand link must not point at the events notice: use the classes home.
  const brand = !showEvents && showClasses ? { label: "My Classes", href: "/my-classes" } : { label: "My Events", href: "/my-events" }
  return (
    <header className="flex items-center justify-between border-b bg-primary px-4 py-3 text-primary-foreground">
      <Link href={brand.href} className="flex items-center gap-2">
        {/* eslint-disable-next-line no-restricted-syntax -- white backdrop is intentional: crest artwork, must stay white in dark mode */}
        <span className="rounded bg-white p-0.5">
          <Image src="/api/branding/crest" alt="" width={128} height={145} className="h-8 w-auto" unoptimized />
        </span>
        <span className="sr-only font-display text-lg font-semibold tracking-tight sm:not-sr-only">{brand.label}</span>
      </Link>
      <nav className="flex items-center gap-1 text-sm">
        {showEvents && (
          <Link href="/my-events" className="rounded-md px-3 py-2 text-primary-foreground/80 hover:bg-white/10 hover:text-primary-foreground">
            Events
          </Link>
        )}
        {showClasses && (
          <Link href="/my-classes" className="rounded-md px-3 py-2 text-primary-foreground/80 hover:bg-white/10 hover:text-primary-foreground">
            Classes
          </Link>
        )}
        <button
          onClick={() => logout()}
          aria-label="Sign out"
          className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-primary-foreground/80 hover:bg-white/10 hover:text-primary-foreground"
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </nav>
    </header>
  )
}
