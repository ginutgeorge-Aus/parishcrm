"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { resendWelcome } from "@/lib/actions/user"

export function ResendWelcomeButton({ userId, className }: { userId: number; className?: string }) {
  const [isPending, startTransition] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        className={className}
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const r = await resendWelcome(userId)
            setMsg(r && "error" in r ? r.error ?? "Failed" : "Sent")
          })
        }
      >
        {isPending ? "Sending…" : "Resend welcome"}
      </Button>
      {msg && <span role="status" aria-live="polite" className="text-xs text-muted-foreground">{msg}</span>}
    </div>
  )
}
