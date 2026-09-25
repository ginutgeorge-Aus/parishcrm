"use client"

import { useState, useTransition } from "react"
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

type ButtonVariant = VariantProps<typeof buttonVariants>["variant"]
type ButtonSize = VariantProps<typeof buttonVariants>["size"]

type Props = {
  action: () => Promise<{ error?: string } | undefined | void>
  // Call sites style this per their layout context (compact row action vs.
  // page-header action) via the shared Button variant/size system instead of
  // one-off className strings.
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
  confirmMessage?: string
  children?: React.ReactNode
}

export function DeleteEventButton({
  action,
  variant = "destructive",
  size = "sm",
  className,
  confirmMessage = "Delete this event? This cannot be undone.",
  children = "Delete",
}: Props) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleDelete() {
    startTransition(async () => {
      try {
        const result = await action()
        if (result?.error) {
          setError(result.error)
        } else {
          setOpen(false)
        }
      } catch {
        // Transport-level throw bypasses the {error} branch.
        setError("Something went wrong, try again")
      }
    })
  }

  return (
    <AlertDialog open={open} onOpenChange={(o: boolean) => { setOpen(o); if (!o) setError(null) }}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant={variant} size={size} className={className} disabled={isPending}>
          {children}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirm delete</AlertDialogTitle>
          <AlertDialogDescription>{confirmMessage}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p role="alert" className="text-sm text-destructive px-6">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e: React.MouseEvent<HTMLButtonElement>) => { e.preventDefault(); handleDelete() }}
            disabled={isPending}
          >
            {isPending ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
