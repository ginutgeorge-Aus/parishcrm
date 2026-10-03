import { redirect, notFound } from "next/navigation"
import { AuthCard } from "@/components/auth/AuthCard"
import { SetupForm } from "@/components/auth/SetupForm"
import { getChurchSettings } from "@/lib/churchSettings"
import { isSetupOpen } from "@/lib/setupState"
import { isDemoMode } from "@/lib/demoMode"

export const dynamic = "force-dynamic"

export default async function SetupPage() {
  if (isDemoMode()) notFound()
  if (!(await isSetupOpen())) redirect("/login")
  const { name: churchName } = await getChurchSettings()

  return (
    <AuthCard churchName={churchName}>
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Create the first administrator</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter the setup token from your hosting dashboard (the <code>SETUP_TOKEN</code> variable).
          This page disappears once the first account exists.
        </p>
      </div>
      <SetupForm />
    </AuthCard>
  )
}
