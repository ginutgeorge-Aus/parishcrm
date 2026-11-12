"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { saveFundraiser } from "@/lib/actions/fundraiser"

/**
 * Create/edit form for an event's fundraiser settings. Changing the unit price
 * only affects entries created afterwards (entries snapshot the price).
 *
 * @param props.eventId - Event id.
 * @param props.initial - Existing settings, or undefined when none exist yet.
 */
export function FundraiserSettingsForm({
  eventId, initial,
}: Readonly<{ eventId: number; initial?: { name: string; unitLabel: string; unitPrice: string; refPrefix: string | null } }>) {
  const [name, setName] = useState(initial?.name ?? "")
  const [unitLabel, setUnitLabel] = useState(initial?.unitLabel ?? "")
  const [unitPrice, setUnitPrice] = useState(initial?.unitPrice ?? "")
  const [refPrefix, setRefPrefix] = useState(initial?.refPrefix ?? "")
  const [state, setState] = useState<{ error?: string; success?: string } | null>(null)
  const [pending, start] = useTransition()

  /** Save settings and show the result. */
  function submit(e: React.FormEvent) {
    e.preventDefault()
    setState(null)
    start(async () => {
      const res = await saveFundraiser(eventId, { name, unitLabel, unitPrice, refPrefix })
      setState(res?.error ? { error: res.error } : { success: "Saved" })
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="space-y-1">
        <Label htmlFor="fs-name">Name</Label>
        <Input id="fs-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="fs-label">Unit label</Label>
        <Input id="fs-label" value={unitLabel} onChange={(e) => setUnitLabel(e.target.value)} maxLength={40} placeholder="e.g. ticket" required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="fs-price">Unit price</Label>
        <Input id="fs-price" inputMode="decimal" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="fs-prefix">Bank ref prefix</Label>
        <Input id="fs-prefix" value={refPrefix} onChange={(e) => setRefPrefix(e.target.value)} maxLength={12} />
      </div>
      <div className="flex items-center gap-3 sm:col-span-2 xl:col-span-4">
        <Button type="submit" disabled={pending}>{pending ? "Saving..." : initial ? "Save settings" : "Create fundraiser"}</Button>
        <FormFeedback state={state} />
      </div>
    </form>
  )
}
