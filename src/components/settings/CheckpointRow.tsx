"use client"

import { useState, useTransition } from "react"
import { CheckCircle2, XCircle } from "lucide-react"
import { markWorking, markBroken } from "@/lib/actions/checkpoint"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"

type Status = "PENDING" | "WORKING" | "BROKEN"

const BADGE: Record<Status, { label: string; variant: "outline" | "default" | "destructive" }> = {
  PENDING: { label: "Pending", variant: "outline" },
  WORKING: { label: "Working", variant: "default" },
  BROKEN: { label: "Not working", variant: "destructive" },
}

export function CheckpointRow({
  checkpoint,
  status,
  issueNumber,
}: {
  checkpoint: { id: string; area: string; title: string; steps: string }
  status: Status
  issueNumber: number | null
}) {
  const [isPending, startTransition] = useTransition()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [note, setNote] = useState("")
  const [error, setError] = useState<string | null>(null)
  const badge = BADGE[status]

  function onWorking() {
    setError(null)
    startTransition(async () => {
      const res = await markWorking(checkpoint.id)
      if (res && "error" in res) setError(res.error)
    })
  }

  function onBrokenSubmit() {
    setError(null)
    startTransition(async () => {
      const res = await markBroken(checkpoint.id, note)
      if (res && "error" in res) {
        setError(res.error)
        return
      }
      setDialogOpen(false)
      setNote("")
    })
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">{checkpoint.area}</span>
          <Badge variant={badge.variant}>{badge.label}</Badge>
          {issueNumber && status === "BROKEN" ? (
            <span className="text-xs text-muted-foreground">#{issueNumber}</span>
          ) : null}
        </div>
        <p className="mt-1 font-medium text-foreground">{checkpoint.title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{checkpoint.steps}</p>
        {error ? <p role="alert" className="mt-1 text-sm text-destructive">{error}</p> : null}
      </div>

      <div className="flex shrink-0 gap-2">
        {status !== "WORKING" && (
          <Button size="sm" variant="outline" disabled={isPending} onClick={onWorking}>
            <CheckCircle2 className="mr-1 h-4 w-4" /> Working
          </Button>
        )}
        {status !== "BROKEN" && (
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => setDialogOpen(true)}
          >
            <XCircle className="mr-1 h-4 w-4" /> Not working
          </Button>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>What&apos;s broken?</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="checkpoint-note">Describe what went wrong</Label>
            <Textarea
              id="checkpoint-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={4}
              placeholder="e.g. The Cancel button does nothing when clicked"
            />
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button onClick={onBrokenSubmit} disabled={isPending || note.trim().length === 0}>
              File bug
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
