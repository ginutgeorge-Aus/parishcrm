"use client"

import { useActionState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { ActionResult } from "@/lib/actions/types"

export function ServiceTypeForm({
  action,
}: {
  action: (_prev: ActionResult, formData: FormData) => Promise<ActionResult>
}) {
  const [state, formAction, isPending] = useActionState(action, undefined)
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        {state?.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
        <Label htmlFor="name">New service type</Label>
        <Input id="name" name="name" required className="w-full sm:w-64" placeholder="e.g. Sunday Service" />
      </div>
      <Button type="submit" disabled={isPending}>{isPending ? "Adding…" : "Add"}</Button>
    </form>
  )
}
