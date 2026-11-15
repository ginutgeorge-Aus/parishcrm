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

export function MergeClient({ families }: Readonly<{ families: Family[] }>) {
  const [sourceId, setSourceId] = useState<string>("")
  const [targetId, setTargetId] = useState<string>("")
  const [preview, setPreview] = useState<MergePreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  // Set after a merge that kept some fundraiser entries as separate rows, so
  // the admin sees that before leaving the page.
  const [keptSeparate, setKeptSeparate] = useState<number | null>(null)
  const router = useRouter()

  function handlePreview() {
    setError(null)
    const src = Number.parseInt(sourceId, 10)
    const tgt = Number.parseInt(targetId, 10)
    if (!src || !tgt) { setError("Select both families."); return }
    startTransition(async () => {
      const result = await previewMerge(src, tgt)
      if ("error" in result) { setError(result.error); return }
      setPreview(result)
    })
  }

  /**
   * Run the merge. On success go back to the families list, unless some
   * fundraiser entries were kept as separate rows: then show that first.
   */
  function handleConfirm() {
    if (!preview) return
    startTransition(async () => {
      const result = await mergeFamilies(preview.source.id, preview.target.id)
      if (result?.error) { setError(result.error); return }
      if (result?.conflicts) {
        setError(`Conflicts: ${result.conflicts.join(", ")}. Resolve manually first.`)
        return
      }
      const unlinked = result?.fundraiser?.unlinked ?? 0
      if (unlinked > 0) { setKeptSeparate(unlinked); return }
      router.push("/families")
    })
  }

  if (keptSeparate !== null) {
    return (
      <div className="space-y-4 max-w-lg" role="status">
        <h3 className="font-semibold text-foreground">Merge complete</h3>
        <p className="text-sm text-muted-foreground">
          {keptSeparate} fundraiser {keptSeparate === 1 ? "entry was" : "entries were"} kept as {keptSeparate === 1 ? "a separate row" : "separate rows"} under
          the merged family&apos;s name, because {keptSeparate === 1 ? "it" : "they"} could not be combined with the surviving family&apos;s entry (different price or delivery choice, or the combined
          amount or quantity would exceed the per-entry limit). Review {keptSeparate === 1 ? "it" : "them"} on
          the event&apos;s fundraiser page.
        </p>
        <Button onClick={() => router.push("/families")}>Back to families</Button>
      </div>
    )
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
          {preview.fundraiserEntryCount > 0 && (
            <li>{preview.fundraiserEntryCount} fundraiser entries will be reassigned (combined with the target&apos;s entry for the same fundraiser where possible; some may remain unlinked)</li>
          )}
          {preview.fundraiserEntriesKeptSeparate > 0 && (
            <li>{preview.fundraiserEntriesKeptSeparate} of them can&apos;t be combined (different price, or over the per-entry amount or quantity limit) and will stay as separate rows under <strong>{preview.source.name}</strong>&apos;s name</li>
          )}
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
