import { cn } from "@/lib/utils"

/**
 * Shared post-submit feedback line for forms. Errors are announced immediately
 * (`role="alert"`); success is announced politely (`aria-live="polite"`). Uses
 * the `destructive` / `income` design tokens so every form reads the same.
 * Accepts either a server-action result (`{ error } | { success }`) or a plain
 * local-state message object — anything with an optional `error`/`success`.
 */
export function FormFeedback({
  state,
  className,
  id,
}: {
  state?: { error?: string | null; success?: string | null } | null
  className?: string
  // Optional id on the error line so inputs can wire aria-describedby to the
  // reason (WCAG 3.3.1/4.1.2). Only set aria-describedby when an error is
  // present, since this renders null otherwise.
  id?: string
}) {
  const error = state?.error
  if (error) {
    return (
      <p id={id} role="alert" className={cn("text-sm text-destructive", className)}>
        {error}
      </p>
    )
  }
  const success = state?.success
  if (success) {
    return (
      <p role="status" aria-live="polite" className={cn("text-sm text-income", className)}>
        {success}
      </p>
    )
  }
  return null
}
