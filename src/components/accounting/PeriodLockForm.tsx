"use client"

import { useActionState } from "react"
import { setAccountingLockDate } from "@/lib/actions/accountingSettings"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function PeriodLockForm({ currentLockDate }: { currentLockDate: string | null }) {
  const [state, formAction, pending] = useActionState(setAccountingLockDate, undefined)

  return (
    <form action={formAction} className="space-y-3">
      <FormFeedback state={state} />

      <div className="space-y-1">
        <Label htmlFor="lockDate">Lock date</Label>
        <Input
          id="lockDate"
          name="date"
          type="date"
          defaultValue={currentLockDate ?? ""}
          className="w-auto"
        />
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  )
}
