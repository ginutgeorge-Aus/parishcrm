"use client"

import { useActionState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { ActionResult } from "@/lib/actions/types"
import { UserRole } from "@/lib/generated/prisma/enums"
import { isAdmin } from "@/lib/roleGuard"

const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.ADMIN]: "Admin",
  [UserRole.PASTOR]: "Pastor",
  [UserRole.VIEWER]: "Viewer",
  [UserRole.AUDITOR]: "Auditor",
  [UserRole.OFFICE_ADMIN]: "Office Admin",
  [UserRole.EVENT_ORGANISER]: "Event Organiser",
}

type User = { id: number; name: string; email: string; role: UserRole }

export function UserForm({
  action,
  user,
  currentUserRole,
}: {
  action: (_prev: ActionResult, formData: FormData) => Promise<ActionResult>
  user?: User
  currentUserRole?: UserRole
}) {
  const [state, formAction, isPending] = useActionState(action, undefined)
  const isActorAdmin = isAdmin(currentUserRole)
  // Non-ADMIN actors (OFFICE_ADMIN) cannot assign the ADMIN role.
  const roleOptions = Object.values(UserRole).filter(
    (r) => isActorAdmin || r !== UserRole.ADMIN
  )

  return (
    <form action={formAction} className="max-w-md space-y-4">
      <FormFeedback state={state} />

      <div className="space-y-1">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" defaultValue={user?.name} required />
      </div>

      <div className="space-y-1">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" defaultValue={user?.email} required />
      </div>

      {user && (
        <div className="space-y-1">
          <Label htmlFor="password">
            New password
            <span className="text-muted-foreground text-xs ml-1">(leave blank to keep current)</span>
          </Label>
          <Input id="password" name="password" type="password" minLength={8} />
          <p className="text-xs text-muted-foreground">
            Min 8 chars with uppercase, lowercase, number, and special character
          </p>
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor="role">Role</Label>
        <Select name="role" defaultValue={user?.role ?? "VIEWER"}>
          <SelectTrigger id="role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {roleOptions.map((r) => (
              <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : user ? "Save changes" : "Create user"}</Button>
        <Button type="button" variant="outline" onClick={() => history.back()}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
