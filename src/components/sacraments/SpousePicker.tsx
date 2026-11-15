"use client"

import { useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { searchSacramentPeople, type SacramentPersonHit } from "@/lib/actions/sacrament"

/** The chosen CRM spouse. */
export type PickedSpouse = { id: number; name: string }

/**
 * Name search for a marriage's CRM spouse. Search runs on the Search button or
 * Enter (never submits the surrounding form); picking a result calls `onPick`.
 * Callers show the chosen spouse themselves and unmount this picker.
 */
export function SpousePicker({ onPick }: Readonly<{ onPick: (p: PickedSpouse) => void }>) {
  const [q, setQ] = useState("")
  const [hits, setHits] = useState<SacramentPersonHit[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  // Id of the latest search: Enter can start a new search while one is in flight,
  // so a slower, older response must not overwrite the newer one's results.
  const latest = useRef(0)

  /** Run the search; a failed call shows a message instead of throwing. Stale responses are dropped. */
  async function search() {
    if (!q.trim()) return
    const reqId = ++latest.current
    setBusy(true)
    setFailed(false)
    try {
      const found = await searchSacramentPeople(q)
      if (reqId === latest.current) setHits(found)
    } catch {
      if (reqId === latest.current) {
        setHits(null)
        setFailed(true)
      }
    } finally {
      if (reqId === latest.current) setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          aria-label="Search for the spouse"
          placeholder="Search members by name"
          value={q}
          maxLength={80}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              void search()
            }
          }}
        />
        <Button type="button" variant="outline" disabled={busy} onClick={() => void search()}>
          {busy ? "Searching…" : "Search"}
        </Button>
      </div>
      {failed && <p role="alert" className="text-sm text-destructive">Search failed. Try again.</p>}
      {hits && hits.length === 0 && <p className="text-sm text-muted-foreground">No members match.</p>}
      {hits && hits.length > 0 && (
        <ul className="divide-y rounded-md border text-sm">
          {hits.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-1 text-left hover:bg-muted"
                onClick={() => onPick({ id: h.id, name: h.name })}
              >
                <span>{h.name}</span>
                <span className="text-muted-foreground">{h.familyName}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
