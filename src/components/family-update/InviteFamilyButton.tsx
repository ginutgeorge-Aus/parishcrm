"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog"
import { sendFamilyUpdateInvite } from "@/lib/actions/familyUpdate"

export function InviteFamilyButton({ familyId, defaultEmail }: { familyId: number; defaultEmail: string }) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState(defaultEmail)
  const [msg, setMsg] = useState<{ ok?: string; err?: string } | null>(null)
  const [pending, start] = useTransition()
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear the success auto-close timer on unmount so a stale one-shot timer can't
  // fire after the component is gone.
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])

  // Any open/close cancels a pending auto-close, so reopening the dialog within
  // the 2.5s window is never force-closed mid-edit.
  function handleOpenChange(next: boolean) {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
    setOpen(next)
  }

  function send() {
    setMsg(null)
    if (!email.trim() || !email.includes("@")) {
      setMsg({ err: "Enter a valid email" })
      return
    }
    start(async () => {
      const res = await sendFamilyUpdateInvite(familyId, email)
      if (res && "error" in res) setMsg({ err: res.error })
      else {
        setMsg({ ok: "Invite sent" })
        closeTimer.current = setTimeout(() => setOpen(false), 2500)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-11 sm:h-7 any-pointer-coarse:h-11">Invite family to update details</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send update invite</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Emails a secure link (valid 14 days). The family&apos;s changes land in your review queue.
        </p>
        <div className="space-y-2">
          <Label htmlFor="invite-email">Send to</Label>
          <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        {msg?.err && <p role="alert" className="text-sm text-destructive">{msg.err}</p>}
        {msg?.ok && <p role="status" aria-live="polite" className="text-sm text-success">{msg.ok}</p>}
        <DialogFooter>
          <Button onClick={send} disabled={pending}>{pending ? "Sending…" : "Send invite"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
