import { cn } from "@/lib/utils"

/**
 * Shared post-submit feedback line for forms. Errors are announced immediately
 * (`role="alert"`); success is announced politely (`aria-live="polite"`). Uses
 * the `destructive` / `income` design tokens so every form reads the same.
 * Accepts either a server-action result (`{ error } | { success }`) or a plain
 * local-state message object — anything with an optional `error`/`success`/`warning`.
 * A `warning` is a non-fatal caveat shown alongside a success (or an error), announced as an alert, in the
 * `destructive` style since the user must act on it.
 * `className` goes once on the outer wrapper (use it for layout such as margins); the warning block carries its own
 * width, border and padding.
 */
export function FormFeedback({
  state,
  className,
  id,
}: {
  state?: { error?: string | null; success?: string | null; warning?: string | null } | null
  className?: string
  // Optional id on the error line so inputs can wire aria-describedby to the
  // reason (WCAG 3.3.1/4.1.2). Only set aria-describedby when an error is
  // present, since this renders null otherwise.
  id?: string
}) {
  const error = state?.error
  const success = state?.success
  const warning = state?.warning
  if (!error && !success && !warning) return null
  return (
    <div className={className}>
      {error && (
        <p id={id} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!error && success && (
        <p role="status" aria-live="polite" className="text-sm text-income">
          {success}
        </p>
      )}
      {warning && (
        <p role="alert" className="w-full rounded-md border border-destructive/40 bg-muted p-2 text-sm text-destructive">
          {warning}
        </p>
      )}
    </div>
  )
}
