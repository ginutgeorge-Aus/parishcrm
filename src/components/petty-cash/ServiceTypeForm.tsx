"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { ActionResult } from "@/lib/actions/types"
import { FormError } from "@/components/shared/FormError"
import { useRetainedForm } from "@/components/shared/useRetainedForm"

export function ServiceTypeForm({
  action,
}: Readonly<{
  action: (_prev: ActionResult, formData: FormData) => Promise<ActionResult>
}>) {
  const [state, onSubmit, isPending, errorSeq] = useRetainedForm(action)
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <FormError error={state?.error} errorKey={errorSeq} />
        <Label htmlFor="name">New service type</Label>
        <Input id="name" name="name" required className="w-full sm:w-64" placeholder="e.g. Sunday Service" />
      </div>
      <Button type="submit" disabled={isPending}>{isPending ? "Adding…" : "Add"}</Button>
    </form>
  )
}
