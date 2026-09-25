"use client"

import { useRef, useState } from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MAX_ORGANIZERS, type Organizer } from "@/lib/eventOrganizers"

// _key is a stable client-only React key (not submitted) so removing a row
// doesn't reattach input state to the wrong row, as index keys would.
type Row = { name: string; phone: string; _key: string }

export function OrganizersEditor({ initial }: { initial: Organizer[] }) {
  const keySeq = useRef(0)
  const [rows, setRows] = useState<Row[]>(
    () => initial.map((o, i) => ({ name: o.name, phone: o.phone ?? "", _key: `org-init-${i}` })),
  )

  const add = () =>
    setRows((r) => [...r, { name: "", phone: "", _key: `org-new-${keySeq.current++}` }])
  const remove = (i: number) => setRows((r) => r.filter((_, idx) => idx !== i))
  const update = (i: number, field: "name" | "phone", value: string) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)))

  return (
    <div className="space-y-3">
      {rows.map((row, i) => (
        <div key={row._key} className="flex items-end gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-muted-foreground" htmlFor={`organizer-${row._key}-name`}>
              Name
            </label>
            <Input
              id={`organizer-${row._key}-name`}
              name={`organizer.${i}.name`}
              value={row.name}
              onChange={(e) => update(i, "name", e.target.value)}
              maxLength={200}
              placeholder="e.g. John Miller"
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs text-muted-foreground" htmlFor={`organizer-${row._key}-phone`}>
              Phone <span className="font-normal">(optional)</span>
            </label>
            <Input
              id={`organizer-${row._key}-phone`}
              name={`organizer.${i}.phone`}
              type="tel"
              value={row.phone}
              onChange={(e) => update(i, "phone", e.target.value)}
              maxLength={50}
              placeholder="0412 345 678"
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => remove(i)}
            aria-label={`Remove organiser (row ${i + 1})`}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
      {rows.length < MAX_ORGANIZERS && (
        <Button type="button" variant="outline" size="sm" onClick={add}>
          Add organiser
        </Button>
      )}
    </div>
  )
}
