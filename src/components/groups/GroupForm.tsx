"use client"

import Link from "next/link"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { GROUP_CATEGORIES, GROUP_CATEGORY_LABELS, MAX_GROUP_DESCRIPTION, MAX_GROUP_NAME } from "@/lib/groups"
import type { ActionResult } from "@/lib/actions/types"
import { FormError } from "@/components/shared/FormError"
import { useRetainedForm } from "@/components/shared/useRetainedForm"

type GroupValues = { id?: number; name: string; category: string; description: string }

/** Create/edit form for a group (name, category, description). */
export function GroupForm({
  action,
  group,
}: Readonly<{
  action: (_prev: ActionResult, formData: FormData) => Promise<ActionResult>
  group?: GroupValues
}>) {
  const [state, onSubmit, isPending, errorSeq] = useRetainedForm(action)
  const submitLabel = group ? "Save changes" : "Create group"

  return (
    <form onSubmit={onSubmit} className="max-w-md space-y-4">
      <FormError error={state?.error} errorKey={errorSeq} />

      <div className="space-y-1">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" defaultValue={group?.name} placeholder="Choir" maxLength={MAX_GROUP_NAME} required />
      </div>

      <div className="space-y-1">
        <Label htmlFor="category">Category</Label>
        {/* Native select: plain form post, no Radix empty-value gotcha. */}
        <select
          id="category"
          name="category"
          defaultValue={group?.category ?? "MINISTRY"}
          className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm sm:h-9"
          required
        >
          {GROUP_CATEGORIES.map((c) => (
            <option key={c} value={c}>{GROUP_CATEGORY_LABELS[c]}</option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="description">Description (optional)</Label>
        <Textarea id="description" name="description" defaultValue={group?.description} maxLength={MAX_GROUP_DESCRIPTION} rows={3} />
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : submitLabel}
        </Button>
        <Button asChild variant="outline"><Link href={group?.id ? `/groups/${group.id}` : "/groups"}>Cancel</Link></Button>
      </div>
    </form>
  )
}
