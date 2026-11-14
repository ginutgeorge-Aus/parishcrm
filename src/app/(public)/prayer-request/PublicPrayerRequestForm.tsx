"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { submitPublicPrayerRequest } from "@/lib/actions/publicPrayerRequest"

/**
 * Public prayer request form: request text, optional name and contact, and an
 * "OK to share" consent tick. Includes a hidden honeypot field. After a
 * successful send the form is replaced by the thank-you message.
 */
export function PublicPrayerRequestForm() {
  const [request, setRequest] = useState("")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [share, setShare] = useState(false)
  const [website, setWebsite] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  /**
   * Send the request; show the thank-you on success, the error otherwise.
   * @param e form submit event
   */
  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      try {
        const res = await submitPublicPrayerRequest({
          request,
          requesterName: name || null,
          requesterEmail: email || null,
          requesterPhone: phone || null,
          shareConsent: share,
          website,
        })
        if (res && "error" in res) setError(res.error)
        else setDone(res && "success" in res ? res.success : "Thank you. Your prayer request has been received.")
      } catch {
        setError("Something went wrong. Please try again.")
      }
    })
  }

  if (done) {
    return (
      <p role="status" className="rounded-lg border bg-card p-4 text-sm">
        {done}
      </p>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border bg-card p-4 sm:p-6">
      {/* Honeypot: hidden from people and assistive tech; a bot fills it. */}
      <Input
        type="text"
        name="website"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        className="absolute left-[-9999px]"
        aria-hidden="true"
      />
      <div className="space-y-1.5">
        <Label htmlFor="ppr-request">Your prayer request</Label>
        <Textarea id="ppr-request" required rows={6} maxLength={4000} value={request} onChange={(e) => setRequest(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ppr-name">Your name (optional)</Label>
        <Input id="ppr-name" autoComplete="name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ppr-email">Email (optional)</Label>
          <Input id="ppr-email" type="email" autoComplete="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ppr-phone">Phone (optional)</Label>
          <Input id="ppr-phone" type="tel" autoComplete="tel" maxLength={30} value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} className="mt-0.5 size-4" />
        <span>OK to share this request with the congregation. Leave unticked to keep it private to our pastors.</span>
      </label>
      <FormFeedback state={{ error }} />
      <Button type="submit" disabled={pending || request.trim() === ""} className="min-h-11 w-full sm:min-h-0 sm:w-auto">
        {pending ? "Sending…" : "Send prayer request"}
      </Button>
    </form>
  )
}
