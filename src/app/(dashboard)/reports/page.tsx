import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { actorId } from "@/lib/actor"
import { prisma } from "@/lib/prisma"
import { syncMyReports } from "@/lib/actions/feedback"
import { Badge } from "@/components/ui/badge"
import type { ReportStatus, ReportType } from "@/lib/generated/prisma/enums"
import { APP_LOCALE, APP_TIMEZONE } from "@/lib/appConfig"

const TYPE_LABEL: Record<ReportType, string> = {
  BUG: "Bug",
  FEATURE: "Feature",
  SUGGESTION: "Idea",
}

const STATUS: Record<ReportStatus, { label: string; variant: "outline" | "default" | "secondary" }> = {
  OPEN: { label: "Open", variant: "outline" },
  RESOLVED: { label: "Resolved", variant: "default" },
  DECLINED: { label: "Won't fix", variant: "secondary" },
}

const fmtDate = (d: Date) =>
  new Intl.DateTimeFormat(APP_LOCALE, { timeZone: APP_TIMEZONE, dateStyle: "medium" }).format(d)

export const metadata = { title: "My Reports" }

// Newest reports shown; older ones stay in the DB but aren't listed.
const MAX_REPORTS = 50

export default async function ReportsPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  // Shared parser rejects a malformed/missing id; a NaN userId must never reach
  // Prisma (it would surface as a validation error in the error boundary).
  let userId: number
  try {
    userId = actorId(session)
  } catch {
    redirect("/login")
  }
  // Refresh open reports' status from GitHub before rendering (lazy on-load sync).
  await syncMyReports()

  const reports = await prisma.report.findMany({
    where: { userId },
    select: { id: true, type: true, summary: true, status: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: MAX_REPORTS,
  })

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold text-foreground mb-2">My Reports</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Bugs, features, and ideas you&apos;ve sent us, and where they stand. Use the Feedback
        button in the sidebar to send a new one.
      </p>

      {reports.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm font-medium text-foreground">No reports yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Found a bug or have an idea? Click <strong>Feedback</strong> in the sidebar to send it.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {reports.map((r) => (
            <li key={r.id} className="rounded-lg border p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{TYPE_LABEL[r.type]}</Badge>
                    <span className="text-xs text-muted-foreground">{fmtDate(r.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-sm text-foreground">{r.summary}</p>
                </div>
                <Badge variant={STATUS[r.status].variant} className="shrink-0">
                  {STATUS[r.status].label}
                </Badge>
              </div>
            </li>
          ))}
        </ul>
      )}
      {reports.length === MAX_REPORTS && (
        <p className="mt-4 text-xs text-muted-foreground">Showing your {MAX_REPORTS} most recent reports.</p>
      )}
    </div>
  )
}
