"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { ClearanceStatusBadge } from "@/components/people/PersonClearances"
import { addTeacher, removeTeacher } from "@/lib/actions/sundaySchool"
import type { ClearanceStatus } from "@/lib/clearanceStatus"

type Teacher = { id: number; name: string; wwcc: ClearanceStatus }
type Candidate = { id: number; name: string }

/**
 * A class's teachers, each with their WWCC status badge. Editors can remove a
 * teacher or add one of the People tagged Sunday school teacher.
 */
export function TeachersPanel({
  classId,
  teachers,
  candidates,
  readOnly,
}: Readonly<{ classId: number; teachers: Teacher[]; candidates: Candidate[]; readOnly: boolean }>) {
  const [personId, setPersonId] = useState("")
  const [result, setResult] = useState<{ error?: string } | null>(null)
  const [pending, startTransition] = useTransition()

  /** Add the picked candidate as a teacher. */
  function add() {
    const id = Number(personId)
    startTransition(async () => {
      const r = await addTeacher(classId, id)
      setResult(r ?? null)
      if (!r) setPersonId("")
    })
  }

  return (
    <div className="space-y-4">
      {teachers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No teacher yet.</p>
      ) : (
        <ul className="divide-y">
          {teachers.map((t) => (
            <li key={t.id} className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-1">
              <span className="flex items-center gap-2">
                <Link href={`/people/${t.id}`} className="hover:underline">{t.name}</Link>
                <span className="text-xs text-muted-foreground">WWCC</span>
                <ClearanceStatusBadge status={t.wwcc} />
              </span>
              {!readOnly && (
                <DeleteConfirmButton
                  onConfirm={() => removeTeacher(classId, t.id)}
                  title={`Remove ${t.name} as a teacher?`}
                  description="They stay tagged as a Sunday school teacher and can be added again."
                  triggerLabel={<>Remove<span className="sr-only"> {t.name}</span></>}
                  triggerClassName="text-destructive hover:text-destructive min-h-11 sm:min-h-0"
                  confirmLabel="Remove"
                  pendingLabel="Removing…"
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Only people tagged <em>Sunday school teacher</em> can be added — tag them on their profile.
          </p>
        ) : (
          <div className="flex flex-wrap items-end gap-3 border-t pt-4">
            <div className="space-y-1">
              <Label htmlFor={`teacher-${classId}`}>Add teacher</Label>
              <select
                id={`teacher-${classId}`}
                value={personId}
                onChange={(e) => setPersonId(e.target.value)}
                className="h-11 rounded-md border bg-background px-3 text-sm sm:h-9"
              >
                <option value="">Choose a teacher…</option>
                {candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <Button type="button" onClick={add} disabled={pending || !personId} className="min-h-11 sm:min-h-0">
              {pending ? "Adding…" : "Add teacher"}
            </Button>
            <FormFeedback state={result} />
          </div>
        )
      )}
    </div>
  )
}
