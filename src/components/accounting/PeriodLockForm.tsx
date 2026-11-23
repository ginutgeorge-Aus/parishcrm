"use client"

import { useState, useTransition, type FormEvent } from "react"
import { setAccountingLockDate } from "@/lib/actions/accountingSettings"
import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Feedback = { error?: string; success?: string } | undefined

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** Formats a `YYYY-MM-DD` value as "30 Jun 2026" for the confirm text (no timezone or locale shift). */
function formatLockDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}

/**
 * Sets or clears the accounting lock date. Setting a date freezes every
 * transaction on or before it, so it goes through a confirm that names the
 * date. Clearing the lock (empty input) saves at once, no confirm.
 */
export function PeriodLockForm({ currentLockDate }: Readonly<{ currentLockDate: string | null }>) {
  const [date, setDate] = useState(currentLockDate ?? "")
  const [state, setState] = useState<Feedback>(undefined)
  const [pending, startTransition] = useTransition()

  async function save(value: string): Promise<Feedback> {
    const fd = new FormData()
    fd.set("date", value)
    const result = await setAccountingLockDate(undefined, fd)
    setState(result)
    return result && "error" in result ? { error: result.error } : undefined
  }

  /** Enter key / clear path: only an empty date saves without a confirm. */
  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (date === "") startTransition(async () => { await save("") })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <FormFeedback state={state} />

      <div className="space-y-1">
        <Label htmlFor="lockDate">Lock date</Label>
        <Input
          id="lockDate"
          name="date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-auto"
        />
      </div>

      {date === "" ? (
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      ) : (
        <DeleteConfirmButton
          onConfirm={() => save(date)}
          title="Lock the books?"
          description={`Lock all transactions dated on or before ${formatLockDate(date)}? They become read-only. You can clear or change the lock later.`}
          triggerLabel="Save"
          triggerVariant="default"
          triggerSize="default"
          triggerClassName=""
          confirmLabel="Lock"
          pendingLabel="Saving…"
        />
      )}
    </form>
  )
}
