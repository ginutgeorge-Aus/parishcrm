"use client"

import Image from "next/image"
import Link from "next/link"
import { LogOut } from "lucide-react"
import { logout } from "@/lib/actions/session"

export function OrganiserHeader() {
  return (
    <header className="flex items-center justify-between border-b bg-primary px-4 py-3 text-primary-foreground">
      <Link href="/my-events" className="flex items-center gap-2">
        <span className="rounded bg-white p-0.5">
          <Image src="/api/branding/crest" alt="" width={128} height={145} className="h-8 w-auto" unoptimized />
        </span>
        <span className="font-display text-lg font-semibold tracking-tight">My Events</span>
      </Link>
      <button
        onClick={() => logout()}
        aria-label="Sign out"
        className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-primary-foreground/80 hover:bg-white/10 hover:text-primary-foreground"
      >
        <LogOut className="h-4 w-4" />
        Sign out
      </button>
    </header>
  )
}
