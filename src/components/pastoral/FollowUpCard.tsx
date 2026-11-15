import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { listFollowUpTasks } from "@/lib/actions/followUp"
import { canManageFollowUps } from "@/lib/roleGuard"
import { listAssignableUsers } from "@/lib/pastoralQueries"
import type { UserRole } from "@/lib/generated/prisma/enums"
import { FollowUpForm } from "./FollowUpForm"
import { FollowUpList } from "./FollowUpList"
import { FollowUpTruncationNotice } from "./FollowUpTruncationNotice"

/**
 * "Follow-ups" card for a person or family page. Managers (ADMIN | PASTOR) see
 * every task on the target and can add one. An assignee (OFFICE_ADMIN) sees
 * only their own tasks (the action scopes the read), so the card shows only
 * when one of theirs is on this record, never an empty "No follow-ups." on
 * every page. Renders nothing for roles that hold no tasks.
 * @param target the person or family
 * @param role the viewer's role
 */
export async function FollowUpCard({
  target,
  role,
}: Readonly<{ target: { personId: number } | { familyId: number }; role: UserRole | undefined }>) {
  const manage = canManageFollowUps(role)
  const [res, assignees] = await Promise.all([
    listFollowUpTasks(target),
    manage ? listAssignableUsers() : Promise.resolve([]),
  ])
  if ("error" in res) return null
  if (!manage && res.tasks.length === 0) return null
  return (
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle className="text-base">Follow-ups</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <FollowUpTruncationNotice truncated={res.truncated} hint="Close finished follow-ups to see the rest." />
        <FollowUpList tasks={res.tasks} canManage={manage} />
        {manage && <FollowUpForm target={target} assignees={assignees} />}
      </CardContent>
    </Card>
  )
}
