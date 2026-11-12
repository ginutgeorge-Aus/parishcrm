import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { isEventOrganiser, isTeacher, canEdit } from "@/lib/roleGuard"
import { OrganiserHeader } from "@/components/organiser/OrganiserHeader"
import { SiteFooter } from "@/components/SiteFooter"
import { getChurchSettings } from "@/lib/churchSettings"
import { getEnabledFeatures } from "@/lib/featureFlags"
import { CLASSES_HOME, organiserHome } from "@/lib/organiserHome"

/**
 * EVENT_ORGANISER and TEACHER live here; editors (ADMIN/PASTOR/OFFICE_ADMIN)
 * are allowed through for support/testing. Everyone else is bounced. Middleware
 * already confines organisers to /my-events and teachers to /my-classes; this
 * is the belt-and-braces server gate so the surface never renders for the
 * wrong role. A TEACHER gets the Classes link only.
 */
export default async function OrganiserLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await auth()
  if (!session) redirect("/login")
  const role = session.user.role
  const teacher = isTeacher(role)
  if (!isEventOrganiser(role) && !teacher && !canEdit(role)) redirect("/")

  const [{ name: churchName }, features] = await Promise.all([getChurchSettings(), getEnabledFeatures()])

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <OrganiserHeader
        showEvents={!teacher && features.has("events")}
        showClasses={features.has("sundaySchool")}
        showGroups={!teacher}
        home={teacher ? CLASSES_HOME : organiserHome(features)}
      />
      <main className="min-w-0 flex-1 bg-muted p-4 md:p-8">{children}</main>
      <SiteFooter churchName={churchName} className="border-t bg-card px-8 py-3" />
    </div>
  )
}
