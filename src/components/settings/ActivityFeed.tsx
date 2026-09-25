import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type AuditEntry = {
  id: number
  action: string
  resourceType: string
  resourceId: number | null
  createdAt: Date
  // System-generated audit entries have no actor, so the relation is nullable at
  // runtime even though most rows carry a user.
  user: { name: string | null } | null
}

type RecentRegistration = {
  id: number
  firstName: string
  lastName: string
  createdAt: Date
  event: { title: string }
}

type ActivityFeedProps = {
  isAdmin: boolean
  auditEntries: AuditEntry[]
  registrations: RecentRegistration[]
}

function timeAgo(date: Date): string {
  const diffMs = Date.now() - date.getTime()
  const diffMins = Math.floor(diffMs / 60_000)
  if (diffMins < 1) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  return `${Math.floor(diffHours / 24)}d ago`
}

export function ActivityFeed({ isAdmin, auditEntries, registrations }: ActivityFeedProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recent Activity</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isAdmin && auditEntries.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              System Activity
            </p>
            <ul className="space-y-1">
              {auditEntries.map((entry) => (
                <li key={entry.id} className="flex justify-between text-sm">
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{entry.user?.name ?? "System"}</span>
                    {" — "}
                    {entry.action}
                    {` (${entry.resourceType}${entry.resourceId != null ? ` #${entry.resourceId}` : ""})`}
                  </span>
                  <span className="text-muted-foreground text-xs ml-4 shrink-0">
                    {timeAgo(entry.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
            Recent Registrations
          </p>
          {registrations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recent registrations.</p>
          ) : (
            <ul className="space-y-1">
              {registrations.map((reg) => (
                <li key={reg.id} className="flex justify-between text-sm">
                  <span>
                    {reg.firstName} {reg.lastName}
                    {" — "}
                    <span className="text-muted-foreground">{reg.event.title}</span>
                  </span>
                  <span className="text-muted-foreground text-xs ml-4 shrink-0">
                    {timeAgo(reg.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
