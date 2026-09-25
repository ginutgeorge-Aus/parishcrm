"use client"

import { useRef, useState, useActionState } from "react"
import { Check, ChevronsUpDown, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { fmtAUD, sumCents, centsToNumber } from "@/lib/formatting"
import { fyLabel } from "@/lib/dgr"
import { createDgrReceipt, updateDgrReceipt, getDonorEmail } from "@/lib/actions/dgrReceipt"

type PersonOpt = { id: number; name: string }
type LineRow = { date: string; amount: string; method: string }
type EditReceipt = {
  id: number
  personId: string
  email: string
  fyEndYear: number
  lines: LineRow[]
}

const emptyLine = (): LineRow => ({ date: "", amount: "", method: "Bank Transfer" })

export default function DgrReceiptForm({
  persons,
  currentFyEndYear,
  edit,
}: {
  persons: PersonOpt[]
  currentFyEndYear: number
  // When present the form edits an existing DRAFT/FAILED receipt via
  // updateDgrReceipt instead of creating a new one; the FY is fixed.
  edit?: EditReceipt
}) {
  const action = edit ? updateDgrReceipt.bind(null, edit.id) : createDgrReceipt
  const [state, formAction, isPending] = useActionState(action, undefined)
  const [personId, setPersonId] = useState(edit?.personId ?? "")
  const [email, setEmail] = useState(edit?.email ?? "")
  const [emailError, setEmailError] = useState<string | null>(null)
  const [donorOpen, setDonorOpen] = useState(false)
  // Monotonic id guarding the async donor-email lookup: only the newest select's
  // result may write `email`, so a fast reselect can't attach donor A's email to
  // donor B's receipt (PII misdirection).
  const emailReqId = useRef(0)
  const [lines, setLines] = useState<LineRow[]>(edit?.lines?.length ? edit.lines : [emptyLine()])

  const selected = persons.find((p) => String(p.id) === personId)
  const fyOptions = Array.from({ length: 6 }, (_, i) => currentFyEndYear - i)

  // A row counts once it has any donation data. Both the on-screen total AND the
  // submitted payload derive from this SAME set, so the receipt total can never be
  // lower than what staff saw. A partial row (amount, no date) stays in — the server
  // Zod rejects it with a clear error rather than silently dropping it.
  const activeLines = lines.filter((l) => l.date || l.amount)
  const total = centsToNumber(sumCents(activeLines.map((l) => l.amount || '0')))
  const serializedLines = JSON.stringify(
    activeLines.map((l) => ({ date: l.date, amount: Number(l.amount), method: l.method }))
  )

  function updateLine(i: number, patch: Partial<LineRow>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }

  return (
    <form action={formAction} className="max-w-2xl space-y-5">
      {state?.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}

      <input type="hidden" name="personId" value={personId} />
      <input type="hidden" name="lines" value={serializedLines} />

      <div className="space-y-1">
        <Label>Donor</Label>
        <Popover open={donorOpen} onOpenChange={setDonorOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={donorOpen}
              className="w-full justify-between font-normal"
            >
              {selected ? selected.name : "Search donor…"}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-full p-0" align="start">
            <Command>
              <CommandInput placeholder="Type a name…" />
              <CommandList>
                <CommandEmpty>No person found.</CommandEmpty>
                <CommandGroup>
                  {persons.map((p) => (
                    <CommandItem
                      key={p.id}
                      // Unique value (name+id) so two donors sharing a display name
                      // (father/son) don't collide in cmdk's value map and resolve to
                      // the wrong person.
                      value={`${p.name}\u0000${p.id}`}
                      onSelect={() => {
                        setPersonId(String(p.id))
                        setDonorOpen(false)
                        setEmailError(null)
                        const reqId = ++emailReqId.current
                        getDonorEmail(p.id)
                          .then((r) => {
                            // Ignore a stale resolution — a newer donor was picked.
                            if (reqId !== emailReqId.current) return
                            if ("email" in r) setEmail(r.email ?? "")
                            else setEmailError("Could not load this donor's email — enter it manually.")
                          })
                          .catch(() => {
                            if (reqId !== emailReqId.current) return
                            setEmailError("Could not load this donor's email — enter it manually.")
                          })
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          personId === String(p.id) ? "opacity-100" : "opacity-0"
                        )}
                      />
                      {p.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      <div className="space-y-1">
        <Label htmlFor="donorEmail">Donor email</Label>
        <Input
          id="donorEmail"
          name="donorEmail"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="donor@example.com"
          required
        />
        {emailError && <p role="alert" className="text-sm text-destructive">{emailError}</p>}
      </div>

      <div className="space-y-1">
        <Label htmlFor="fyEndYear">Financial year</Label>
        {edit ? (
          // The receipt number is derived from the FY at creation, so editing
          // never changes it — show it read-only and submit it as a hidden field.
          <>
            <input type="hidden" name="fyEndYear" value={String(edit.fyEndYear)} />
            <p id="fyEndYear" className="h-9 flex items-center text-sm text-muted-foreground">
              {fyLabel(edit.fyEndYear)}
            </p>
          </>
        ) : (
          <Select name="fyEndYear" defaultValue={String(currentFyEndYear)}>
            <SelectTrigger id="fyEndYear" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {fyOptions.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {fyLabel(y)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="space-y-3">
        <Label>Donation lines</Label>
        {lines.map((l, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground block">Date</span>
              <Input
                type="date"
                aria-label={`Date for line ${i + 1}`}
                value={l.date}
                onChange={(e) => updateLine(i, { date: e.target.value })}
                className="w-40"
              />
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground block">Amount</span>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                aria-label={`Amount for line ${i + 1}`}
                value={l.amount}
                onChange={(e) => updateLine(i, { amount: e.target.value })}
                className="w-32"
              />
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground block">Method</span>
              <Input
                type="text"
                aria-label={`Method for line ${i + 1}`}
                value={l.method}
                onChange={(e) => updateLine(i, { method: e.target.value })}
                className="w-40"
              />
            </div>
            {lines.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove line ${i + 1}`}
                onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setLines((prev) => [...prev, emptyLine()])}
        >
          <Plus className="mr-1 h-4 w-4" /> Add line
        </Button>
      </div>

      <p className="text-sm font-medium">
        Total: <span data-testid="dgr-total">{fmtAUD(total)}</span>
      </p>

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={isPending}>
          {edit
            ? isPending
              ? "Saving…"
              : "Save changes"
            : isPending
              ? "Creating…"
              : "Create receipt"}
        </Button>
      </div>
    </form>
  )
}
