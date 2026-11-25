"use client"

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
import { AccountType } from "@/lib/generated/prisma/enums"
import type { ActionResult } from "@/lib/actions/types"
import { FormError } from "@/components/shared/FormError"
import { useRetainedForm } from "@/components/shared/useRetainedForm"

type AccountGroup = {
  id: number
  name: string
  type: AccountType
  sortOrder: number
}

export function AccountGroupForm({
  action,
  group,
}: Readonly<{
  action: (_prev: ActionResult, formData: FormData) => Promise<ActionResult>
  group?: AccountGroup
}>) {
  const router = useRouter()
  const [state, onSubmit, isPending, errorSeq] = useRetainedForm(action)

  return (
    <form onSubmit={onSubmit} className="max-w-md space-y-4">
      <FormError error={state?.error} errorKey={errorSeq} />

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
        <Label htmlFor="sortOrder">Sort order</Label>
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
