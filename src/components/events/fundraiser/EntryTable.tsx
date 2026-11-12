"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { updateEntryQuantity, deleteEntry } from "@/lib/actions/fundraiser"
import { centsToNumber, fmtAUD, toCents } from "@/lib/formatting"
import { PaymentsPanel, type PaymentItem } from "./PaymentsPanel"
import type { FundraiserRow } from "@/lib/fundraiserQueries"

const STATUS_LABEL: Record<FundraiserRow["status"], string> = {
  UNPAID: "Unpaid",
  PART: "Part paid",
  PAID: "Paid",
  OVERPAID: "Overpaid",
}

/**
 * Status badge for an entry. OVERPAID is flagged red; PAID uses the income colour.
 * @param props.status - Entry status.
 */
function StatusBadge({ status }: Readonly<{ status: FundraiserRow["status"] }>) {
  const cls =
    status === "OVERPAID" ? "bg-destructive/10 text-destructive"
    : status === "PAID" ? "bg-income/10 text-income"
    : "bg-muted text-muted-foreground"
  return <Badge variant="outline" className={cls}>{STATUS_LABEL[status]}</Badge>
}

/**
 * Inline quantity editor + delete + payments controls for one entry (managers only).
 * Server errors are shown via FormFeedback.
 * @param props.row - The entry row.
 * @param props.payments - The entry's payments.
 */
function RowActions({ row, payments }: Readonly<{ row: FundraiserRow; payments: PaymentItem[] }>) {
  const [qty, setQty] = useState(String(row.quantity))
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  /** Save a changed quantity. */
  function saveQty() {
    if (qty === String(row.quantity)) return
    setError(null)
    start(async () => {
      const res = await updateEntryQuantity(row.id, qty)
      if (res?.error) { setError(res.error); setQty(String(row.quantity)) }
    })
  }

  /** Delete the entry after confirmation. */
  function remove() {
    if (!window.confirm(`Delete ${row.name}'s entry?`)) return
    setError(null)
    start(async () => {
      const res = await deleteEntry(row.id)
      if (res?.error) setError(res.error)
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        aria-label={`Quantity for ${row.name}`}
        inputMode="numeric"
        className="h-8 w-16"
        value={qty}
        disabled={pending}
        onChange={(e) => setQty(e.target.value)}
        onBlur={saveQty}
      />
      <PaymentsPanel entryId={row.id} name={row.name} remainingCents={row.remainingCents} payments={payments} />
      <Button variant="ghost" size="xs" disabled={pending} onClick={remove} aria-label={`Delete ${row.name}`}>Delete</Button>
      <FormFeedback state={{ error }} className="basis-full" />
    </div>
  )
}

/** Format integer cents as currency. */
function money(cents: number): string {
  return fmtAUD(centsToNumber(cents))
}

/**
 * Fundraiser entries: stacked cards on phones, a table from `xl:`. Mutation
 * controls render only when `canManage`.
 *
 * @param props.rows - Entry rows from `getFundraiserView`.
 * @param props.unitPrice - Fundraiser unit price (2-dp string) for display.
 * @param props.canManage - Show quantity/payment/delete controls.
 * @param props.payments - Payments keyed by entry id.
 */
export function EntryTable({
  rows, unitPrice, canManage, payments,
}: Readonly<{ rows: FundraiserRow[]; unitPrice: string; canManage: boolean; payments: Record<number, PaymentItem[]> }>) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No entries yet.</p>
  return (
    <>
      <div className="space-y-3 xl:hidden">
        {rows.map((r) => (
          <div key={r.id} className="rounded-lg border bg-card p-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="font-medium text-foreground">{r.name}</div>
              <StatusBadge status={r.status} />
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 tabular">
              <dt className="text-muted-foreground">Qty x price</dt><dd>{r.quantity} x {money(toCents(unitPrice))}</dd>
              <dt className="text-muted-foreground">Owed</dt><dd>{money(r.owedCents)}</dd>
              <dt className="text-muted-foreground">Paid</dt><dd>{money(r.paidCents)}</dd>
              <dt className="text-muted-foreground">Remaining</dt><dd>{money(r.remainingCents)}</dd>
            </dl>
            {canManage && <div className="mt-3"><RowActions row={r} payments={payments[r.id] ?? []} /></div>}
          </div>
        ))}
      </div>
      <div className="hidden xl:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Qty</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Owed</TableHead>
              <TableHead>Paid</TableHead>
              <TableHead>Remaining</TableHead>
              <TableHead>Status</TableHead>
              {canManage && <TableHead>Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="tabular">{r.quantity}</TableCell>
                <TableCell className="tabular">{money(toCents(unitPrice))}</TableCell>
                <TableCell className="tabular">{money(r.owedCents)}</TableCell>
                <TableCell className="tabular">{money(r.paidCents)}</TableCell>
                <TableCell className="tabular">{money(r.remainingCents)}</TableCell>
                <TableCell><StatusBadge status={r.status} /></TableCell>
                {canManage && <TableCell><RowActions row={r} payments={payments[r.id] ?? []} /></TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  )
}
