import { Sidebar } from "@/components/layout/Sidebar"
import { SiteFooter } from "@/components/SiteFooter"
import { IdleTimeout } from "@/components/auth/IdleTimeout"
import { getIdleTimeoutMinutes } from "@/lib/actions/settings"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { canEdit, isAdmin } from "@/lib/roleGuard"
import { countPendingFamilyUpdates } from "@/lib/pendingUpdates"
import { TEST_CHECKPOINTS } from "@/lib/testCheckpoints"
import { getChurchSettings } from "@/lib/churchSettings"

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [idleMinutes, session, { name: churchName }] = await Promise.all([
    getIdleTimeoutMinutes(),
    auth(),
    getChurchSettings(),
  ])
  const role = session?.user?.role

  const [pendingUpdates, verifyPending, membershipPending] = await Promise.all([
    canEdit(role) ? countPendingFamilyUpdates() : Promise.resolve(0),
    isAdmin(role)
      ? prisma.checkpointResult
          .findMany({ select: { checkpointId: true } })
          .then((rows) => {
            const tested = new Set(rows.map((r) => r.checkpointId))
            return TEST_CHECKPOINTS.filter((c) => !tested.has(c.id)).length
          })
      : Promise.resolve(0),
    canEdit(role)
      ? prisma.membershipApplication.count({ where: { status: "PENDING" } })
      : Promise.resolve(0),
  ])
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Skip to main content
      </a>
      <div className="flex flex-1">
        <Sidebar churchName={churchName} pendingUpdates={pendingUpdates} verifyPending={verifyPending} membershipPending={membershipPending} />
        <main id="main-content" className="min-w-0 flex-1 bg-muted p-4 pt-16 md:p-8 md:pt-8">{children}</main>
      </div>
      <SiteFooter churchName={churchName} className="border-t bg-card px-8 py-3" />
      <IdleTimeout idleMinutes={idleMinutes} />
    </div>
  )
}
