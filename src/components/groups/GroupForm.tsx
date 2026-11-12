"use client"

import { useActionState } from "react"
import { useRouter } from "next/navigation"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { GROUP_CATEGORIES, GROUP_CATEGORY_LABELS, MAX_GROUP_DESCRIPTION, MAX_GROUP_NAME } from "@/lib/groups"
import type { ActionResult } from "@/lib/actions/types"

type GroupValues = { name: string; category: string; description: string }

/** Create/edit form for a group (name, category, description). */
export function GroupForm({
  action,
  group,
}: Readonly<{
  action: (_prev: ActionResult, formData: FormData) => Promise<ActionResult>
  group?: GroupValues
}>) {
  const router = useRouter()
  const [state, formAction, isPending] = useActionState(action, undefined)
  const submitLabel = group ? "Save changes" : "Create group"

  return (
    <form action={formAction} className="max-w-md space-y-4">
      <FormFeedback state={state} />

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
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  )
}
