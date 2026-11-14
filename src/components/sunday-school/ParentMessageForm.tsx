"use client"

import { useActionState, useMemo, useState } from "react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { MAX_SS_MESSAGE_BODY, MAX_SS_MESSAGE_SUBJECT } from "@/lib/sundaySchoolMessageSchema"
import type { ActionResult } from "@/lib/actions/types"

/** One child as the form sees it: parent ids only (for the deduped count), never an address. */
export type FormStudent = { personId: number; name: string; parentIds: number[]; skipLabel: string | null }

/**
 * Compose form for a Sunday School parent email: pick children, then subject +
 * plain-text body. Shows the deduped parent count live (siblings share parents).
 * The send action redirects on success, so only errors render here.
 * @param action `sendSsParentMessage` bound to the class id
 * @param students the class's live children
 * @param preselected ids checked on load (all, or the session's absentees)
 */
export function ParentMessageForm({
  action,
  students,
  preselected,
}: Readonly<{
  action: (_prev: ActionResult, formData: FormData) => Promise<ActionResult>
  students: FormStudent[]
  preselected: number[]
}>) {
  const [state, formAction, isPending] = useActionState(action, undefined)
  // Controlled: React 19 resets uncontrolled fields after a form action, which would wipe the draft on an error.
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [selected, setSelected] = useState<Set<number>>(() => new Set(preselected))
  const parentCount = useMemo(() => {
    const ids = new Set<number>()
    for (const s of students) if (selected.has(s.personId)) for (const p of s.parentIds) ids.add(p)
    return ids.size
  }, [students, selected])

  /**
   * Check or uncheck one child.
   * @param id the child's person id
   * @param on new checked state
   */
  function toggle(id: number, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  return (
    <form action={formAction} className="max-w-2xl space-y-4">
      <FormFeedback state={state} />
      <fieldset className="space-y-2 rounded-lg border bg-card p-4">
        <legend className="px-1 text-sm font-medium text-foreground">Children</legend>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setSelected(new Set(students.map((s) => s.personId)))}>Whole class</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
        {students.length === 0 && <p className="text-sm text-muted-foreground">No children in this class.</p>}
        <ul className="space-y-1">
          {students.map((s) => (
            <li key={s.personId} className="flex flex-wrap items-center gap-2 text-sm">
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  name="studentId"
                  value={s.personId}
                  checked={selected.has(s.personId)}
                  onChange={(e) => toggle(s.personId, e.target.checked)}
                  className="size-4"
                />
                <span>{s.name}</span>
              </label>
              {s.skipLabel && <Badge variant="secondary">{s.skipLabel}</Badge>}
            </li>
          ))}
        </ul>
        <p className="text-sm font-medium text-foreground" aria-live="polite">
          This email will go to {parentCount} {parentCount === 1 ? "parent" : "parents"}.
        </p>
      </fieldset>
      <div className="space-y-1">
        <Label htmlFor="subject">Subject</Label>
        <Input id="subject" name="subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={MAX_SS_MESSAGE_SUBJECT} required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="body">Message</Label>
        <Textarea id="body" name="body" value={body} onChange={(e) => setBody(e.target.value)} rows={10} maxLength={MAX_SS_MESSAGE_BODY} required />
        <p className="text-xs text-muted-foreground">Plain text. Each parent is greeted by first name; the class and church name are added below.</p>
      </div>
      <Button type="submit" disabled={isPending || parentCount === 0} className="w-full sm:w-auto">
        {isPending ? "Sending…" : "Send email"}
      </Button>
    </form>
  )
}
