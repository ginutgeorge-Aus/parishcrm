"use client"

import { useActionState } from "react"
import { useRouter } from "next/navigation"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { AccountType } from "@/lib/generated/prisma/enums"
import type { ActionResult } from "@/lib/actions/types"

type AccountGroup = {
  id: number
  name: string
  type: AccountType
  sortOrder: number
}

export function AccountGroupForm({
  action,
  group,
}: {
  action: (_prev: ActionResult, formData: FormData) => Promise<ActionResult>
  group?: AccountGroup
}) {
  const router = useRouter()
  const [state, formAction, isPending] = useActionState(action, undefined)

  return (
    <form action={formAction} className="max-w-md space-y-4">
      <FormFeedback state={state} />

      <div className="space-y-1">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" defaultValue={group?.name} required />
      </div>

      <div className="space-y-1">
        <Label htmlFor="type">Type</Label>
        <Select name="type" defaultValue={group?.type ?? "INCOME"}>
          <SelectTrigger id="type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.values(AccountType).map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="sortOrder">Sort Order</Label>
        <Input
          id="sortOrder"
          name="sortOrder"
          type="number"
          min="0"
          max="999"
          defaultValue={group?.sortOrder ?? 0}
        />
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : group ? "Save changes" : "Create group"}</Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  )
}
