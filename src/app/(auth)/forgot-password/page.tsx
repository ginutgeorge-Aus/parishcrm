import { notFound } from "next/navigation"
import { AuthCard } from "@/components/auth/AuthCard"
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm"
import { getChurchSettings } from "@/lib/churchSettings"
import { isDemoMode } from "@/lib/demoMode"

export default async function ForgotPasswordPage() {
  if (isDemoMode()) notFound()
  const { name: churchName } = await getChurchSettings()

  return (
    <AuthCard churchName={churchName}>
      <ForgotPasswordForm />
    </AuthCard>
  )
}
