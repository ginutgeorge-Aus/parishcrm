"use client"

import { useState, useTransition, useEffect } from "react"
import { setVolunteerView, regenerateVolunteerToken } from "@/lib/actions/eventAccess"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"

type Props = { eventId: number; slug: string; initialToken: string | null }

export function VolunteerViewToggle({ eventId, slug, initialToken }: Props) {
  const [token, setToken] = useState<string | null>(initialToken)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Read the browser origin only after mount. This is a client component, but
  // Next.js also server-renders it, where `window` is undefined — reading it at
  // render time would crash SSR. Deferring to an effect keeps SSR safe; the
  // first client render matches the server (empty origin → relative URL), so no
  // hydration mismatch, then the effect fills in the absolute origin.
  const [origin, setOrigin] = useState("")
  // Syncing a browser-only value (window.origin) into state after mount is the
  // intended SSR-safe pattern; the lint rule's blanket "no setState in effect"
  // is a false positive here (the alternative — a lazy initializer — would read
  // window during hydration and cause a mismatch).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setOrigin(window.location.origin), [])

  const link = token ? `${origin}/e/${slug}/crew/${token}` : null

  const toggle = () =>
    startTransition(async () => {
      setError(null)
      try {
        const res = await setVolunteerView(eventId, token === null)
        if ("error" in res) setError(res.error)
        else setToken(res.token)
      } catch {
        setError("Could not update volunteer view. Please try again.")
      }
    })

  async function handleRegenerate() {
    setError(null)
    const res = await regenerateVolunteerToken(eventId)
    if ("error" in res) return res
    setToken(res.token)
    setCopied(false)
  }

  const copy = async () => {
    if (!link) return
    await navigator.clipboard.writeText(link)
    setCopied(true)
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 mb-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-foreground">Volunteer view</p>
          <p className="text-sm text-muted-foreground">
            Share a no-login link showing fill rate + bookings.
          </p>
        </div>
        <Button variant={token ? "secondary" : "default"} size="sm" onClick={toggle} disabled={isPending}>
          {token ? "Turn off" : "Turn on"}
        </Button>
      </div>

      {link && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1"
          />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </Button>
            <DeleteConfirmButton
              onConfirm={handleRegenerate}
              title="Regenerate the link?"
              description="The old link will stop working."
              triggerLabel="Regenerate"
              triggerVariant="outline"
              triggerSize="sm"
              confirmLabel="Regenerate"
              pendingLabel="Regenerating…"
            />
          </div>
        </div>
      )}

      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}
