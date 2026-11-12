"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { setExamScore } from "@/lib/actions/sundaySchoolExam"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { Input } from "@/components/ui/input"

export type ExamMarkRow = { personId: number; name: string; score: string | null }

/**
 * Marks entry for one exam: one row per enrolled child (names only), a score
 * input and "/ total". Each score saves on blur when changed. Blank = not
 * marked (clears the mark); "0" is a real mark. Read-only mode shows the
 * score as text (VIEWER, archived class, locked year).
 */
export function ExamMarksForm({
  examId, totalMarks, rows, readOnly,
}: Readonly<{ examId: number; totalMarks: string; rows: ExamMarkRow[]; readOnly: boolean }>) {
  const router = useRouter()
  const [values, setValues] = useState<Record<number, string>>(() => Object.fromEntries(rows.map(r => [r.personId, r.score ?? ""])))
  const [saved, setSaved] = useState<Record<number, string>>(() => Object.fromEntries(rows.map(r => [r.personId, r.score ?? ""])))
  const [pendingIds, setPendingIds] = useState<Set<number>>(() => new Set())
  const [errors, setErrors] = useState<Record<number, string>>({})
  const [feedback, setFeedback] = useState<{ error?: string } | null>(null)
  const [, startTransition] = useTransition()

  /** Save one child's score if it changed since the last save. */
  function commit(r: ExamMarkRow) {
    const next = (values[r.personId] ?? "").trim()
    if (next === saved[r.personId] || pendingIds.has(r.personId)) return
    setFeedback(null)
    setErrors(prev => ({ ...prev, [r.personId]: "" }))
    setPendingIds(prev => new Set(prev).add(r.personId))
    startTransition(async () => {
      try {
        const result = await setExamScore(examId, r.personId, next)
        if (result?.error) {
          setErrors(prev => ({ ...prev, [r.personId]: result.error }))
        } else {
          setSaved(prev => ({ ...prev, [r.personId]: next }))
          setValues(prev => ({ ...prev, [r.personId]: next }))
          router.refresh()
        }
      } catch {
        setFeedback({ error: "Couldn't save that mark. Please try again." })
      } finally {
        setPendingIds(prev => {
          const n = new Set(prev)
          n.delete(r.personId)
          return n
        })
      }
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <FormFeedback state={feedback} />
      <ul className="flex flex-col gap-2">
        {rows.map(r => (
          <li key={r.personId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3">
            <p className="text-sm font-semibold text-foreground">{r.name}</p>
            {readOnly ? (
              <span className="text-sm text-muted-foreground">
                {r.score === null ? "Not marked" : `${r.score} / ${totalMarks}`}
              </span>
            ) : (
              <div className="flex items-center gap-2">
                <Input
                  inputMode="decimal"
                  aria-label={`Score for ${r.name}`}
                  aria-invalid={errors[r.personId] ? true : undefined}
                  value={values[r.personId] ?? ""}
                  disabled={pendingIds.has(r.personId)}
                  onChange={e => setValues(prev => ({ ...prev, [r.personId]: e.target.value }))}
                  onBlur={() => commit(r)}
                  onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur() }}
                  placeholder="–"
                  className="min-h-11 w-24"
                />
                <span className="text-sm text-muted-foreground">/ {totalMarks}</span>
              </div>
            )}
            {errors[r.personId] && <p role="alert" className="w-full text-xs text-destructive">{errors[r.personId]}</p>}
          </li>
        ))}
        {rows.length === 0 && (
          <li className="py-6 text-center text-sm text-muted-foreground">No children enrolled in this class.</li>
        )}
      </ul>
    </div>
  )
}
