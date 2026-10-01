"use client"

import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { resetUserTotp } from "@/lib/actions/user"

export function ResetTotpButton({ userId, className = "" }: Readonly<{ userId: number; className?: string }>) {
  return (
    <DeleteConfirmButton
      onConfirm={() => resetUserTotp(userId)}
      title="Reset this user's authenticator?"
      description="They'll sign in with an emailed code until they set it up again. Their backup codes and trusted devices are also removed."
      triggerVariant="outline"
      triggerSize="sm"
      triggerLabel="Reset 2FA"
      triggerClassName={className}
      confirmLabel="Reset 2FA"
      pendingLabel="Resetting…"
    />
  )
}
