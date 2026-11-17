"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { resetVenueCalendarLink } from "@/lib/actions/venueCalendar"

/**
 * Committee calendar link: create or reset it (ADMIN). Only a digest of the link is stored, so the URL is
 * shown once, right after it is created; resetting kills the old link and shows a new one.
 * @param props whether a link exists, and whether the viewer may create/reset
 */
export function CalendarLinkBox({ active, canReset }: Readonly<{ active: boolean; canReset: boolean }>) {
  const router = useRouter()
  const [url, setUrl] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Copy the link to the clipboard; on failure select the input so the user can copy by hand. */
  async function copy() {
    if (!url) return
    setError(null)
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      inputRef.current?.focus()
      inputRef.current?.select()
      setError("Could not copy automatically: select the link and copy it.")
    }
  }

  /** Create or reset the link, then refresh the page so the new link shows. Returns an error result for the dialog. */
  async function reset() {
    const r = await resetVenueCalendarLink()
    if ("error" in r) return { error: r.error }
    setCopied(false)
    setError(null)
    setUrl(r.url)
    router.refresh()
    return undefined
  }

  return (
    <section className="space-y-2 rounded-lg border bg-card p-4">
      <h2 className="text-lg font-medium">Committee calendar link</h2>
      <p className="text-sm text-muted-foreground">
        Anyone with this link can see the booked dates (no login). It shows dates, times and purpose only.
      </p>
      {url ? (
        <div className="flex flex-wrap items-center gap-2">
          {/* basis-full on phones puts the long URL on its own row; min-w-0 lets the input scroll its text instead of widening the page. */}
          <Input
            ref={inputRef}
            readOnly
            value={url}
            aria-label="Calendar link"
            className="min-w-0 basis-full sm:basis-0 sm:flex-1"
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button type="button" variant="outline" onClick={copy}>Copy link</Button>
          {copied && <span role="status" className="text-sm text-muted-foreground">Copied</span>}
        </div>
      ) : (
        <p className="text-sm">
          {active
            ? "A calendar link is active. For security it is shown only when created: reset it to get a new one."
            : "No calendar link yet."}
        </p>
      )}
      {url && <p className="text-sm text-muted-foreground">Copy it now: this link is not shown again.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {canReset && (
        <DeleteConfirmButton
          title={active ? "Reset the calendar link?" : "Create the calendar link?"}
          description={
            active
              ? "The old link will stop working immediately. Share the new link with the committee."
              : "Creates a secret link anyone can use to view the booked dates."
          }
          triggerLabel={active ? "Reset link" : "Create link"}
          triggerVariant="outline"
          triggerSize="default"
          triggerClassName=""
          confirmLabel={active ? "Reset" : "Create"}
          pendingLabel="Working…"
          onConfirm={reset}
        />
      )}
    </section>
  )
}
