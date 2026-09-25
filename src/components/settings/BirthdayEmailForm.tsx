"use client"

import { useActionState, useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { updateBirthdayTemplate, sendTestBirthdayEmail } from "@/lib/actions/settings"
import { FormFeedback } from "@/components/ui/FormFeedback"

export function BirthdayEmailForm({
  subject: initialSubject,
  body: initialBody,
}: {
  subject: string
  body: string
}) {
  const [state, formAction, isPending] = useActionState(updateBirthdayTemplate, undefined)
  const [subject, setSubject] = useState(initialSubject)
  const [body, setBody] = useState(initialBody)
  const [testPending, startTest] = useTransition()
  const [msg, setMsg] = useState("")

  function onTest() {
    setMsg("")
    startTest(async () => {
      const r = await sendTestBirthdayEmail({ subject, body })
      setMsg(r && "success" in r ? r.success : r?.error ?? "")
    })
  }

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Birthday email template</h3>
        <p className="text-sm text-muted-foreground">
          Placeholders: <code>{"{firstName}"}</code>, <code>{"{they}"}</code>, <code>{"{them}"}</code>, <code>{"{their}"}</code> (from the member&apos;s gender)
        </p>
      </div>

      <FormFeedback state={state} />

      <div className="space-y-1">
        <Label htmlFor="birthdayEmailSubject">Subject</Label>
        <Input
          id="birthdayEmailSubject"
          name="birthdayEmailSubject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={200}
          required
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="birthdayEmailBody">Body</Label>
        <Textarea
          id="birthdayEmailBody"
          name="birthdayEmailBody"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={12}
          maxLength={5000}
          required
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Save template"}</Button>
        <Button type="button" variant="outline" onClick={onTest} disabled={testPending}>
          {testPending ? "Sending…" : "Send test to me"}
        </Button>
      </div>
      {msg ? <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{msg}</p> : null}
    </form>
  )
}
