"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { createPrayerRequest } from "@/lib/actions/prayerRequest"

/**
 * Staff form to record a prayer request. "OK to share" records the requester's
 * consent only; no bulletin list uses it yet.
 */
export function PrayerRequestForm() {
  const [request, setRequest] = useState("")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [share, setShare] = useState(false)
  const [message, setMessage] = useState<{ error?: string; success?: string } | null>(null)
  const [pending, startTransition] = useTransition()

  /**
   * Create the request, then clear the form on success.
   * @param e form submit event
   */
  function submit(e: React.FormEvent) {
    e.preventDefault()
    setMessage(null)
    startTransition(async () => {
      try {
        const res = await createPrayerRequest({
          request,
          requesterName: name || null,
          requesterEmail: email || null,
          requesterPhone: phone || null,
          shareConsent: share,
        })
        if ("error" in res) {
          setMessage({ error: res.error })
          return
        }
        setRequest("")
        setName("")
        setEmail("")
        setPhone("")
        setShare(false)
        setMessage({ success: "Prayer request added" })
      } catch {
        setMessage({ error: "Something went wrong. Please try again." })
      }
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="pr-request">Prayer request</Label>
        <Textarea id="pr-request" required rows={4} maxLength={4000} value={request} onChange={(e) => setRequest(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pr-name">Requester name (optional)</Label>
        <Input id="pr-name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pr-email">Email (optional)</Label>
        <Input id="pr-email" type="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pr-phone">Phone (optional)</Label>
        <Input id="pr-phone" type="tel" maxLength={30} value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2 sm:min-h-0">
        <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} className="size-4" />
        OK to share (the requester agreed; recorded only, no bulletin list ships yet)
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending || request.trim() === ""} className="min-h-11 sm:min-h-0">
          {pending ? "Adding…" : "Add prayer request"}
        </Button>
        <FormFeedback state={message} />
      </div>
    </form>
  )
}
