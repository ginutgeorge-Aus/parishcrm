"use client"

import { useState } from "react"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { TurnstileWidget } from "@/components/public/TurnstileWidget"

// Optional Cloudflare Turnstile. Renders only when a site key is
// configured at build time; otherwise the form behaves exactly as before
// (honeypot + timing token). Server verification is the real gate — this is UX.
import { TURNSTILE_SITE_KEY } from "@/lib/appConfig"

type SoldOutType = { id: number; name: string }

type Props = {
  slug: string
  soldOutTypes: SoldOutType[]
  // True when every ticket type is sold out (no active registration form above).
  // When false, only some types are sold out — clarify the copy ( I1).
  allSoldOut: boolean
  formToken: string
}

export function WaitlistForm({ slug, soldOutTypes, allSoldOut, formToken }: Props) {
  const [ticketTypeId, setTicketTypeId] = useState<number>(soldOutTypes[0]?.id ?? 0)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  // Honeypot: off-screen, aria-hidden, not tabbable. Real users
  // never see or fill it; scripted bots that fill every input trip it.
  const [website, setWebsite] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Turnstile: empty until the widget solves; only gates submit
  // when enabled (no site key configured = always solved, no gating).
  const [turnstileToken, setTurnstileToken] = useState("")
  const turnstileSolved = !TURNSTILE_SITE_KEY || turnstileToken.length > 0

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!turnstileSolved) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/events/${slug}/waitlist`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticketTypeId, name, email, website, formToken, turnstileToken }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Failed to join waitlist"); return }
      setSuccess(true)
    } catch {
      setError("Network error. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  if (success) {
    return (
      <div role="status" className="bg-success/10 border border-success/40 rounded-lg p-4 text-center text-success text-sm">
        You have been added to the waitlist. We will notify you if a spot becomes available.
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-card border border-border rounded-lg p-4 sm:p-6 flex flex-col gap-4 mt-4"
    >
      <h2 className="text-base font-bold text-foreground">
        {allSoldOut ? "Join the Waitlist" : "Some ticket types are sold out — join the waitlist"}
      </h2>
      <p className="text-sm text-muted-foreground">
        {allSoldOut
          ? "This event is sold out. Add your name to the waitlist and we’ll let you know if a spot opens up."
          : "The ticket type below is sold out. Add your name to the waitlist and we’ll let you know if a spot opens up."}
      </p>

      {/* Honeypot: off-screen, aria-hidden, not tabbable. */}
      <div aria-hidden="true" className="absolute h-px w-px overflow-hidden [clip-path:inset(50%)]">
        <label htmlFor="wl-website">Website</label>
        <Input
          id="wl-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={e => setWebsite(e.target.value)}
        />
      </div>

      {soldOutTypes.length > 1 && (
        <div>
          <label htmlFor="wl-ticketType" className="text-xs text-muted-foreground">Ticket type *</label>
          <Select
            required
            value={String(ticketTypeId)}
            onValueChange={(v: string) => setTicketTypeId(Number(v))}
          >
            <SelectTrigger id="wl-ticketType" className="w-full mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {soldOutTypes.map(tt => (
                <SelectItem key={tt.id} value={String(tt.id)}>{tt.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div>
        <label htmlFor="wl-name" className="text-xs text-muted-foreground">Name *</label>
        <Input
          id="wl-name"
          required
          value={name}
          onChange={e => setName(e.target.value)}
          className="mt-1"
        />
      </div>

      <div>
        <label htmlFor="wl-email" className="text-xs text-muted-foreground">Email *</label>
        <Input
          id="wl-email"
          required
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          className="mt-1"
        />
      </div>

      <TurnstileWidget onToken={setTurnstileToken} />

      <FormFeedback state={{ error }} />

      <button
        type="submit"
        disabled={submitting || !turnstileSolved}
        aria-busy={submitting}
        className="w-full bg-primary text-primary-foreground rounded-lg py-3 font-semibold text-sm disabled:opacity-50"
      >
        {submitting ? "Joining…" : "Join Waitlist"}
      </button>
    </form>
  )
}
