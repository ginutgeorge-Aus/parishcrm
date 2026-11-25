"use client"

import { useRouter } from "next/navigation"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import type { ActionResult } from "@/lib/actions/types"
import { FormError } from "@/components/shared/FormError"
import { useRetainedForm } from "@/components/shared/useRetainedForm"

type Fund = { id: number; name: string; isActive: boolean; sortOrder: number }

export function FundForm({
  action,
  fund,
}: Readonly<{
  action: (_prev: ActionResult, formData: FormData) => Promise<ActionResult>
  fund?: Fund
}>) {
  const router = useRouter()
  const [state, onSubmit, isPending, errorSeq] = useRetainedForm(action)

  return (
    <form onSubmit={onSubmit} className="max-w-md space-y-4">
      <FormError error={state?.error} errorKey={errorSeq} />

      <div className="space-y-1">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" defaultValue={fund?.name} required />
      </div>

      <div className="space-y-1">
        <Label htmlFor="sortOrder">Sort order</Label>
        <Input
          id="sortOrder"
          name="sortOrder"
          type="number"
          min="0"
          max="999"
          defaultValue={fund?.sortOrder ?? 0}
        />
      </div>

      <div className="flex items-center gap-2">
        {/* Checkbox posts "on" when checked (shadcn hidden input inside form) */}
        <Checkbox id="isActive" name="isActive" defaultChecked={fund?.isActive ?? true} />
        <Label htmlFor="isActive">Active</Label>
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : fund ? "Save changes" : "Create fund"}</Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  )
}
