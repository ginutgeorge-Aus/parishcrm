import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { FilterChip } from "@/components/pastoral/FilterChip"
import { FollowUpList } from "@/components/pastoral/FollowUpList"
import { listFollowUpTasks } from "@/lib/actions/followUp"
import { FOLLOW_UP_LIST_MAX, followUpVisibilityWhere } from "@/lib/pastoralAccess"
import {
  followUpStatusesFor,
  parseAssigneeFilter,
  parseFollowUpStatusFilter,
  type AssigneeFilter,
  type FollowUpStatusFilter,
} from "@/lib/pastoralLabels"
import { listAssignableUsers } from "@/lib/pastoralQueries"
import { canManageFollowUps } from "@/lib/roleGuard"

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

/**
 * The list filter for an assignee choice, so it applies in the query before the
 * row cap (never as a post-filter on a capped result).
 * @param assignee the parsed assignee filter
 */
function assigneeQuery(assignee: AssigneeFilter): { mine?: boolean; assigneeId?: number | null } {
  if (assignee === "mine") return { mine: true }
  if (assignee === "unassigned") return { assigneeId: null }
  return typeof assignee === "number" ? { assigneeId: assignee } : {}
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
  const manage = canManageFollowUps(role)
  // Non-managers have no assignee chips and the action scopes them to their own
  // tasks anyway, so ignore a stale ?assignee= instead of filtering to nothing.
  const assignee: AssigneeFilter = manage ? parseAssigneeFilter(sp.assignee) : "all"

  const [res, assignees] = await Promise.all([
    listFollowUpTasks({ statuses: followUpStatusesFor(status), ...assigneeQuery(assignee) }),
    manage ? listAssignableUsers() : Promise.resolve([]),
  ])
  if ("error" in res) redirect("/")
  const tasks = res.tasks

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
            <FilterChip key={c.value} href={hrefFor(c.value, assignee)} active={status === c.value}>
              {c.label}
            </FilterChip>
          ))}
        </div>
        {manage && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Assignee">
            <FilterChip href={hrefFor(status, "all")} active={assignee === "all"}>Everyone</FilterChip>
            <FilterChip href={hrefFor(status, "mine")} active={assignee === "mine"}>Mine</FilterChip>
            <FilterChip href={hrefFor(status, "unassigned")} active={assignee === "unassigned"}>Unassigned</FilterChip>
            {assignees.map((a) => (
              <FilterChip key={a.id} href={hrefFor(status, a.id)} active={assignee === a.id}>{a.name}</FilterChip>
            ))}
          </div>
        )}
      </div>
      {tasks.length >= FOLLOW_UP_LIST_MAX && (
        <p role="status" className="text-sm text-muted-foreground">
          Showing the first {FOLLOW_UP_LIST_MAX}. Narrow the filters to see the rest.
        </p>
      )}
      <div className="rounded-lg border bg-card p-4">
        <FollowUpList tasks={tasks} canManage={manage} showTarget />
      </div>
    </div>
  )
}
