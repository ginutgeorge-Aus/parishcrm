"use client"

import { useActionState, useState } from "react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { MAX_MESSAGE_BODY, MAX_MESSAGE_SUBJECT } from "@/lib/groups"
import type { ActionResult } from "@/lib/actions/types"

/**
 * Compose form for a group email: subject + plain-text body. The send action
 * redirects to the history page on success, so only errors render here.
 * @param action `sendGroupMessage` bound to the group id
 * @param canSend false when no member can receive (button is aria-disabled with a visible reason)
 */
export function GroupMessageForm({
  action,
  canSend,
}: Readonly<{ action: (_prev: ActionResult, formData: FormData) => Promise<ActionResult>; canSend: boolean }>) {
  const [state, formAction, isPending] = useActionState(action, undefined)
  // Controlled: React 19 resets uncontrolled fields after a form action, which would wipe the draft on an error.
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  return (
    <form action={formAction} className="max-w-2xl space-y-4">
      <FormFeedback state={state} />
      <div className="space-y-1">
        <Label htmlFor="subject">Subject</Label>
        <Input id="subject" name="subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={MAX_MESSAGE_SUBJECT} required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="body">Message</Label>
        <Textarea id="body" name="body" value={body} onChange={(e) => setBody(e.target.value)} rows={10} maxLength={MAX_MESSAGE_BODY} required />
        <p className="text-xs text-muted-foreground">Plain text. Each person is greeted by first name and the church name is added below.</p>
      </div>
      {!canSend && (
        <p id="send-blocked" className="text-sm text-muted-foreground">
          No member can receive this email: every member is opted out or has no address.
        </p>
      )}
      {/* aria-disabled (not disabled) keeps the button focusable so screen-reader users hear why it is off; the click is blocked below. */}
      <Button
        type="submit"
        aria-disabled={isPending || !canSend}
        aria-describedby={canSend ? undefined : "send-blocked"}
        onClick={(e) => { if (isPending || !canSend) e.preventDefault() }}
        className="w-full sm:w-auto aria-disabled:pointer-events-none aria-disabled:opacity-50"
      >
        {isPending ? "Sending…" : "Send email"}
      </Button>
    </form>
  )
}
