"use server"

import { auth, signOut } from "@/auth"
import { prisma } from "@/lib/prisma"

// server-enforced logout. Stamps sessionsValidFrom so this user's
// outstanding tokens (including any captured/stolen copy) stop validating in the
// jwtCallback immediately, instead of remaining valid until the 24h JWT maxAge.
// This invalidates all of the user's sessions (every device), which is the
// intended behaviour for an explicit logout. Then clears the cookie + redirects.
export async function logout(): Promise<void> {
  const session = await auth()
  const id = session?.user?.id ? parseInt(session.user.id, 10) : NaN
  if (!Number.isNaN(id)) {
    // Swallow ONLY a P2025 (user since deleted) so signOut still runs. Any other
    // failure (DB outage, timeout) must propagate — proceeding to signOut would
    // clear this browser's cookie while every captured JWT stays valid until its
    // normal expiry, because sessionsValidFrom was never persisted.
    await prisma.user
      .update({ where: { id }, data: { sessionsValidFrom: new Date() } })
      .catch((e: unknown) => {
        if ((e as { code?: unknown })?.code !== "P2025") throw e
      })
    // Trusted-device trust intentionally SURVIVES an explicit logout — that is
    // the whole point of "remember this device for 14 days": a normal log out /
    // log back in on the same browser must skip OTP, not re-prompt every time.
    // Trust is still revoked on genuine security events: password reset
    // (resetPassword), admin forced-password-change, and manual revoke at
    // /account. sessionsValidFrom above already kills any outstanding tokens.
  }
  await signOut({ redirectTo: "/login" })
}
