import { AuthCard } from "@/components/auth/AuthCard"
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm"
import { getChurchSettings } from "@/lib/churchSettings"

export default async function ForgotPasswordPage() {
  const { name: churchName } = await getChurchSettings()

  return (
    <AuthCard churchName={churchName}>
      <ForgotPasswordForm />
    </AuthCard>
  )
}
