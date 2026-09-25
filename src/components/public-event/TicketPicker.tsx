"use client"

import { QuestionField } from "./QuestionField"
import type { CustomQuestion } from "@/lib/eventQuestions"
import { fmtAUD } from "@/lib/formatting"

type TicketType = { id: number; name: string; price: number; capacity: number | null }
type SoldMap = Record<number, number>

// Upper bound per ticket type, mirroring the server's `tickets` Zod cap (max 100
// in eventRegistration.ts). Bounds an uncapped (capacity === null) type so a huge
// typed quantity can't allocate a giant attendee array and freeze the tab.
const MAX_PER_TYPE = 100

type Props = {
  ticketTypes: TicketType[]
  soldCounts: SoldMap
  quantities: Record<number, number>
  names: Record<number, string[]>
  onChange: (id: number, qty: number) => void
  onNameChange: (id: number, index: number, value: string) => void
  attendeeQuestions: (tt: TicketType) => CustomQuestion[]
  attendeeAnswers: Record<number, Array<Record<string, string | string[] | boolean | boolean[]>>>
  onAttendeeAnswerChange: (ttId: number, index: number, qid: string, value: string | string[] | boolean | boolean[]) => void
}

export function TicketPicker({ ticketTypes, soldCounts, quantities, names, onChange, onNameChange, attendeeQuestions, attendeeAnswers, onAttendeeAnswerChange }: Props) {
  return (
    <div className="bg-muted rounded-xl border border-border p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Select Tickets</p>
      <div className="flex flex-col gap-3">
        {ticketTypes.map(tt => {
          const price = tt.price
          const sold = soldCounts[tt.id] ?? 0
          // Cap even an uncapped type at MAX_PER_TYPE so `Array.from({length: qty})`
          // below can never allocate an unbounded array. Floor at 0 so an
          // oversold type (sold > capacity) yields 0, not a negative remaining that
          // `Math.min(qty, remaining)` could push into a negative qty → RangeError
          // in `Array.from({length: qty})`.
          const remaining = tt.capacity !== null ? Math.max(0, Math.min(tt.capacity - sold, MAX_PER_TYPE)) : MAX_PER_TYPE
          const soldOut = remaining <= 0
          const qty = quantities[tt.id] ?? 0
          const attQuestions = attendeeQuestions(tt)

          return (
            <div key={tt.id} className="flex flex-col gap-2">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-sm font-semibold text-foreground">{tt.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {price === 0 ? "Free" : `${fmtAUD(price)} per ticket`}
                    {soldOut && " · Sold out"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    aria-label={`Decrease ${tt.name} quantity`}
                    disabled={qty === 0}
                    onClick={() => onChange(tt.id, qty - 1)}
                    className="w-11 h-11 rounded border border-border flex items-center justify-center text-muted-foreground disabled:opacity-40"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={remaining}
                    aria-label={`${tt.name} quantity`}
                    disabled={soldOut}
                    value={qty}
                    onChange={e => {
                      const n = Math.floor(Number(e.target.value))
                      const safe = Number.isFinite(n) && n > 0 ? n : 0
                      onChange(tt.id, Math.min(safe, remaining))
                    }}
                    className="w-14 h-11 text-center font-bold text-foreground border border-border rounded focus:outline-hidden focus:ring-2 focus:ring-ring disabled:opacity-40"
                  />
                  <span aria-live="polite" className="sr-only">
                    {qty} {tt.name} selected
                  </span>
                  <button
                    type="button"
                    aria-label={`Increase ${tt.name} quantity`}
                    disabled={soldOut || qty >= remaining}
                    onClick={() => onChange(tt.id, qty + 1)}
                    className="w-11 h-11 rounded bg-primary flex items-center justify-center text-primary-foreground disabled:opacity-40"
                  >
                    +
                  </button>
                </div>
              </div>

              {qty > 0 && (
                <div className="flex flex-col gap-1.5 pl-1">
                  {Array.from({ length: qty }).map((_, i) => (
                    <div key={i} className="flex flex-col gap-1.5">
                      <label htmlFor={`att-name-${tt.id}-${i}`} className="text-sm font-medium text-foreground">
                        {`${tt.name} ${i + 1}`}
                      </label>
                      <input
                        id={`att-name-${tt.id}-${i}`}
                        placeholder={`${tt.name} ${i + 1} — full name`}
                        required
                        autoComplete="off"
                        value={names[tt.id]?.[i] ?? ""}
                        onChange={e => onNameChange(tt.id, i, e.target.value)}
                        className="w-full border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring"
                      />
                      {attQuestions.map(q => (
                        <QuestionField
                          key={q.id}
                          q={q}
                          idPrefix={`att-${tt.id}-${i}`}
                          value={attendeeAnswers[tt.id]?.[i]?.[q.id]}
                          onChange={v => onAttendeeAnswerChange(tt.id, i, q.id, v)}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
