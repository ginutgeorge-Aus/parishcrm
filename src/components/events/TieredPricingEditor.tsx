"use client"

import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Row = { price: string; _key: string }

// `active` mirrors the parent's tieredPricingEnabled toggle. When false the
// section is display:none, so its `required` inputs must be disabled — a hidden
// required control the browser can't focus silently aborts the whole form
// submit ("not focusable"). Disabled inputs are excluded from validation and
// FormData; the server ignores tier fields unless tiered pricing is enabled.
export function TieredPricingEditor({ defaultTiers, active }: { defaultTiers: string[]; active: boolean }) {
  const keySeq = useRef(0)
  const [rows, setRows] = useState<Row[]>(
    () => (defaultTiers.length ? defaultTiers : [""]).map((p, i) => ({ price: p, _key: `tier-init-${i}` }))
  )
  const add = () => setRows((r) => [...r, { price: "", _key: `tier-new-${keySeq.current++}` }])
  const remove = (key: string) => setRows((r) => (r.length > 1 ? r.filter((x) => x._key !== key) : r))

  return (
    <div className="mt-2 space-y-2">
      {rows.map((row, idx) => (
        <div key={row._key} className="flex items-end gap-2">
          <div className="flex-1">
            <Label htmlFor={`tier.${idx}.price`}>Price for {idx + 1} attendee{idx > 0 ? "s" : ""} ($)</Label>
            <Input
              id={`tier.${idx}.price`}
              name={`tier.${idx}.price`}
              inputMode="decimal"
              required
              disabled={!active}
              defaultValue={row.price}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => remove(row._key)}
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
