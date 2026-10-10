"use client"

import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { enrolChildren, unenrolChild } from "@/lib/actions/sundaySchool"

type Enrolled = { id: number; name: string; familyName: string }
type Candidate = { id: number; name: string; familyName: string; isChild: boolean; currentClass: string | null }

/**
 * A class's children: the enrolled list (Remove per child) and an "Add
 * children" picker. Candidates are filtered by name and, by default, to people
 * whose family role is Child; one already in another class this year is
 * labelled "will move" (enrolChildren moves them). `readOnly` hides every control.
 */
export function EnrolPanel({
  classId,
  enrolled,
  candidates,
  readOnly,
}: Readonly<{ classId: number; enrolled: Enrolled[]; candidates: Candidate[]; readOnly: boolean }>) {
  const [query, setQuery] = useState("")
  const [childrenOnly, setChildrenOnly] = useState(true)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [result, setResult] = useState<{ error?: string; success?: string } | null>(null)
  const [pending, startTransition] = useTransition()

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return candidates.filter((c) =>
      (!childrenOnly || c.isChild)
      && (!q || c.name.toLowerCase().includes(q) || c.familyName.toLowerCase().includes(q)))
  }, [candidates, query, childrenOnly])

  /** Tick or untick one candidate. */
  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** Enrol every ticked candidate in one action call. */
  function submit() {
    const ids = [...selected]
    startTransition(async () => {
      try {
        const r = await enrolChildren(classId, ids)
        setResult(r ?? null)
        if (r && "success" in r) setSelected(new Set())
      } catch {
        setResult({ error: "Could not enrol — check your connection and try again" })
      }
    })
  }

  return (
    <div className="space-y-4">
      {enrolled.length === 0 ? (
        <p className="text-sm text-muted-foreground">No children enrolled yet.</p>
      ) : (
        <ul className="divide-y">
          {enrolled.map((p) => (
            <li key={p.id} className="flex min-h-11 items-center justify-between gap-2 py-1">
              <span>
                <Link href={`/people/${p.id}`} className="hover:underline">{p.name}</Link>
                <span className="text-sm text-muted-foreground"> · {p.familyName}</span>
              </span>
              {!readOnly && (
                <DeleteConfirmButton
                  onConfirm={() => unenrolChild(classId, p.id)}
                  title={`Remove ${p.name} from this class?`}
                  description="They stay in People and can be enrolled again any time."
                  triggerLabel={<>Remove<span className="sr-only"> {p.name}</span></>}
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
        <div className="space-y-3 border-t pt-4">
          <h4 className="text-sm font-semibold text-foreground">Add children</h4>
          <div className="flex flex-wrap items-center gap-3">
            <Input
              aria-label="Search people"
              placeholder="Search by name or family"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="max-w-xs"
            />
            <div className="flex min-h-11 items-center gap-2">
              <input
                id={`children-only-${classId}`}
                type="checkbox"
                checked={childrenOnly}
                onChange={(e) => setChildrenOnly(e.target.checked)}
                className="size-4"
              />
              <Label htmlFor={`children-only-${classId}`}>Children only</Label>
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto rounded-md border">
            {visible.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">No matching people.</p>
            ) : (
              <ul className="divide-y">
                {visible.map((c) => {
                  const inputId = `enrol-${classId}-${c.id}`
                  return (
                    <li key={c.id} className="flex min-h-11 items-center gap-3 px-3 py-1">
                      <input
                        id={inputId}
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => toggle(c.id)}
                        className="size-4"
                      />
                      <label htmlFor={inputId} className="flex-1 cursor-pointer text-sm">
                        {c.name} <span className="text-muted-foreground">· {c.familyName}</span>
                      </label>
                      {c.currentClass && (
                        <span className="text-xs text-muted-foreground">in {c.currentClass} — will move</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={submit} disabled={pending || selected.size === 0} className="min-h-11 sm:min-h-0">
              {pending ? "Enrolling…" : `Enrol ${selected.size}`}
            </Button>
            <FormFeedback state={result} />
          </div>
        </div>
      )}
    </div>
  )
}
