import { Suspense } from "react"
import { LoginForm } from "@/components/auth/LoginForm"
import { getChurchSettings } from "@/lib/churchSettings"

// NOTE: If this page feels slow in prod (~18s first load), it is NOT this page.
// Cause = container cold start on a scale-to-zero host. Render here is trivial
// and middleware skips /login; warm loads are ~76ms.
export default async function LoginPage() {
  const { name } = await getChurchSettings()
  return (
    <Suspense>
      <LoginForm churchName={name} />
    </Suspense>
  )
}
