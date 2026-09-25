import { createHash } from "crypto"
import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm"
import { AuthCard } from "@/components/auth/AuthCard"
import { getChurchSettings } from "@/lib/churchSettings"

type Props = { searchParams: Promise<{ token?: string }> }

export default async function ResetPasswordPage({ searchParams }: Props) {
  const { token } = await searchParams
  const { name: churchName } = await getChurchSettings()

  let valid = false
  // The token is a 32-byte randomBytes hex string (64 hex chars). Reject any
  // other shape before the DB lookup so a crafted token containing HTML/script
  // is never surfaced to the client form.
  if (token && /^[a-f0-9]{64}$/i.test(token)) {
    const tokenHash = createHash("sha256").update(token).digest("hex")
    const user = await prisma.user.findUnique({
      where: { passwordResetToken: tokenHash },
      select: { passwordResetExpires: true },
    })
    valid = !!user && !!user.passwordResetExpires && user.passwordResetExpires > new Date()
  }

  return (
    <AuthCard churchName={churchName}>
        {valid && token ? (
          <>
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Set new password</h1>
              <p className="mt-1 text-sm text-muted-foreground">Choose a strong password to protect your account.</p>
            </div>
            <ResetPasswordForm token={token} />
          </>
        ) : (
          <div role="alert">
            <h1 className="text-2xl font-semibold text-destructive">Link expired</h1>
            <p className="mt-1 text-sm text-muted-foreground">This reset link is invalid or has expired (links last 1 hour).</p>
            <Link href="/forgot-password" className="mt-4 inline-flex min-h-11 items-center px-2 text-sm underline hover:text-foreground transition-colors duration-200">Request a new link</Link>
          </div>
        )}
    </AuthCard>
  )
}
