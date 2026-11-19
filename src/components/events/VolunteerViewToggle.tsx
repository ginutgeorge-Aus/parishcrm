"use client"

import { useState, useTransition, useEffect } from "react"
import { setVolunteerView, regenerateVolunteerToken } from "@/lib/actions/eventAccess"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"

function RegenerateButton({ onConfirm }: Readonly<{ onConfirm: () => Promise<{ error: string } | undefined> }>) {
  return (
    <DeleteConfirmButton
      onConfirm={onConfirm}
      title="Regenerate the link?"
      description="The old link will stop working."
      triggerLabel="Regenerate"
      triggerVariant="outline"
      triggerSize="sm"
      confirmLabel="Regenerate"
      pendingLabel="Regenerating…"
    />
  )
}

type Props = { eventId: number; slug: string; initialEnabled: boolean }

/**
 * Volunteer-view switch. Only a digest of the link token is stored, so the link is shown once, right
 * after it is created or regenerated; afterwards the admin must regenerate to get a new one.
 * @param props event id, slug, and whether the view is currently on
 */
export function VolunteerViewToggle({ eventId, slug, initialEnabled }: Readonly<Props>) {
  // `token` is only set in this session right after creating/regenerating; `enabled` survives reloads.
  const [enabled, setEnabled] = useState(initialEnabled)
  const [token, setToken] = useState<string | null>(null)
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
        const res = await setVolunteerView(eventId, !enabled)
        if ("error" in res) setError(res.error)
        else {
          setToken(res.token)
          setEnabled(res.token !== null)
          setCopied(false)
        }
      } catch {
        setError("Could not update volunteer view. Please try again.")
      }
    })

  async function handleRegenerate() {
    setError(null)
    const res = await regenerateVolunteerToken(eventId)
    if ("error" in res) return res
    setToken(res.token)
    setEnabled(true)
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
        <Button variant={enabled ? "secondary" : "default"} size="sm" onClick={toggle} disabled={isPending}>
          {enabled ? "Turn off" : "Turn on"}
        </Button>
      </div>

      {enabled && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          {link ? (
            <Input
              readOnly
              value={link}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1"
            />
          ) : (
            <p className="flex-1 text-sm text-muted-foreground">
              The link is active. For security it is shown only when created: regenerate it to get a new one.
            </p>
          )}
          <div className="flex gap-2">
            {link && (
              <Button variant="outline" size="sm" onClick={copy}>
                {copied ? "Copied" : "Copy"}
              </Button>
            )}
            <RegenerateButton onConfirm={handleRegenerate} />
          </div>
        </div>
      )}
      {link && (
        <p className="mt-2 text-xs text-muted-foreground">
          Copy this link now. It is shown only once; if you lose it, regenerate to get a new one.
        </p>
      )}

      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}
