"use client"

import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { resetUserTotp } from "@/lib/actions/user"

/**
 * A button component that triggers a confirmation dialog to reset a user's TOTP 2FA.
 *
 * @param {Object} props - Component props.
 * @param {number} props.userId - The ID of the user whose TOTP to reset.
 * @param {string} [props.className] - Optional CSS classes for the button.
 * @returns {JSX.Element} The rendered DeleteConfirmButton component.
 */
export function ResetTotpButton({ userId, className = "" }: Readonly<{ userId: number; className?: string }>) {
  return (
    <DeleteConfirmButton
      onConfirm={() => resetUserTotp(userId)}
      title="Reset this user's authenticator?"
      description="They'll sign in with an emailed code until they set it up again. Their backup codes, trusted devices and passkeys are also removed."
      triggerVariant="outline"
      triggerSize="sm"
      triggerLabel="Reset 2FA"
      triggerClassName={className}
      confirmLabel="Reset 2FA"
      pendingLabel="Resetting…"
    />
  )
}
