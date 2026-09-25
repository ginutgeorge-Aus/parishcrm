"use client"

import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"

export type TicketTypeRow = { id?: string; name: string; price: string; capacity: string; countsTowardWaiver: string }
// _key is a stable client-only React key (not submitted) so removing/reordering
// a row doesn't reattach input state to the wrong row, as index keys would.
export type Row = TicketTypeRow & { _key: string }

type Props = {
  rows: Row[]
  onAdd: () => void
  onRemove: (i: number) => void
  onUpdate: (i: number, field: keyof TicketTypeRow, value: string) => void
}

export function TicketTypesEditor({ rows, onAdd, onRemove, onUpdate }: Props) {
  return (
    <div>
      <div className="flex flex-col gap-2">
        {rows.map((row, i) => (
          <div key={row._key} className="flex flex-wrap gap-2 items-center">
            <input type="hidden" name={`ticketType.${i}.id`} value={row.id ?? ""} />
            <Input
              aria-label={`Ticket name (row ${i + 1})`}
              name={`ticketType.${i}.name`}
              value={row.name}
              onChange={e => onUpdate(i, "name", e.target.value)}
              placeholder="Name (e.g. Adult)"
              className="flex-1"
              required
            />
            <Input
              aria-label={`Ticket price (row ${i + 1})`}
              name={`ticketType.${i}.price`}
              value={row.price}
              onChange={e => onUpdate(i, "price", e.target.value)}
              placeholder="Price (0 = free)"
              type="number"
              min="0"
              step="0.01"
              className="w-28"
              required
            />
            <Input
              aria-label={`Ticket capacity (row ${i + 1})`}
              name={`ticketType.${i}.capacity`}
              value={row.capacity}
              onChange={e => onUpdate(i, "capacity", e.target.value)}
              placeholder="Capacity (blank = ∞)"
              type="number"
              min="1"
              className="w-36"
            />
            <label htmlFor={`ticketType.${i}.countsToward`} className="flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap">
              <Checkbox
                id={`ticketType.${i}.countsToward`}
                name={`ticketType.${i}.countsToward`}
                aria-label={`Counts toward family waiver (row ${i + 1})`}
                checked={row.countsTowardWaiver !== "false"}
                onCheckedChange={(c: boolean | "indeterminate") => onUpdate(i, "countsTowardWaiver", c === true ? "true" : "false")}
              />
              Waiver
            </label>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove ticket type (row ${i + 1})`}
              onClick={() => onRemove(i)}
              className="text-muted-foreground hover:text-destructive"
            >
              <X />
            </Button>
          </div>
        ))}
      </div>
      <Button type="button" variant="link" size="sm" onClick={onAdd} className="mt-2 px-0">
        + Add ticket type
      </Button>
    </div>
  )
}
