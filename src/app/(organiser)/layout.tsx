import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { isEventOrganiser, canEdit } from "@/lib/roleGuard"
import { OrganiserHeader } from "@/components/organiser/OrganiserHeader"
import { SiteFooter } from "@/components/SiteFooter"
import { getChurchSettings } from "@/lib/churchSettings"

// Only EVENT_ORGANISER lives here; editors (ADMIN/PASTOR/OFFICE_ADMIN) are
// allowed through for support/testing. Everyone else is bounced. Middleware
// already confines organisers to /my-events; this is the belt-and-braces
// server gate so the surface never renders for the wrong role.
export default async function OrganiserLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session) redirect("/login")
  if (!isEventOrganiser(session.user.role) && !canEdit(session.user.role)) redirect("/")

  const { name: churchName } = await getChurchSettings()

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <OrganiserHeader />
      <main className="min-w-0 flex-1 bg-muted p-4 md:p-8">{children}</main>
      <SiteFooter churchName={churchName} className="border-t bg-card px-8 py-3" />
    </div>
  )
}
