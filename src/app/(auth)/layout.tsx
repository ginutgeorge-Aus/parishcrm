import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { SiteFooter } from "@/components/SiteFooter"
import { getChurchSettings } from "@/lib/churchSettings"

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  // Already-authenticated users have no business on login/forgot/reset — serving
  // those pages is a minor session-fixation surface (AUDIT-050). One guard
  // here covers all three pages, including the client-rendered forgot-password.
  const session = await auth()
  if (session?.user) redirect("/")

  const { name: churchName } = await getChurchSettings()

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center bg-muted">
      <main className="flex flex-col items-center">{children}</main>
      <SiteFooter churchName={churchName} className="mt-8" />
    </div>
  )
}
