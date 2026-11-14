"use client"

import Link from "next/link"
import { useState, useTransition } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import type { ActionResultWithSuccess } from "@/lib/actions/types"
import { deleteFollowUpTask, setFollowUpStatus, type FollowUpTaskView } from "@/lib/actions/followUp"
import { FOLLOW_UP_STATUS_LABEL } from "@/lib/pastoralLabels"

type Props = Readonly<{
  tasks: FollowUpTaskView[]
  /** ADMIN | PASTOR: may delete tasks. Assignees can only change status. */
  canManage: boolean
  /** Show the person/family the task is about (the /follow-ups page). */
  showTarget?: boolean
}>

/**
 * Follow-up tasks as a list with Start / Done / Reopen and (managers) Delete.
 * Stacks on phones; actions wrap under the text. Visibility is decided by the
 * server action, never here.
 */
export function FollowUpList({ tasks, canManage, showTarget = false }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  /**
   * Run a task action and surface its error.
   * @param fn the server action call
   */
  function run(fn: () => Promise<ActionResultWithSuccess>) {
    setError(null)
    startTransition(async () => {
      try {
        const res = await fn()
        if (res && "error" in res) setError(res.error)
      } catch {
        setError("Something went wrong. Please try again.")
      }
    })
  }

  if (tasks.length === 0) return <p className="text-sm text-muted-foreground">No follow-ups.</p>
  return (
    <div className="space-y-2">
      <FormFeedback state={{ error }} />
      <ul className="divide-y divide-border" aria-label="Follow-ups">
        {tasks.map((t) => (
          <li key={t.id} className="space-y-1 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-medium">{t.title}</span>
              <Badge variant={t.status === "DONE" || t.status === "CANCELLED" ? "outline" : "secondary"}>
                {FOLLOW_UP_STATUS_LABEL[t.status]}
              </Badge>
              {t.overdue && <Badge variant="destructive">Overdue</Badge>}
            </div>
            <p className="text-muted-foreground">
              {showTarget && <TargetLink task={t} />}
              {t.dueDate ? `Due ${t.dueDate}` : "No due date"}
              {` · ${t.assigneeName ? `Assigned to ${t.assigneeName}` : "Unassigned"}`}
            </p>
            {t.notes && <p className="whitespace-pre-wrap">{t.notes}</p>}
            <div className="flex flex-wrap gap-2 pt-1">
              <TaskActions task={t} canManage={canManage} disabled={pending} run={run} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** "Person name · " or "Family name · " prefix linking to the profile. */
function TargetLink({ task }: Readonly<{ task: FollowUpTaskView }>) {
  const href = task.personId ? `/people/${task.personId}` : `/families/${task.familyId}`
  const name = task.personName ?? task.familyName ?? "Unknown"
  return (
    <>
      <Link href={href} className="text-foreground hover:underline">
        {name}
      </Link>
      {" · "}
    </>
  )
}

/** Status buttons for one task, plus Delete for managers. */
function TaskActions({
  task,
  canManage,
  disabled,
  run,
}: Readonly<{
  task: FollowUpTaskView
  canManage: boolean
  disabled: boolean
  run: (fn: () => Promise<ActionResultWithSuccess>) => void
}>) {
  const closed = task.status === "DONE" || task.status === "CANCELLED"
  return (
    <>
      {task.status === "OPEN" && (
        <Button size="sm" variant="outline" disabled={disabled} className="min-h-11 sm:min-h-0" onClick={() => run(() => setFollowUpStatus(task.id, "IN_PROGRESS"))}>
          Start
        </Button>
      )}
      {!closed && (
        <Button size="sm" disabled={disabled} className="min-h-11 sm:min-h-0" onClick={() => run(() => setFollowUpStatus(task.id, "DONE"))}>
          Mark done
        </Button>
      )}
      {closed && (
        <Button size="sm" variant="outline" disabled={disabled} className="min-h-11 sm:min-h-0" onClick={() => run(() => setFollowUpStatus(task.id, "OPEN"))}>
          Reopen
        </Button>
      )}
      {canManage && (
        <DeleteConfirmButton
          title="Delete this follow-up?"
          description="The task is removed for everyone. This cannot be undone."
          onConfirm={async () => {
            const res = await deleteFollowUpTask(task.id)
            return res && "error" in res ? res : undefined
          }}
        />
      )}
    </>
  )
}
