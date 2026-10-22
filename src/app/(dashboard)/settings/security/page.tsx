import { prisma } from "@/lib/prisma"
import { requireSettingsTab } from "@/lib/settingsAccess"
import { ActivityFeed } from "@/components/settings/ActivityFeed"
import { SettingsCard } from "@/components/settings/ui/SettingsCard"

/** Settings → Security: recent audit entries and registrations. */
export default async function SecuritySettingsPage() {
  const {
    data: [auditEntries, registrations],
  } = await requireSettingsTab("/settings/security", () => Promise.all([
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, action: true, resourceType: true, resourceId: true, createdAt: true, user: { select: { name: true } } },
    }),
    prisma.registration.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, firstName: true, lastName: true, createdAt: true, event: { select: { title: true } } },
    }),
  ]))
  return (
    <SettingsCard title="Security" description="Recent changes and registrations across the app.">
      <div className="py-5">
        <ActivityFeed auditEntries={auditEntries} registrations={registrations} />
      </div>
    </SettingsCard>
  )
}
