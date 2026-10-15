"use client"

import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { revokeUserPasskeys } from "@/lib/actions/user"

export function RevokePasskeysButton({ userId, className = "" }: Readonly<{ userId: number; className?: string }>) {
  return (
    <DeleteConfirmButton
      onConfirm={() => revokeUserPasskeys(userId)}
      title="Revoke this user's passkeys?"
      description="Every passkey they registered is removed and they are signed out everywhere. They can still sign in with their password and code."
      triggerVariant="outline"
      triggerSize="sm"
      triggerLabel="Revoke passkeys"
      triggerClassName={className}
      confirmLabel="Revoke passkeys"
      pendingLabel="Revoking…"
    />
  )
}
