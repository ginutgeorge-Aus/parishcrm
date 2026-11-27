"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/** Rows shown for a price list: always at least one (blank) row so the first tier is enterable. */
function rowsFor(prices: string[]): string[] {
  return prices.length ? prices : [""]
}

// `active` mirrors the parent's tieredPricingEnabled toggle. When false the
// section is display:none, so its `required` inputs must be disabled — a hidden
// required control the browser can't focus silently aborts the whole form
// submit ("not focusable"). Disabled inputs are excluded from validation and
// FormData; the server ignores tier fields unless tiered pricing is enabled.
/**
 * Controlled tier price list: the parent form owns the prices (also used for its paid-event hint).
 * @param prices current tier prices, one per attendee count
 * @param onChange called with the new price list on any edit, add or remove
 * @param active whether tiered pricing is on (inputs are disabled when it is not)
 */
export function TieredPricingEditor({ prices, onChange, active }: Readonly<{ prices: string[]; onChange: (prices: string[]) => void; active: boolean }>) {
  const rows = rowsFor(prices)
  const setPrice = (idx: number, price: string) => onChange(rows.map((x, i) => (i === idx ? price : x)))
  const add = () => onChange([...rows, ""])
  const remove = (idx: number) => onChange(rows.length > 1 ? rows.filter((_, i) => i !== idx) : rows)

  return (
    <div className="mt-2 space-y-2">
      {rows.map((row, idx) => (
        // Index key: rows have no identity beyond position, and inputs are controlled.
        <div key={idx} className="flex items-end gap-2">
          <div className="flex-1">
            <Label htmlFor={`tier.${idx}.price`}>Price for {idx + 1} attendee{idx > 0 ? "s" : ""} ($)</Label>
            <Input
              id={`tier.${idx}.price`}
              name={`tier.${idx}.price`}
              inputMode="decimal"
              required
              disabled={!active}
              value={row}
              onChange={(e) => setPrice(idx, e.target.value)}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => remove(idx)}
            disabled={rows.length === 1}
            aria-label={`Remove tier (row ${idx + 1})`}
          >
            Remove
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" onClick={add}>Add tier</Button>
      <p className="text-xs text-muted-foreground">Total charged for the whole registration by attendee count. The number of tiers is the maximum group size.</p>
    </div>
  )
}
