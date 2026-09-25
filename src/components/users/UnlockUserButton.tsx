"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { unlockUser } from "@/lib/actions/user"

export function UnlockUserButton({ userId, className }: { userId: number; className?: string }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button
        variant="outline"
        size="sm"
        className={className}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null)
            const result = await unlockUser(userId)
            if (result?.error) setError(result.error)
          })
        }
      >
        {pending ? "Unlocking…" : "Unlock"}
      </Button>
    </>
  )
}
