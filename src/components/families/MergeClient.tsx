"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { previewMerge, mergeFamilies, MergePreview } from "@/lib/actions/family"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type Family = { id: number; name: string; memberNo: string | null }

export function MergeClient({ families }: { families: Family[] }) {
  const [sourceId, setSourceId] = useState<string>("")
  const [targetId, setTargetId] = useState<string>("")
  const [preview, setPreview] = useState<MergePreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handlePreview() {
    setError(null)
    const src = parseInt(sourceId, 10)
    const tgt = parseInt(targetId, 10)
    if (!src || !tgt) { setError("Select both families."); return }
    startTransition(async () => {
      const result = await previewMerge(src, tgt)
      if ("error" in result) { setError(result.error); return }
      setPreview(result)
    })
  }

  function handleConfirm() {
    if (!preview) return
    startTransition(async () => {
      const result = await mergeFamilies(preview.source.id, preview.target.id)
      if (result?.error) { setError(result.error); return }
      if (result?.conflicts) {
        setError(`Conflicts: ${result.conflicts.join(", ")}. Resolve manually first.`)
        return
      }
      router.push("/families")
    })
  }

  if (preview) {
    return (
      <div className="space-y-6 max-w-lg">
        <div>
          <h3 className="font-semibold text-foreground">Confirm merge</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Merging <strong>{preview.source.name}</strong> into <strong>{preview.target.name}</strong>. This cannot be undone.
          </p>
        </div>
        <ul className="text-sm space-y-1 text-muted-foreground">
          <li>{preview.peopleCount} people will be reassigned</li>
          <li>{preview.transactionCount} transactions will be reassigned</li>
          <li><strong>{preview.source.name}</strong> will be permanently deleted</li>
        </ul>
        {preview.conflicts.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
            <p className="font-medium">Cannot merge — duplicate person names:</p>
            <ul className="mt-1 list-disc pl-4">
              {preview.conflicts.map((name) => <li key={name}>{name}</li>)}
            </ul>
            <p className="mt-2">Rename or delete duplicates in one family before merging.</p>
          </div>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-3">
          <Button variant="destructive" onClick={handleConfirm} disabled={isPending || preview.conflicts.length > 0}>
            {isPending ? "Merging…" : "Confirm merge"}
          </Button>
          <Button variant="outline" onClick={() => { setPreview(null); setError(null) }} disabled={isPending}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-lg">
      <p className="text-sm text-muted-foreground">
        Select the duplicate (source) and the record to keep (target). All people and transactions from the source will be moved to the target, then the source is deleted.
      </p>
      <div className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="source">Source — duplicate to delete</Label>
          <Select value={sourceId} onValueChange={setSourceId}>
            <SelectTrigger id="source" className="w-full">
              <SelectValue placeholder="Select family…" />
            </SelectTrigger>
            <SelectContent>
              {families.map((f) => (
                <SelectItem key={f.id} value={String(f.id)}>{f.name}{f.memberNo ? ` (${f.memberNo})` : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="target">Target — record to keep</Label>
          <Select value={targetId} onValueChange={setTargetId}>
            <SelectTrigger id="target" className="w-full">
              <SelectValue placeholder="Select family…" />
            </SelectTrigger>
            <SelectContent>
              {families.map((f) => (
                <SelectItem key={f.id} value={String(f.id)}>{f.name}{f.memberNo ? ` (${f.memberNo})` : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {sourceId && targetId && sourceId === targetId && (
        <p role="alert" className="text-sm text-warning">Source and target must be different families.</p>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button onClick={handlePreview} disabled={isPending || !sourceId || !targetId || sourceId === targetId}>
        {isPending ? "Loading…" : "Preview merge"}
      </Button>
    </div>
  )
}
