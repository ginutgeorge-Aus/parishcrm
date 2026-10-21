"use client"

import * as React from "react"
import { useActionState, useEffect, useRef, useState, useTransition } from "react"
import {
  updateEmailTemplate,
  resetEmailTemplate,
  previewEmailTemplate,
  sendTestEmail,
} from "@/lib/actions/emailTemplates"
import { DEFAULT_EMAIL_TEMPLATES, EMAIL_TEMPLATE_VARS, type EmailTemplateKey, type EmailTemplateFields } from "@/lib/emailTemplates"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { useFormDirty } from "./unsavedChanges"
import { SettingsRow } from "./ui/SettingsRow"

/**
 * Editor for one email template (subject, intro, body, sign-off) with preview,
 * test-send and reset. Rows sit in the parent card; the preview is below.
 * @param props.templateKey which template
 * @param props.initial stored (or default) fields
 * @param props.active false while this form sits in a hidden (force-mounted) tab
 */
export function EmailTemplateForm({
  templateKey,
  initial,
  active = true,
}: Readonly<{
  templateKey: EmailTemplateKey
  initial: EmailTemplateFields
  /** False while this form sits in a hidden (force-mounted) tab. */
  active?: boolean
}>) {
  const [msg, setMsg] = useState<string>("")
  const [state, action, saving] = useActionState(
    /** Clears any lingering test-send/preview message, then saves. */
    async (prev: Awaited<ReturnType<typeof updateEmailTemplate>> | undefined, fd: FormData) => {
      setMsg("")
      return updateEmailTemplate(prev, fd)
    },
    undefined
  )
  const { ref, rebaseline } = useFormDirty(state)
  const [fields, setFields] = useState<EmailTemplateFields>(initial)
  const [preview, setPreview] = useState<string>("")
  const previewGeneration = useRef(0)
  const [pending, start] = useTransition()
  // Bumped by a successful Reset; the effect re-baselines dirty tracking once
  // the default values are committed (setting them in code fires no input event).
  const [resetGen, setResetGen] = useState(0)
  useEffect(() => {
    if (resetGen) rebaseline()
  }, [resetGen, rebaseline])
  // Save (useActionState) and Preview/Test/Reset (useTransition) are independent
  // pending states; treat any in-flight write as busy so Reset can't resolve and
  // show defaults while a slower Save later clobbers them in the DB.
  const busy = pending || saving
  const showBody = templateKey !== "receipt"

  const set =
    (k: keyof EmailTemplateFields) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setFields((f) => ({ ...f, [k]: e.target.value }))

  // Render the preview the first time the form is shown so the pane isn't blank
  // until Preview is pressed. Waiting for `active` keeps force-mounted hidden tabs
  // from queueing a server render each on page load. Uses the initial fields;
  // later edits re-render via the Preview button.
  const initialPreviewed = useRef(false)
  useEffect(() => {
    if (!active || initialPreviewed.current) return
    initialPreviewed.current = true
    const generation = previewGeneration.current
    Promise.resolve(previewEmailTemplate(templateKey, initial))
      .then((r) => {
        if (generation === previewGeneration.current && r && "html" in r) setPreview(r.html)
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps -- first activation only
  }, [active])

  /** Re-renders the preview pane from the current (unsaved) field values. */
  function refreshPreview() {
    previewGeneration.current += 1
    setMsg("")
    start(async () => {
      const r = await previewEmailTemplate(templateKey, fields)
      setPreview("html" in r ? r.html : "")
      if ("error" in r) setMsg(r.error)
    })
  }
  /** Restores the stored defaults server-side and syncs the form to them. */
  function onReset() {
    previewGeneration.current += 1
    start(async () => {
      const r = await resetEmailTemplate(templateKey)
      if (r && "success" in r) {
        // Reset persisted the defaults server-side; sync the controlled fields and
        // drop the stale preview so a later Save can't overwrite defaults.
        setFields(DEFAULT_EMAIL_TEMPLATES[templateKey])
        setPreview("")
        setResetGen((g) => g + 1)
      }
      setMsg(r && "success" in r ? r.success : r?.error ?? "")
    })
  }
  /** Sends the current (possibly unsaved) fields to the signed-in admin. */
  function onTest() {
    start(async () => {
      const r = await sendTestEmail(templateKey, fields)
      setMsg(r && "success" in r ? r.success : r?.error ?? "")
    })
  }

  const id = (f: string) => `${templateKey}-${f}`
  return (
    <div>
      <form ref={ref} action={action} className="divide-y divide-border">
        <input type="hidden" name="key" value={templateKey} hidden />
        <div className="flex flex-wrap gap-1 py-4 text-xs">
          <span className="text-muted-foreground">Variables:</span>
          {EMAIL_TEMPLATE_VARS[templateKey].map((v) => (
            <code key={v} className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">{v}</code>
          ))}
        </div>
        <SettingsRow label="Subject" htmlFor={id("subject")}>
          <Input
            id={id("subject")}
            name="subject"
            value={fields.subject}
            onChange={set("subject")}
            maxLength={200}
            disabled={busy}
            className="md:w-80"
          />
        </SettingsRow>
        <div className="space-y-2 py-5">
          <Label htmlFor={id("intro")}>Intro</Label>
          <Textarea
            id={id("intro")}
            name="intro"
            value={fields.intro}
            onChange={set("intro")}
            maxLength={5000}
            rows={2}
            disabled={busy}
          />
        </div>
        {showBody ? (
          <div className="space-y-2 py-5">
            <Label htmlFor={id("body")}>Body</Label>
            <Textarea
              id={id("body")}
              name="body"
              value={fields.body}
              onChange={set("body")}
              maxLength={5000}
              rows={4}
              disabled={busy}
            />
          </div>
        ) : (
          <input type="hidden" name="body" value={fields.body} hidden />
        )}
        <div className="space-y-2 py-5">
          <Label htmlFor={id("signoff")}>Sign-off / footer</Label>
          <Textarea
            id={id("signoff")}
            name="signoff"
            value={fields.signoff}
            onChange={set("signoff")}
            maxLength={5000}
            rows={3}
            disabled={busy}
          />
        </div>
        <div className="space-y-3 py-4">
          <FormFeedback state={state} />
          {msg ? <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{msg}</p> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onReset} disabled={busy}>Reset to default</Button>
            <Button type="button" variant="outline" onClick={onTest} disabled={busy}>Send test to me</Button>
            <Button type="button" variant="outline" onClick={refreshPreview} disabled={busy}>Preview</Button>
            <Button type="submit" disabled={busy}>Save</Button>
          </div>
        </div>
      </form>
      <div className="mt-2 rounded border bg-muted/30 p-2">
        <p className="mb-1 text-xs text-muted-foreground">Preview (sample data)</p>
        <iframe title="Email preview" srcDoc={preview} sandbox="" className="h-[480px] w-full rounded bg-card" />
      </div>
    </div>
  )
}
