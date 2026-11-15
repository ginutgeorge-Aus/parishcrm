"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { addEntry, searchFundraiserFamilies } from "@/lib/actions/fundraiser"
import { FAMILY_SEARCH_LIMIT as SEARCH_LIMIT, FAMILY_SEARCH_MIN as MIN_SEARCH } from "@/lib/fundraiserMath"

type FamilyOption = { id: number; name: string }

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
   * Update the query, clear the previous results, and schedule a debounced
   * server search. Each change bumps a sequence number; a response for an
   * older query is dropped.
   * @param value - New search text.
   */
  function onQueryChange(value: string) {
    setQuery(value)
    // Drop the old list at once: its buttons must not stay clickable for a
    // query that no longer matches what is typed.
    setResults(null)
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

  /**
   * Pick a family: cancel any pending search and drop in-flight responses, so
   * a late result list cannot reappear over the choice.
   * @param f - Chosen family.
   */
  function pick(f: FamilyOption) {
    clearTimeout(timer.current)
    latest.current++
    onSelect(f)
  }

  if (selected) {
    // A read-only input keeps the "Family" label pointing at a real control.
    return (
      <div className="flex items-center gap-2">
        <Input id="fe-family" value={selected.name} readOnly className="min-h-11 min-w-0 flex-1 font-medium sm:min-h-9" />
        <Button type="button" size="sm" variant="outline" className="min-h-11 shrink-0 sm:min-h-0" onClick={() => onSelect(null)}
          // The picked result button unmounts; keep keyboard focus in the dialog.
          autoFocus>
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
        // Enter in the search box must not submit the add-entry form.
        onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault() }}
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
                    onClick={() => pick(f)}
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
 * @param props.hasDelivery - Fundraiser has a delivery price: show the Pickup/Delivery choice.
 */
export function AddEntryDialog({
  fundraiserId, hasDelivery = false,
}: Readonly<{ fundraiserId: number; hasDelivery?: boolean }>) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<"member" | "outside">("member")
  const [family, setFamily] = useState<FamilyOption | null>(null)
  const [outsideName, setOutsideName] = useState("")
  const [outsideEmail, setOutsideEmail] = useState("")
  const [outsidePhone, setOutsidePhone] = useState("")
  const [quantity, setQuantity] = useState("1")
  const [delivery, setDelivery] = useState(false)
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
            ? { familyId: family?.id, quantity, ...(hasDelivery && { delivery }) }
            : { outsideName, outsideEmail, outsidePhone, quantity, ...(hasDelivery && { delivery }) },
        )
      } catch {
        setError("Could not add the entry. Please try again.")
        return
      }
      if (res?.error) { setError(res.error); return }
      setOpen(false)
      setFamily(null); setOutsideName(""); setOutsideEmail(""); setOutsidePhone(""); setQuantity("1"); setDelivery(false)
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
          {hasDelivery && (
            <div className="space-y-1">
              <Label htmlFor="fe-delivery">Pickup or delivery</Label>
              <select
                id="fe-delivery"
                className="h-11 md:h-8 any-pointer-coarse:h-11 w-full rounded-lg border border-input bg-background px-2.5 text-base md:text-sm"
                value={delivery ? "delivery" : "pickup"}
                onChange={(e) => setDelivery(e.target.value === "delivery")}
              >
                <option value="pickup">Pickup</option>
                <option value="delivery">Delivery</option>
              </select>
            </div>
          )}
          <FormFeedback state={{ error }} />
          <Button type="submit" disabled={pending}>{pending ? "Adding..." : "Add entry"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
