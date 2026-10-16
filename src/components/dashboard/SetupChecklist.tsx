import Link from "next/link"
import { ChevronRight, Circle, CircleCheck } from "lucide-react"
import type { UserRole } from "@/lib/generated/prisma/enums"
import { getSetupChecklist } from "@/lib/setupChecklist"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

/**
 * First-run "Finish setting up" card for the dashboard. Renders nothing for
 * roles that can't complete the steps, or once every step is done — the data
 * and those rules live in `getSetupChecklist`.
 */
export async function SetupChecklist({ role }: Readonly<{ role: UserRole | undefined }>) {
  const steps = await getSetupChecklist(role)
  if (!steps) return null

  const doneCount = steps.filter((s) => s.done).length
  const pct = Math.round((doneCount / steps.length) * 100)

  return (
    <Card role="region" aria-labelledby="setup-checklist-title" className="print:hidden">
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <CardTitle as="h3" id="setup-checklist-title" className="text-base font-semibold">
            Finish setting up
          </CardTitle>
          <p className="text-sm text-muted-foreground tabular">
            {doneCount} of {steps.length} done
          </p>
        </div>
        <div
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={doneCount}
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
      </CardHeader>
      <CardContent className="px-2 sm:px-4">
        <ul className="grid gap-1 lg:grid-cols-2">
          {steps.map((step) =>
            step.done ? (
              <li key={step.id} className="flex min-h-11 items-start gap-3 rounded-lg px-2 py-2">
                <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-muted-foreground line-through">{step.title}</p>
                  <span className="sr-only">Done</span>
                </div>
              </li>
            ) : (
              <li key={step.id}>
                <Link
                  href={step.href}
                  className="group flex min-h-11 items-start gap-3 rounded-lg px-2 py-2 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <Circle className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{step.title}</p>
                    <p className="text-xs text-muted-foreground">{step.description}</p>
                  </div>
                  <ChevronRight
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            )
          )}
        </ul>
      </CardContent>
    </Card>
  )
}
