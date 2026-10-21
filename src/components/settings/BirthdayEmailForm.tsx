"use client"

import { useActionState, useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { updateBirthdayTemplate, sendTestBirthdayEmail } from "@/lib/actions/settings"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { useFormDirty } from "./unsavedChanges"
import { SettingsRow } from "./ui/SettingsRow"
import { SettingsSubgroup } from "./ui/SettingsSubgroup"

/**
 * Birthday email template editor: subject, body, save and send-test. Rendered as
 * a subgroup inside the Email page's "Blessing emails" card.
 * @param props.subject saved subject
 * @param props.body saved body
 */
export function BirthdayEmailForm({
  subject: initialSubject,
  body: initialBody,
}: Readonly<{
  subject: string
  body: string
}>) {
  const [state, formAction, isPending] = useActionState(updateBirthdayTemplate, undefined)
  const { ref } = useFormDirty(state)
  const [subject, setSubject] = useState(initialSubject)
  const [body, setBody] = useState(initialBody)
  const [testPending, startTest] = useTransition()
  const [msg, setMsg] = useState("")

  /** Sends the current (possibly unsaved) subject and body to the signed-in admin. */
  function onTest() {
    setMsg("")
    startTest(async () => {
      const r = await sendTestBirthdayEmail({ subject, body })
      setMsg(r && "success" in r ? r.success : r?.error ?? "")
    })
  }

  return (
    <form ref={ref} action={formAction}>
      <SettingsSubgroup
        title="Birthday email template"
        description={<>Placeholders: <code>{"{firstName}"}</code>, <code>{"{they}"}</code>, <code>{"{them}"}</code>, <code>{"{their}"}</code> (from the member&apos;s gender)</>}
      >
        <SettingsRow label="Subject" htmlFor="birthdayEmailSubject">
          <Input
            id="birthdayEmailSubject"
            name="birthdayEmailSubject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={200}
            required
            className="md:w-80"
          />
        </SettingsRow>
        <div className="space-y-2 py-5">
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
        {/* Next to the buttons so save/test results are seen without scrolling up. */}
        <div className="space-y-3 py-4">
          <FormFeedback state={state} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={onTest} disabled={testPending}>
              {testPending ? "Sending…" : "Send test to me"}
            </Button>
            <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Save template"}</Button>
          </div>
          {msg ? <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{msg}</p> : null}
        </div>
      </SettingsSubgroup>
    </form>
  )
}
