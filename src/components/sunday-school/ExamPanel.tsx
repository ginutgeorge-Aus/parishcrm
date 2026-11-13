"use client"

import { useActionState, useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { createExam, updateExam, archiveExam } from "@/lib/actions/sundaySchoolExam"
import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { ActionResult } from "@/lib/actions/types"

export type ExamListItem = { id: number; name: string; date: string; totalMarks: string; marked: number }

/** "4 Oct 2026" from a YYYY-MM-DD string (no timezone shift). */
function formatYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
}

/**
 * Inline edit form for one exam (name, date, total marks), saved by updateExam.
 * Closes itself on success; a refused save (duplicate, score above new total,
 * locked year) shows the message and stays open. Inputs are controlled so the
 * typed values survive React 19's post-action form reset after a refused save.
 */
function ExamEditForm({ exam, year, onDone }: Readonly<{ exam: ExamListItem; year: number; onDone: () => void }>) {
  const router = useRouter()
  const [name, setName] = useState(exam.name)
  const [date, setDate] = useState(exam.date)
  const [totalMarks, setTotalMarks] = useState(exam.totalMarks)
  // updateExam resolves to undefined on success.
  const save = async (_p: ActionResult | { success: string }, f: FormData): Promise<ActionResult | { success: string }> => {
    const r = await updateExam(exam.id, undefined, f)
    return r?.error ? r : { success: "Saved" }
  }
  const [state, formAction, isPending] = useActionState(save, undefined)
  const saved = state !== undefined && "success" in state

  useEffect(() => {
    if (saved) {
      router.refresh()
      onDone()
    }
  }, [state, saved, router, onDone])

  return (
    <form action={formAction} className="w-full max-w-md space-y-3 border-t border-border pt-3">
      <FormFeedback state={state} />
      <div className="space-y-1">
        <Label htmlFor={`exam-name-${exam.id}`}>Name</Label>
        <Input id={`exam-name-${exam.id}`} name="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
      </div>
      <div className="flex flex-wrap gap-3">
        <div className="space-y-1">
          <Label htmlFor={`exam-date-${exam.id}`}>Date</Label>
          <Input id={`exam-date-${exam.id}`} name="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} min={`${year}-01-01`} max={`${year}-12-31`} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`exam-total-${exam.id}`}>Total marks</Label>
          <Input id={`exam-total-${exam.id}`} name="totalMarks" inputMode="decimal" value={totalMarks} onChange={(e) => setTotalMarks(e.target.value)} className="w-28" required />
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={isPending} className="min-h-11 sm:min-h-0">{isPending ? "Saving…" : "Save"}</Button>
        <Button type="button" variant="outline" onClick={onDone} className="min-h-11 sm:min-h-0">Cancel</Button>
      </div>
    </form>
  )
}

/**
 * Exam list for one class (links to each exam's marks page) plus, when `readOnly`
 * is false, edit and archive buttons per exam and a create form. `hrefBase` is the exams URL
 * (`/sunday-school/1/exams` or `/my-classes/1/exams`).
 */
export function ExamPanel({
  classId, year, exams, enrolledCount, hrefBase, readOnly,
}: Readonly<{ classId: number; year: number; exams: ExamListItem[]; enrolledCount: number; hrefBase: string; readOnly: boolean }>) {
  const router = useRouter()
  const [editingId, setEditingId] = useState<number | null>(null)
  const closeEdit = useCallback(() => setEditingId(null), [])
  const formRef = useRef<HTMLFormElement>(null)
  // createExam resolves to undefined on success: surface that as "Exam added".
  const create = async (_p: ActionResult | { success: string }, f: FormData): Promise<ActionResult | { success: string }> => {
    const r = await createExam(classId, undefined, f)
    return r?.error ? r : { success: "Exam added" }
  }
  const [state, formAction, isPending] = useActionState(create, undefined)
  const added = state !== undefined && "success" in state

  // Clear the fields after each successful create (state is a fresh object).
  useEffect(() => {
    if (added) formRef.current?.reset()
  }, [state, added])

  return (
    <div className="space-y-4">
      {exams.length === 0 ? (
        <p className="text-sm text-muted-foreground">No exams yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {exams.map(e => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3">
              <Link href={`${hrefBase}/${e.id}`} className="min-w-0 flex-1 hover:underline">
                <span className="block text-sm font-semibold text-foreground">{e.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {formatYmd(e.date)} · out of {e.totalMarks} · {e.marked} of {enrolledCount} marked
                </span>
              </Link>
              {!readOnly && (
                <Button type="button" variant="outline" onClick={() => setEditingId(e.id)} className="min-h-11 sm:min-h-0">
                  Edit
                </Button>
              )}
              {!readOnly && (
                <DeleteConfirmButton
                  onConfirm={async () => {
                    const r = await archiveExam(e.id)
                    if (!r?.error) router.refresh()
                    return r
                  }}
                  title="Archive this exam?"
                  description="It disappears from the list; its marks are kept."
                  triggerLabel="Archive"
                  triggerVariant="outline"
                  triggerClassName="text-destructive hover:text-destructive min-h-11 sm:min-h-0"
                  confirmLabel="Archive"
                  pendingLabel="Archiving…"
                />
              )}
              {!readOnly && editingId === e.id && <ExamEditForm exam={e} year={year} onDone={closeEdit} />}
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <form ref={formRef} action={formAction} className="max-w-md space-y-3 border-t border-border pt-4">
          <h3 className="text-sm font-semibold text-foreground">Add an exam</h3>
          <FormFeedback state={state} />
          <div className="space-y-1">
            <Label htmlFor="exam-name">Name</Label>
            <Input id="exam-name" name="name" placeholder="Term 2 Bible" maxLength={80} required />
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="space-y-1">
              <Label htmlFor="exam-date">Date</Label>
              <Input id="exam-date" name="date" type="date" min={`${year}-01-01`} max={`${year}-12-31`} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="exam-total">Total marks</Label>
              <Input id="exam-total" name="totalMarks" inputMode="decimal" defaultValue="100" className="w-28" required />
            </div>
          </div>
          <Button type="submit" disabled={isPending} className="min-h-11">
            {isPending ? "Adding…" : "Add exam"}
          </Button>
        </form>
      )}
    </div>
  )
}
