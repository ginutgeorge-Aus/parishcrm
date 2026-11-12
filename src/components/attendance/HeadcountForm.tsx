"use client"

import { useRef, useState, useTransition } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { deleteHeadcount, saveHeadcount } from "@/lib/actions/attendance"
import type { RecentHeadcount } from "@/lib/attendanceQueries"
import { Counter } from "./Counter"
import { RecentHeadcounts } from "./RecentHeadcounts"

type Message = { kind: "ok" | "error"; text: string }

/**
 * Headcount entry form (mobile-first, single column below md) plus the recent
 * list. Choosing a date + service that already has a recorded row loads its
 * counts (edit mode); saving the same pair edits it. `rows` is the recent list,
 * so a pair older than that window is still safely upserted but not pre-filled.
 */
export function HeadcountForm({
  serviceTypes,
  rows,
  today,
}: Readonly<{
  serviceTypes: { id: number; name: string }[]
  rows: RecentHeadcount[]
  today: string
}>) {
  const find = (d: string, t: number) => rows.find((r) => r.date === d && r.serviceTypeId === t)
  const firstType = serviceTypes[0]?.id ?? 0
  const start = find(today, firstType)

  const [date, setDate] = useState(today)
  const [typeId, setTypeId] = useState(firstType)
  const [adults, setAdults] = useState(start?.adults ?? 0)
  const [children, setChildren] = useState(start?.children ?? 0)
  const [notes, setNotes] = useState(start?.notes ?? "")
  const [message, setMessage] = useState<Message | null>(null)
  const [isPending, startTransition] = useTransition()
  const formRef = useRef<HTMLFormElement>(null)

  if (serviceTypes.length === 0) {
    return (
      <p className="rounded-lg border p-4 text-sm text-muted-foreground">
        No active service types. An admin can add them under{" "}
        <Link href="/accounting/petty-cash/service-types" className="underline">
          Petty cash → Service types
        </Link>
        .
      </p>
    )
  }

  /** Switch the form to a date + service, loading its recorded counts or resetting to 0. */
  const choose = (d: string, t: number) => {
    const row = find(d, t)
    setDate(d)
    setTypeId(t)
    setAdults(row?.adults ?? 0)
    setChildren(row?.children ?? 0)
    setNotes(row?.notes ?? "")
    setMessage(null)
  }

  const existing = find(date, typeId)

  /** Save (upsert) the entered headcount and report the outcome. */
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setMessage(null)
    startTransition(async () => {
      const result = await saveHeadcount({ date, serviceTypeId: typeId, adults, children, notes })
      if (result?.error) setMessage({ kind: "error", text: result.error })
      else setMessage({ kind: "ok", text: existing ? "Saved (updated existing headcount)" : "Saved" })
    })
  }

  /** Ask to confirm, then delete a recorded headcount. */
  const remove = (row: RecentHeadcount) => {
    if (!window.confirm(`Delete the ${row.serviceTypeName} headcount for ${row.date}? That week will show as a gap.`)) return
    setMessage(null)
    startTransition(async () => {
      const result = await deleteHeadcount(row.id)
      if (result?.error) setMessage({ kind: "error", text: result.error })
      else setMessage({ kind: "ok", text: "Deleted" })
    })
  }

  return (
    <div className="space-y-8">
      <form ref={formRef} onSubmit={submit} className="mx-auto max-w-xl space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="headcount-date">Service date</Label>
            <Input
              id="headcount-date"
              type="date"
              required
              max={today}
              value={date}
              onChange={(e) => choose(e.target.value, typeId)}
              className="h-11"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="headcount-service">Service</Label>
            <select
              id="headcount-service"
              value={typeId}
              onChange={(e) => choose(date, Number(e.target.value))}
              className="h-11 w-full rounded-md border bg-background px-3 text-sm"
            >
              {serviceTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {existing && (
          <p className="rounded-md bg-muted px-3 py-2 text-sm">
            Editing an existing headcount for this date and service. Saving replaces it.
          </p>
        )}

        <Counter label="Adults" value={adults} onChange={setAdults} />
        <Counter label="Children" value={children} onChange={setChildren} />

        <p className="text-lg">
          Total: <strong data-testid="total" className="tabular-nums">{adults + children}</strong>
        </p>

        <div className="space-y-1">
          <Label htmlFor="headcount-notes">Notes</Label>
          <Textarea id="headcount-notes" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </div>

        {message && (
          <p
            role={message.kind === "error" ? "alert" : "status"}
            className={message.kind === "error" ? "text-sm text-destructive" : "text-sm text-income"}
          >
            {message.text}
          </p>
        )}

        <div className="sticky bottom-0 -mx-4 border-t bg-background p-3 md:static md:mx-0 md:border-0 md:p-0">
          <Button type="submit" disabled={isPending} className="h-11 w-full md:w-auto">
            {isPending ? "Saving…" : "Save headcount"}
          </Button>
        </div>
      </form>

      <section className="space-y-3">
        <h3 className="text-lg font-semibold">Recent headcounts</h3>
        <RecentHeadcounts
          rows={rows}
          busy={isPending}
          onEdit={(r) => {
            choose(r.date, r.serviceTypeId)
            formRef.current?.scrollIntoView?.({ behavior: "smooth" })
          }}
          onDelete={remove}
        />
      </section>
    </div>
  )
}
