"use client"

import { useId, useState, useTransition } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button, buttonVariants } from "@/components/ui/button"
import type { VariantProps } from "class-variance-authority"
import type { ActionResult } from "@/lib/actions/types"

type ButtonVariant = VariantProps<typeof buttonVariants>["variant"]
type ButtonSize = VariantProps<typeof buttonVariants>["size"]

/**
 * Shared destructive-confirm button. Handles the pending guard:
 * - Disables the confirm button while the action is in flight (prevents double-submit).
 * - Keeps the dialog open on error, surfaces the message inline.
 * - Closes the dialog on success, clears error state on dialog close.
 *
 * Used by delete/archive wrappers across accounting, families, people, and users.
 */
export function DeleteConfirmButton({
  onConfirm,
  title,
  description,
  triggerLabel = "Delete",
  triggerVariant = "ghost",
  triggerSize = "sm",
  triggerClassName = "text-destructive hover:text-destructive",
  confirmLabel = "Delete",
  pendingLabel = "Deleting…",
  disabled = false,
  disabledReason,
}: {
  onConfirm: () => Promise<ActionResult | { error?: string } | void>
  title: string
  description: string
  triggerLabel?: React.ReactNode
  triggerVariant?: ButtonVariant
  triggerSize?: ButtonSize
  triggerClassName?: string
  confirmLabel?: string
  pendingLabel?: string
  // When disabled, render an inert trigger (no dialog) with a `title` tooltip —
  // used to block deletes on locked accounting periods.
  disabled?: boolean
  disabledReason?: string
}) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const reasonId = useId()

  if (disabled) {
    // Render the reason as visible adjacent text + wire aria-describedby, so keyboard,
    // touch, and screen-reader users can discover why the action is inert — `title`
    // alone is skipped by most screen readers and never shows on touch.
    return (
      <span className="inline-flex items-center gap-1.5">
        <Button
          variant={triggerVariant}
          size={triggerSize}
          className={triggerClassName}
          disabled
          aria-describedby={disabledReason ? reasonId : undefined}
        >
          {triggerLabel}
        </Button>
        {disabledReason && (
          <span id={reasonId} className="text-xs text-muted-foreground">
            {disabledReason}
          </span>
        )}
      </span>
    )
  }

  function handleConfirm() {
    startTransition(async () => {
      const result = await onConfirm()
      if (result && "error" in result && result.error) {
        setError(result.error)
      } else {
        setOpen(false)
      }
    })
  }

  return (
    <AlertDialog open={open} onOpenChange={(o: boolean) => { setOpen(o); if (!o) setError(null) }}>
      <AlertDialogTrigger asChild>
        <Button variant={triggerVariant} size={triggerSize} className={triggerClassName}>
          {triggerLabel}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p role="alert" className="text-sm text-destructive px-6">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={pending} onClick={(e: React.MouseEvent<HTMLButtonElement>) => { e.preventDefault(); handleConfirm() }}>
            {pending ? pendingLabel : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
