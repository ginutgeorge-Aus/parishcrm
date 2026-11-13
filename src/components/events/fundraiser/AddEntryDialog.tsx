"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { addEntry, searchFundraiserFamilies } from "@/lib/actions/fundraiser"

type FamilyOption = { id: number; name: string }

/** Matches the server cap: a full page of results means there may be more. */
const SEARCH_LIMIT = 20
const MIN_SEARCH = 2
const SEARCH_DEBOUNCE_MS = 250

/**
 * Type-to-search family picker. Searches the server as the user types
 * (debounced), so the page never loads every family. Out-of-order responses
 * are ignored: only the latest query's results are shown.
 *
 * @param props.fundraiserId - Fundraiser id (families already on it are excluded).
 * @param props.selected - The chosen family, or null.
 * @param props.onSelect - Called with the chosen family, or null to change it.
 */
function FamilySearch({
  fundraiserId, selected, onSelect,
}: Readonly<{ fundraiserId: number; selected: FamilyOption | null; onSelect: (f: FamilyOption | null) => void }>) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<FamilyOption[] | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)
  const latest = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  /**
   * Update the query and schedule a debounced server search. Each change bumps
   * a sequence number; a response for an older query is dropped.
   * @param value - New search text.
   */
  function onQueryChange(value: string) {
    setQuery(value)
    clearTimeout(timer.current)
    const seq = ++latest.current
    const q = value.trim()
    if (q.length < MIN_SEARCH) { setResults(null); setSearchError(null); return }
    timer.current = setTimeout(async () => {
      let res: Awaited<ReturnType<typeof searchFundraiserFamilies>>
      try {
        res = await searchFundraiserFamilies(fundraiserId, q)
      } catch {
        res = { error: "Search failed. Please try again." }
      }
      if (seq !== latest.current) return
      if ("error" in res) { setSearchError(res.error); setResults(null) }
      else { setSearchError(null); setResults(res.families) }
    }, SEARCH_DEBOUNCE_MS)
  }

  if (selected) {
    return (
      <div className="flex min-h-11 items-center justify-between gap-2 rounded-md border px-3 py-1 text-sm sm:min-h-9">
        <span className="min-w-0 truncate font-medium text-foreground">{selected.name}</span>
        <Button type="button" size="sm" variant="ghost" className="min-h-11 shrink-0 sm:min-h-0" onClick={() => onSelect(null)}>
          Change
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <Input
        id="fe-family"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Type at least 2 letters of the name"
        autoComplete="off"
        maxLength={120}
        className="min-h-11 sm:min-h-9"
      />
      <FormFeedback state={{ error: searchError }} />
      {results !== null && (
        results.length === 0 ? (
          <p className="text-sm text-muted-foreground">No matching family that isn&apos;t already on this fundraiser.</p>
        ) : (
          <>
            <ul className="max-h-60 divide-y divide-border overflow-y-auto rounded-md border" aria-label="Matching families">
              {results.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-center px-3 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none sm:min-h-9"
                    onClick={() => onSelect(f)}
                  >
                    <span className="min-w-0 truncate">{f.name}</span>
                  </button>
                </li>
              ))}
            </ul>
            {results.length >= SEARCH_LIMIT && (
              <p className="text-xs text-muted-foreground">Showing the first {SEARCH_LIMIT} matches. Type more of the name to narrow it down.</p>
            )}
          </>
        )
      )}
    </div>
  )
}

/**
 * Dialog to add a member family or an outside buyer to the fundraiser.
 * Exactly one of family / outside name is sent. Server errors are shown inline.
 * Families are found with a server-side search, not a full list.
 *
 * @param props.fundraiserId - Fundraiser id.
 */
export function AddEntryDialog({ fundraiserId }: Readonly<{ fundraiserId: number }>) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<"member" | "outside">("member")
  const [family, setFamily] = useState<FamilyOption | null>(null)
  const [outsideName, setOutsideName] = useState("")
  const [outsideEmail, setOutsideEmail] = useState("")
  const [outsidePhone, setOutsidePhone] = useState("")
  const [quantity, setQuantity] = useState("1")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  /** Submit the new entry; close and reset on success. */
  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (mode === "member" && !family) { setError("Choose a family"); return }
    start(async () => {
      let res: Awaited<ReturnType<typeof addEntry>>
      try {
        res = await addEntry(
          fundraiserId,
          mode === "member"
            ? { familyId: family?.id, quantity }
            : { outsideName, outsideEmail, outsidePhone, quantity },
        )
      } catch {
        setError("Could not add the entry. Please try again.")
        return
      }
      if (res?.error) { setError(res.error); return }
      setOpen(false)
      setFamily(null); setOutsideName(""); setOutsideEmail(""); setOutsidePhone(""); setQuantity("1")
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm">Add entry</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add entry</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="flex gap-2">
            <Button type="button" size="sm" variant={mode === "member" ? "default" : "outline"} onClick={() => setMode("member")}>Member</Button>
            <Button type="button" size="sm" variant={mode === "outside" ? "default" : "outline"} onClick={() => setMode("outside")}>Outside buyer</Button>
          </div>
          {mode === "member" ? (
            <div className="space-y-1">
              <Label htmlFor="fe-family">Family</Label>
              <FamilySearch fundraiserId={fundraiserId} selected={family} onSelect={setFamily} />
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <Label htmlFor="fe-name">Name</Label>
                <Input id="fe-name" value={outsideName} onChange={(e) => setOutsideName(e.target.value)} maxLength={120} required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="fe-email">Email (optional)</Label>
                <Input id="fe-email" type="email" value={outsideEmail} onChange={(e) => setOutsideEmail(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="fe-phone">Phone (optional)</Label>
                <Input id="fe-phone" type="tel" value={outsidePhone} onChange={(e) => setOutsidePhone(e.target.value)} />
              </div>
            </>
          )}
          <div className="space-y-1">
            <Label htmlFor="fe-qty">Quantity</Label>
            <Input id="fe-qty" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
          </div>
          <FormFeedback state={{ error }} />
          <Button type="submit" disabled={pending}>{pending ? "Adding..." : "Add entry"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
