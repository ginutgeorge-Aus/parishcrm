"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { approveFamilyUpdate, rejectFamilyUpdate } from "@/lib/actions/familyUpdate"
import type { ActionResultWithSuccess } from "@/lib/actions/types"

export function SubmissionReview({ submissionId }: { submissionId: number }) {
  const router = useRouter()
  const [note, setNote] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [action, setAction] = useState<"approve" | "reject" | null>(null)
  const [pending, start] = useTransition()

  function run(which: "approve" | "reject", fn: () => Promise<ActionResultWithSuccess>) {
    setError(null)
    setAction(which)
    start(async () => {
      const res = await fn()
      if (res && "error" in res) {
        setError(res.error)
        setAction(null)
        return
      }
      router.push("/families/updates")
      router.refresh()
    })
  }

  return (
    <div className="space-y-3 border-t pt-4">
      <FormFeedback state={{ error }} />
      <label htmlFor="review-note" className="sr-only">Internal review note</label>
      <Textarea
        id="review-note"
        rows={2}
        placeholder="Optional note (shown only internally; reasoning for rejection)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex gap-3">
        <Button disabled={pending} aria-busy={pending && action === "approve"} onClick={() => run("approve", () => approveFamilyUpdate(submissionId))}>
          {pending && action === "approve" ? "Applying…" : "Approve & apply"}
        </Button>
        <Button variant="outline" disabled={pending} aria-busy={pending && action === "reject"} onClick={() => run("reject", () => rejectFamilyUpdate(submissionId, note))}>
          {pending && action === "reject" ? "Rejecting…" : "Reject"}
        </Button>
      </div>
    </div>
  )
}
