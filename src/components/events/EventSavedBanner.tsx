"use client"

import { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { CheckCircle2 } from "lucide-react"

// Success flash shown after updateEvent redirects back to the edit page with
// ?saved=1. Auto-dismisses and strips the query param so a refresh doesn't
// re-show a stale "saved" — the redirect-to-self otherwise gives no signal.
export function EventSavedBanner() {
  const [show, setShow] = useState(true)
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    // Drop ?saved=1 immediately so reload/back doesn't replay the banner.
    router.replace(pathname)
    const t = setTimeout(() => setShow(false), 4000)
    return () => clearTimeout(t)
  }, [router, pathname])

  if (!show) return null

  return (
    <div
      role="status"
      className="mb-4 flex items-center gap-2 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success"
    >
      <CheckCircle2 className="h-4 w-4 shrink-0" />
      Event saved.
    </div>
  )
}
