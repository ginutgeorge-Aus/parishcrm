import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

export type WizardStep = "source" | "upload" | "review" | "done"

export const WIZARD_STEPS: { id: WizardStep; label: string }[] = [
  { id: "source", label: "Source" },
  { id: "upload", label: "Upload" },
  { id: "review", label: "Review" },
  { id: "done", label: "Done" },
]

/** Top progress stepper for the bank import wizard; collapses to "Step n of 4" below sm. */
export function ImportStepper({ current }: Readonly<{ current: WizardStep }>) {
  const currentIndex = WIZARD_STEPS.findIndex((s) => s.id === current)
  return (
    <nav aria-label="Import progress">
      <p className="text-sm font-medium text-muted-foreground sm:hidden">
        Step {currentIndex + 1} of {WIZARD_STEPS.length}: {WIZARD_STEPS[currentIndex].label}
      </p>
      <ol className="hidden sm:flex items-center gap-2">
        {WIZARD_STEPS.map((step, i) => {
          const done = i < currentIndex
          const active = i === currentIndex
          return (
            <li
              key={step.id}
              aria-label={done ? `${step.label}, completed` : step.label}
              aria-current={active ? "step" : undefined}
              className="flex flex-1 items-center gap-2 last:flex-none"
            >
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                  done && "border-success bg-success text-success-foreground",
                  active && "border-primary bg-primary text-primary-foreground",
                  !done && !active && "bg-card text-muted-foreground",
                )}
              >
                {done ? <Check className="size-4" aria-hidden /> : i + 1}
              </span>
              <span className={cn("text-sm", active ? "font-semibold text-foreground" : "text-muted-foreground")}>{step.label}</span>
              {i < WIZARD_STEPS.length - 1 && <span aria-hidden className="h-px flex-1 bg-border" />}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
