"use client"

import { useActionState } from "react"
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
 * @param canSend false when no member can receive (disables the button)
 */
export function GroupMessageForm({
  action,
  canSend,
}: Readonly<{ action: (_prev: ActionResult, formData: FormData) => Promise<ActionResult>; canSend: boolean }>) {
  const [state, formAction, isPending] = useActionState(action, undefined)
  return (
    <form action={formAction} className="max-w-2xl space-y-4">
      <FormFeedback state={state} />
      <div className="space-y-1">
        <Label htmlFor="subject">Subject</Label>
        <Input id="subject" name="subject" maxLength={MAX_MESSAGE_SUBJECT} required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="body">Message</Label>
        <Textarea id="body" name="body" rows={10} maxLength={MAX_MESSAGE_BODY} required />
        <p className="text-xs text-muted-foreground">Plain text. Each person is greeted by first name and the church name is added below.</p>
      </div>
      <Button type="submit" disabled={isPending || !canSend} className="w-full sm:w-auto">
        {isPending ? "Sending…" : "Send email"}
      </Button>
    </form>
  )
}
