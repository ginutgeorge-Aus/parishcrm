"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { createFollowUpTask } from "@/lib/actions/followUp"

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"

type Props = Readonly<{
  /** Exactly one of personId / familyId. */
  target: { personId: number } | { familyId: number }
  assignees: { id: number; name: string }[]
}>

/**
 * Add a follow-up to one person or family: title, optional notes, assignee and
 * due date. Single column on phones, two columns from `sm`.
 */
export function FollowUpForm({ target, assignees }: Props) {
  const [title, setTitle] = useState("")
  const [notes, setNotes] = useState("")
  const [assigneeId, setAssigneeId] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [message, setMessage] = useState<{ error?: string; success?: string } | null>(null)
  const [pending, startTransition] = useTransition()

  /**
   * Create the task, then clear the form on success.
   * @param e form submit event
   */
  function submit(e: React.FormEvent) {
    e.preventDefault()
    setMessage(null)
    startTransition(async () => {
      try {
        const res = await createFollowUpTask({
          ...target,
          title,
          notes: notes || null,
          assigneeId: assigneeId ? Number(assigneeId) : null,
          dueDate: dueDate || null,
        })
        if ("error" in res) {
          setMessage({ error: res.error })
          return
        }
        setTitle("")
        setNotes("")
        setAssigneeId("")
        setDueDate("")
        setMessage({ success: "Follow-up added" })
      } catch {
        setMessage({ error: "Something went wrong. Please try again." })
      }
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="fu-title">Follow-up</Label>
        <Input id="fu-title" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Visit after surgery" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="fu-assignee">Assign to</Label>
        <select id="fu-assignee" className={SELECT_CLASS} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
          <option value="">Unassigned</option>
          {assignees.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="fu-due">Due date (optional)</Label>
        <Input id="fu-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="fu-notes">Notes (optional)</Label>
        <Textarea id="fu-notes" rows={3} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending || title.trim() === ""} className="min-h-11 sm:min-h-0">
          {pending ? "Adding…" : "Add follow-up"}
        </Button>
        <FormFeedback state={message} />
      </div>
    </form>
  )
}
