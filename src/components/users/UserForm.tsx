"use client"

import Link from "next/link"
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
import { ActionResult } from "@/lib/actions/types"
import { UserRole } from "@/lib/generated/prisma/enums"
import { canAssignRole } from "@/lib/roleGuard"
import { ROLE_LABELS } from "@/lib/roleLabels"
import { FormError } from "@/components/shared/FormError"
import { useRetainedForm } from "@/components/shared/useRetainedForm"

type User = { id: number; name: string; email: string; role: UserRole }

/**
 * Create/edit form for a staff account. On the signed-in user's own account
 * (`isSelf`) only the name is editable: email and role are shown read-only and
 * still submitted unchanged, and there is no password field (updateUser
 * refuses any other self change).
 * @param props the server action, the user being edited (absent on create),
 * the actor's role, and whether the actor is editing their own account
 */
export function UserForm({
  action,
  user,
  currentUserRole,
  isSelf = false,
}: Readonly<{
  action: (_prev: ActionResult, formData: FormData) => Promise<ActionResult>
  user?: User
  currentUserRole?: UserRole
  isSelf?: boolean
}>) {
  const [state, onSubmit, isPending, errorSeq] = useRetainedForm(action)
  // Same rule the server enforces: a non-ADMIN actor (OFFICE_ADMIN) cannot
  // grant ADMIN, PASTOR or its own role.
  const roleOptions = Object.values(UserRole).filter((r) => canAssignRole(currentUserRole, r))
  const selfEdit = isSelf && !!user

  return (
    <form onSubmit={onSubmit} className="max-w-md space-y-4">
      <FormError error={state?.error} errorKey={errorSeq} />

      <div className="space-y-1">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" defaultValue={user?.name} required />
      </div>

      <div className="space-y-1">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" defaultValue={user?.email} required readOnly={selfEdit} />
      </div>

      {selfEdit && (
        <p className="text-xs text-muted-foreground">
          You can change only your own name here. Use “Forgot password” on the sign-in page to change your
          password; another administrator changes your email or role.
        </p>
      )}

      {user && !selfEdit && (
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

      {selfEdit ? (
        <div className="space-y-1">
          <Label htmlFor="role">Role</Label>
          {/* Your own role may not be one you can assign, so it is never a Select option. */}
          <Input id="role" value={ROLE_LABELS[user.role] ?? user.role} readOnly disabled />
          <input type="hidden" name="role" value={user.role} />
        </div>
      ) : (
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
      )}

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : user ? "Save changes" : "Create user"}</Button>
        <Button asChild variant="outline"><Link href="/users">Cancel</Link></Button>
      </div>
    </form>
  )
}
