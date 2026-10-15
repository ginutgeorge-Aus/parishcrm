"use client"

import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { revokeUserPasskeys } from "@/lib/actions/user"

export function RevokePasskeysButton({ userId, className = "" }: Readonly<{ userId: number; className?: string }>) {
  /**
   * Component for revoking a user's passkeys.
   * @param {number} userId - The ID of the user whose passkeys will be revoked.
   * @param {string} [className] - Optional additional CSS class names for the button.
   * @returns {JSX.Element} A button that triggers a confirmation dialog to revoke passkeys.
   */
  return (
    <DeleteConfirmButton
      onConfirm={() => revokeUserPasskeys(userId)}
      title="Revoke this user's passkeys?"
      description="Every passkey and trusted device they have is removed and they are signed out everywhere. They can still sign in with their password and code."
      triggerVariant="outline"
      triggerSize="sm"
      triggerLabel="Revoke passkeys"
      triggerClassName={className}
      confirmLabel="Revoke passkeys"
      pendingLabel="Revoking…"
    />
  )
}
