"use client"

import { useState, useTransition } from "react"
import { resyncEventsToWebsite } from "@/lib/actions/event"
import { Button } from "@/components/ui/button"

// ADMIN backstop: re-push every event to the public website in case a webhook was missed.
export function ResyncEventsButton() {
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            try {
              const result = await resyncEventsToWebsite()
              setMsg(result && "success" in result ? result.success : result?.error ?? "Done")
            } catch {
              // Transport-level throw bypasses the result branch.
              setMsg("Something went wrong, try again")
            }
          })
        }
      >
        {pending ? "Syncing…" : "Resync website"}
      </Button>
      {msg && <span role="status" aria-live="polite" className="text-xs text-muted-foreground">{msg}</span>}
    </span>
  )
}
