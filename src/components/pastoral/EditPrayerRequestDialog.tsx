"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { updatePrayerRequest, type PrayerRequestView } from "@/lib/actions/prayerRequest"

/** Shown when the row changed since the dialog opened (the action's stale error). */
const STALE_MESSAGE = "This request changed since you opened it. Close this dialog, reload the page and try again."

/**
 * "Edit" button plus a dialog to change a prayer request's text, requester
 * contact and "OK to share" flag. Sends the `updatedAt` captured when the dialog
 * opened as `expectedUpdatedAt`, so a save from an out-of-date row is rejected (optimistic
 * concurrency). The linked member is kept as is. Same gate as the other row
 * actions: the list only renders for ADMIN | PASTOR and the action re-checks.
 * @param request the row being edited (must be readable, see `unreadable`)
 * @param disabled disables the trigger while a sibling action runs
 * @param onSaved called with the action's success message after a save
 */
export function EditPrayerRequestDialog({
  request: r,
  disabled,
  onSaved,
}: Readonly<{ request: PrayerRequestView; disabled?: boolean; onSaved: (message: string) => void }>) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(r.request)
  const [name, setName] = useState(r.requesterName ?? "")
  const [email, setEmail] = useState(r.requesterEmail ?? "")
  const [phone, setPhone] = useState(r.requesterPhone ?? "")
  const [share, setShare] = useState(r.shareConsent)
  const [personId, setPersonId] = useState(r.personId)
  const [revision, setRevision] = useState(r.updatedAt)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const id = `pr-edit-${r.id}`

  /**
   * Reset the fields (and the captured revision) to the row's current values
   * whenever the dialog opens. Closing is ignored while a save is pending.
   * @param next whether the dialog is opening
   */
  function onOpenChange(next: boolean) {
    if (!next && pending) return
    if (next) {
      setPersonId(r.personId)
      setRevision(r.updatedAt)
      setText(r.request)
      setName(r.requesterName ?? "")
      setEmail(r.requesterEmail ?? "")
      setPhone(r.requesterPhone ?? "")
      setShare(r.shareConsent)
      setError(null)
    }
    setOpen(next)
  }

  /**
   * Save the edit; close on success, show the error (stale conflict included) otherwise.
   * @param e form submit event
   */
  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      try {
        const res = await updatePrayerRequest(r.id, {
          request: text,
          requesterName: name || null,
          requesterEmail: email || null,
          requesterPhone: phone || null,
          personId,
          shareConsent: share,
          expectedUpdatedAt: revision,
        })
        if (res && "error" in res) {
          setError(res.error.startsWith("This request changed") ? STALE_MESSAGE : res.error)
          return
        }
        onSaved(res?.success ?? "Prayer request saved")
        setOpen(false)
      } catch {
        setError("Something went wrong. Please try again.")
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={disabled} className="min-h-11 sm:min-h-0">
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit prayer request</DialogTitle>
          <DialogDescription>
            Changing the wording of a shared request makes it private again until the requester agrees to the new wording.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-request`}>Prayer request</Label>
            <Textarea id={`${id}-request`} required disabled={pending} rows={4} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-name`}>Requester name (optional)</Label>
            <Input id={`${id}-name`} disabled={pending} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-email`}>Email (optional)</Label>
            <Input id={`${id}-email`} disabled={pending} type="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-phone`}>Phone (optional)</Label>
            <Input id={`${id}-phone`} disabled={pending} type="tel" maxLength={30} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-0">
            <input type="checkbox" disabled={pending} checked={share} onChange={(e) => setShare(e.target.checked)} className="size-4" />
            OK to share (the requester agreed)
          </label>
          <FormFeedback state={{ error }} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" disabled={pending} className="min-h-11 sm:min-h-0" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || text.trim() === ""} className="min-h-11 sm:min-h-0">
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
