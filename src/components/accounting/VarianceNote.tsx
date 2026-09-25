"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { saveBudgetVarianceNote } from "@/lib/actions/budget"

// Persisted per-line variance explanation. Renders under a flagged
// budget-vs-actual line. Read-only viewers see the note text (if any); accounting
// staff get an inline edit affordance. The account always has a budget here, so
// the save target (year + accountId) is guaranteed to resolve to a Budget row.
export function VarianceNote({
  year,
  accountId,
  initialNote,
  canEdit,
}: {
  year: number
  accountId: number
  initialNote: string | null
  canEdit: boolean
}) {
  const [note, setNote] = useState(initialNote ?? "")
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // Nothing to show and nothing to add — render nothing to keep the row compact.
  if (!canEdit && !note) return null

  function save() {
    setError(null)
    startTransition(async () => {
      try {
        const result = await saveBudgetVarianceNote(year, accountId, draft)
        if (result && "error" in result) {
          setError(result.error)
          return
        }
        setNote(draft.trim())
        setEditing(false)
      } catch {
        // Transport-level throw never reaches the {error} branch — surface a
        // retry message so the note doesn't sit in edit with no feedback.
        setError("Something went wrong, try again")
      }
    })
  }

  if (editing) {
    return (
      <div className="mt-1 space-y-1.5">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={1000}
          rows={2}
          placeholder="Explain this variance…"
          className="text-sm"
          aria-label="Variance explanation note"
        />
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button type="button" size="sm" onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft(note)
              setError(null)
              setEditing(false)
            }}
            disabled={pending}
          >
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-0.5 flex items-start gap-2">
      {note ? (
        <p className="flex-1 text-xs italic text-muted-foreground">
          <span className="not-italic font-medium">Note: </span>
          {note}
        </p>
      ) : null}
      {canEdit && (
        <button
          type="button"
          onClick={() => {
            setDraft(note)
            setEditing(true)
          }}
          className="shrink-0 text-xs text-gold-foreground underline-offset-2 hover:underline print:hidden"
        >
          {note ? "Edit" : "+ Add note"}
        </button>
      )}
    </div>
  )
}
