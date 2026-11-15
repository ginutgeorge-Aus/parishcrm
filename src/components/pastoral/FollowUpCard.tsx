import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { listFollowUpTasks } from "@/lib/actions/followUp"
import { canManageFollowUps } from "@/lib/roleGuard"
import { listAssignableUsers } from "@/lib/pastoralQueries"
import type { UserRole } from "@/lib/generated/prisma/enums"
import { FollowUpForm } from "./FollowUpForm"
import { FollowUpList } from "./FollowUpList"

/**
 * "Follow-ups" card for a person or family page. Managers (ADMIN | PASTOR) see
 * every task on the target and can add one; an assignee sees only their own
 * (the action scopes the read). Renders nothing for roles that hold no tasks.
 * @param target the person or family
 * @param role the viewer's role
 */
export async function FollowUpCard({
  target,
  role,
}: Readonly<{ target: { personId: number } | { familyId: number }; role: UserRole | undefined }>) {
  const res = await listFollowUpTasks(target)
  if ("error" in res) return null
  const manage = canManageFollowUps(role)
  const assignees = manage ? await listAssignableUsers() : []
  return (
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle className="text-base">Follow-ups</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <FollowUpList tasks={res.tasks} canManage={manage} />
        {manage && <FollowUpForm target={target} assignees={assignees} />}
      </CardContent>
    </Card>
  )
}
