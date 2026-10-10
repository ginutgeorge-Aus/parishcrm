"use client"

import { useActionState } from "react"
import { useRouter } from "next/navigation"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { MAX_LEVEL } from "@/lib/sundaySchool"
import type { ActionResult } from "@/lib/actions/types"

type ClassValues = { name: string; level: number; location: string }

/** Create/edit form for a Sunday School class. The school year is fixed (bound into `action`). */
export function ClassForm({
  action,
  year,
  cls,
}: Readonly<{
  action: (_prev: ActionResult, formData: FormData) => Promise<ActionResult>
  year: number
  cls?: ClassValues
}>) {
  const router = useRouter()
  const [state, formAction, isPending] = useActionState(action, undefined)
  const submitLabel = cls ? "Save changes" : "Create class"

  return (
    <form action={formAction} className="max-w-md space-y-4">
      <FormFeedback state={state} />
      <p className="text-sm text-muted-foreground">School year {year}</p>

      <div className="space-y-1">
        <Label htmlFor="name">Class name</Label>
        <Input id="name" name="name" defaultValue={cls?.name} placeholder="Years 1–2" maxLength={80} required />
      </div>

      <div className="space-y-1">
        <Label htmlFor="level">Level</Label>
        <Input
          id="level"
          name="level"
          type="number"
          inputMode="numeric"
          min={0}
          max={MAX_LEVEL}
          step={1}
          defaultValue={cls?.level ?? 0}
          aria-describedby="level-help"
          required
        />
        <p id="level-help" className="text-xs text-muted-foreground">
          0 = Kindy/Prep, 1 = Year 1 … — used to order classes and to move children up at rollover.
        </p>
      </div>

      <div className="space-y-1">
        <Label htmlFor="location">Location (optional)</Label>
        <Input id="location" name="location" defaultValue={cls?.location} maxLength={80} aria-describedby="location-help" />
        <p id="location-help" className="text-xs text-muted-foreground">
          Campus, room or group — leave blank if you have one location.
        </p>
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
