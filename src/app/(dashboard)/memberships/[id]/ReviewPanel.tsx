"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { approveMembershipApplication, rejectMembershipApplication, type MatchCandidate } from "@/lib/actions/membership"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

export function ReviewPanel({
  applicationId,
  matches,
  status,
}: {
  applicationId: number
  matches: MatchCandidate[]
  status: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState(false)
  const [note, setNote] = useState("")

  if (status !== "PENDING") {
    return <p className="text-sm text-muted-foreground">This application has been {status.toLowerCase()}.</p>
  }

  function run(action: () => Promise<{ error: string } | { success: string } | undefined>) {
    setError(null)
    startTransition(async () => {
      const res = await action()
      if (res && "error" in res) {
        setError(res.error)
        return
      }
      router.push("/memberships")
      router.refresh()
    })
  }

  const reasonLabel: Record<MatchCandidate["reason"], string> = {
    email: "same email",
    mobile: "same mobile",
    surname: "same surname",
  }

  return (
    <section className="rounded-md border p-4">
      <h3 className="font-semibold mb-3">Approve into a family</h3>

      {matches.length > 0 ? (
        <>
          <p className="text-sm text-muted-foreground mb-2">Possible existing families:</p>
          <ul className="divide-y border rounded-md mb-4">
            {matches.map((m) => (
              <li key={`${m.familyId}-${m.reason}`} className="flex items-center justify-between px-3 py-2">
                <span className="text-sm">
                  {m.familyName} <span className="text-muted-foreground">({reasonLabel[m.reason]})</span>
                </span>
                <Button
                  variant="link"
                  size="sm"
                  disabled={pending}
                  onClick={() => run(() => approveMembershipApplication(applicationId, { mode: "merge", familyId: m.familyId }))}
                  className="min-h-11 px-2"
                >
                  Merge into this family
                </Button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-sm text-muted-foreground mb-4">No matching families found.</p>
      )}

      <div className="flex flex-wrap gap-3">
        <Button
          disabled={pending}
          onClick={() => run(() => approveMembershipApplication(applicationId, { mode: "create" }))}
        >
          Create new family
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => setRejecting((v) => !v)}
        >
          Reject
        </Button>
      </div>

      {rejecting && (
        <div className="mt-4">
          <Label htmlFor="reject-note" className="sr-only">Rejection reason</Label>
          <Textarea
            id="reject-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Reason (optional)"
            rows={2}
          />
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() => run(() => rejectMembershipApplication(applicationId, note || undefined))}
            className="mt-2"
          >
            Confirm reject
          </Button>
        </div>
      )}

      {error && <p role="alert" className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
    </section>
  )
}
