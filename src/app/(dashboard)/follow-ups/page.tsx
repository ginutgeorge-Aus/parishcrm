import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { FollowUpList } from "@/components/pastoral/FollowUpList"
import { listFollowUpTasks } from "@/lib/actions/followUp"
import { followUpVisibilityWhere } from "@/lib/pastoralAccess"
import {
  followUpStatusesFor,
  matchesAssignee,
  parseAssigneeFilter,
  parseFollowUpStatusFilter,
  type AssigneeFilter,
  type FollowUpStatusFilter,
} from "@/lib/pastoralLabels"
import { listAssignableUsers } from "@/lib/pastoralQueries"
import { canManageFollowUps } from "@/lib/roleGuard"
import { cn } from "@/lib/utils"

const STATUS_CHOICES: { value: FollowUpStatusFilter; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "done", label: "Closed" },
  { value: "all", label: "All" },
]

/**
 * Builds a /follow-ups href for a filter pair; defaults are left out.
 * @param status status filter
 * @param assignee assignee filter
 */
function hrefFor(status: FollowUpStatusFilter, assignee: AssigneeFilter): string {
  const q = new URLSearchParams()
  if (status !== "open") q.set("status", status)
  if (assignee !== "all") q.set("assignee", String(assignee))
  const s = q.toString()
  return s ? `/follow-ups?${s}` : "/follow-ups"
}

/** One filter chip (a link, so it works without JS and is bookmarkable). */
function Chip({ href, active, children }: Readonly<{ href: string; active: boolean; children: React.ReactNode }>) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "inline-flex min-h-11 items-center rounded-full border px-3 text-sm sm:min-h-0 sm:py-1",
        active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
      )}
    >
      {children}
    </Link>
  )
}

/**
 * Pastoral follow-up tasks. ADMIN | PASTOR see every task; an assignee (an
 * editor) sees only their own, enforced by the action. Other roles go home.
 */
export default async function FollowUpsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  const role = session.user.role
  if (followUpVisibilityWhere({ id: 0, role }) === null) redirect("/")

  const sp = await searchParams
  const status = parseFollowUpStatusFilter(sp.status)
  const assignee = parseAssigneeFilter(sp.assignee)
  const manage = canManageFollowUps(role)

  const [res, assignees] = await Promise.all([
    listFollowUpTasks({ statuses: followUpStatusesFor(status), mine: assignee === "mine" }),
    manage ? listAssignableUsers() : Promise.resolve([]),
  ])
  if ("error" in res) redirect("/")
  const tasks = res.tasks.filter((t) => matchesAssignee(t, assignee))

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold text-foreground">Follow-ups</h2>
      <p className="text-sm text-muted-foreground">
        {manage
          ? "Add a follow-up from a person or family page. They are private to pastors, admins and the person assigned."
          : "Follow-ups assigned to you."}
      </p>
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Status">
          {STATUS_CHOICES.map((c) => (
            <Chip key={c.value} href={hrefFor(c.value, assignee)} active={status === c.value}>
              {c.label}
            </Chip>
          ))}
        </div>
        {manage && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Assignee">
            <Chip href={hrefFor(status, "all")} active={assignee === "all"}>Everyone</Chip>
            <Chip href={hrefFor(status, "mine")} active={assignee === "mine"}>Mine</Chip>
            <Chip href={hrefFor(status, "unassigned")} active={assignee === "unassigned"}>Unassigned</Chip>
            {assignees.map((a) => (
              <Chip key={a.id} href={hrefFor(status, a.id)} active={assignee === a.id}>{a.name}</Chip>
            ))}
          </div>
        )}
      </div>
      <div className="rounded-lg border bg-card p-4">
        <FollowUpList tasks={tasks} canManage={manage} showTarget />
      </div>
    </div>
  )
}
