"use client"

import * as React from "react"
import { useActionState, useState, useTransition } from "react"
import {
  updateEmailTemplate,
  resetEmailTemplate,
  previewEmailTemplate,
  sendTestEmail,
} from "@/lib/actions/emailTemplates"
import { DEFAULT_EMAIL_TEMPLATES, EMAIL_TEMPLATE_VARS, type EmailTemplateKey, type EmailTemplateFields } from "@/lib/emailTemplates"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { FormFeedback } from "@/components/ui/FormFeedback"

export function EmailTemplateForm({
  templateKey,
  initial,
}: {
  templateKey: EmailTemplateKey
  initial: EmailTemplateFields
}) {
  const [state, action, saving] = useActionState(updateEmailTemplate, undefined)
  const [fields, setFields] = useState<EmailTemplateFields>(initial)
  const [preview, setPreview] = useState<string>("")
  const [msg, setMsg] = useState<string>("")
  const [pending, start] = useTransition()
  // Save (useActionState) and Preview/Test/Reset (useTransition) are independent
  // pending states; treat any in-flight write as busy so Reset can't resolve and
  // show defaults while a slower Save later clobbers them in the DB.
  const busy = pending || saving
  const showBody = templateKey !== "receipt"

  const set =
    (k: keyof EmailTemplateFields) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setFields((f) => ({ ...f, [k]: e.target.value }))

  function refreshPreview() {
    setMsg("")
    start(async () => {
      const r = await previewEmailTemplate(templateKey, fields)
      setPreview("html" in r ? r.html : "")
      if ("error" in r) setMsg(r.error)
    })
  }
  function onReset() {
    start(async () => {
      const r = await resetEmailTemplate(templateKey)
      if (r && "success" in r) {
        // Reset persisted the defaults server-side; sync the controlled fields and
        // drop the stale preview so a later Save can't overwrite defaults.
        setFields(DEFAULT_EMAIL_TEMPLATES[templateKey])
        setPreview("")
      }
      setMsg(r && "success" in r ? r.success : r?.error ?? "")
    })
  }
  function onTest() {
    start(async () => {
      const r = await sendTestEmail(templateKey, fields)
      setMsg(r && "success" in r ? r.success : r?.error ?? "")
    })
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <form action={action} className="space-y-3">
        <input type="hidden" name="key" value={templateKey} />
        <div className="flex flex-wrap gap-1 text-xs">
          <span className="text-muted-foreground">Variables:</span>
          {EMAIL_TEMPLATE_VARS[templateKey].map((v) => (
            <code key={v} className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">{v}</code>
          ))}
        </div>
        <label className="block text-sm font-medium">
          Subject
          <Input
            name="subject"
            value={fields.subject}
            onChange={set("subject")}
            maxLength={200}
            disabled={busy}
            className="mt-1"
          />
        </label>
        <label className="block text-sm font-medium">
          Intro
          <Textarea
            name="intro"
            value={fields.intro}
            onChange={set("intro")}
            maxLength={5000}
            rows={2}
            disabled={busy}
            className="mt-1"
          />
        </label>
        {showBody ? (
          <label className="block text-sm font-medium">
            Body
            <Textarea
              name="body"
              value={fields.body}
              onChange={set("body")}
              maxLength={5000}
              rows={4}
              disabled={busy}
              className="mt-1"
            />
          </label>
        ) : (
          <input type="hidden" name="body" value={fields.body} />
        )}
        <label className="block text-sm font-medium">
          Sign-off / footer
          <Textarea
            name="signoff"
            value={fields.signoff}
            onChange={set("signoff")}
            maxLength={5000}
            rows={3}
            disabled={busy}
            className="mt-1"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>Save</Button>
          <Button type="button" variant="outline" onClick={refreshPreview} disabled={busy}>Preview</Button>
          <Button type="button" variant="outline" onClick={onTest} disabled={busy}>Send test to me</Button>
          <Button type="button" variant="ghost" onClick={onReset} disabled={busy}>Reset to default</Button>
        </div>
        <FormFeedback state={state} />
        {msg ? <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{msg}</p> : null}
      </form>
      <div className="rounded border bg-muted/30 p-2">
        <p className="mb-1 text-xs text-muted-foreground">Preview (sample data)</p>
        <iframe title="Email preview" srcDoc={preview} sandbox="" className="h-[480px] w-full rounded bg-card" />
      </div>
    </div>
  )
}
