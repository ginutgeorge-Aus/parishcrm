"use client"

import { Minus, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useId } from "react"
import { MAX_COUNT } from "@/lib/attendance"

/**
 * A whole-number counter: − / + buttons (44px tap targets) around a numeric
 * input. Never goes below 0 or above MAX_COUNT; non-numeric typing is ignored.
 */
export function Counter({
  label,
  value,
  onChange,
}: Readonly<{ label: string; value: number; onChange: (next: number) => void }>) {
  const id = useId()
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-11 w-11 shrink-0 p-0"
          aria-label={`Decrease ${label}`}
          disabled={value <= 0}
          onClick={() => onChange(Math.max(0, value - 1))}
        >
          <Minus className="h-5 w-5" aria-hidden />
        </Button>
        <Input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={String(value)}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            const raw = e.target.value
            if (!/^\d*$/.test(raw)) return
            onChange(raw === "" ? 0 : Math.min(MAX_COUNT, Number.parseInt(raw, 10)))
          }}
          className="h-11 min-w-0 flex-1 text-center text-lg tabular-nums"
        />
        <Button
          type="button"
          variant="outline"
          className="h-11 w-11 shrink-0 p-0"
          aria-label={`Increase ${label}`}
          disabled={value >= MAX_COUNT}
          onClick={() => onChange(Math.min(MAX_COUNT, value + 1))}
        >
          <Plus className="h-5 w-5" aria-hidden />
        </Button>
      </div>
    </div>
  )
}
