"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { updateEntryQuantity, updateEntryDelivery, deleteEntry } from "@/lib/actions/fundraiser"
import { centsToNumber, fmtAUD, toCents } from "@/lib/formatting"
import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { PaymentsPanel } from "./PaymentsPanel"
import type { FundraiserPaymentItem, FundraiserRow } from "@/lib/fundraiserQueries"

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
 * Inline quantity editor + pickup/delivery switch + delete + payments controls
 * for one entry (managers only). Server errors are shown via FormFeedback.
 * @param props.row - The entry row.
 * @param props.hasDelivery - Fundraiser has a delivery price: show the switch.
 * @param props.payments - The entry's payments.
 */
function RowActions({ row, payments, hasDelivery }: Readonly<{ row: FundraiserRow; payments: FundraiserPaymentItem[]; hasDelivery: boolean }>) {
  const [qty, setQty] = useState(String(row.quantity))
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  // Resync the draft when the server quantity changes (revalidation, other editor).
  const [seenQty, setSeenQty] = useState(row.quantity)
  if (seenQty !== row.quantity) {
    setSeenQty(row.quantity)
    setQty(String(row.quantity))
  }

  /** Save a changed quantity; on a server error or a thrown call, show it and reset the draft. */
  function saveQty() {
    if (qty === String(row.quantity)) return
    setError(null)
    start(async () => {
      try {
        const res = await updateEntryQuantity(row.id, qty)
        if (res?.error) { setError(res.error); setQty(String(row.quantity)) }
      } catch {
        setError("Could not save the quantity. Please try again.")
        setQty(String(row.quantity))
      }
    })
  }

  /**
   * Switch the entry between pickup and delivery.
   * @param value - Selected option, "pickup" or "delivery".
   */
  function saveDelivery(value: string) {
    const next = value === "delivery"
    if (next === row.delivery) return
    setError(null)
    start(async () => {
      try {
        const res = await updateEntryDelivery(row.id, next)
        if (res?.error) setError(res.error)
      } catch {
        setError("Could not change pickup/delivery. Please try again.")
      }
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
      {hasDelivery && (
        <select
          aria-label={`Pickup or delivery for ${row.name}`}
          className="h-8 rounded-md border bg-background px-2 text-sm"
          value={row.delivery ? "delivery" : "pickup"}
          disabled={pending || row.paidCents > 0}
          title={row.paidCents > 0 ? "Delivery cannot change once a payment is recorded" : undefined}
          onChange={(ev) => saveDelivery(ev.target.value)}
        >
          <option value="pickup">Pickup</option>
          <option value="delivery">Delivery</option>
        </select>
      )}
      <PaymentsPanel entryId={row.id} name={row.name} remainingCents={row.remainingCents} payments={payments} />
      <DeleteConfirmButton
        // Not `disabled={pending}`: that swaps the trigger for an inert button and
        // drops an open dialog (blur-save then Delete). Guard the action instead.
        onConfirm={async () => (pending ? { error: "Saving the quantity, please try again" } : deleteEntry(row.id))}
        title="Delete entry?"
        description={`${row.name}'s entry will be removed from this fundraiser. Entries with payments cannot be deleted.`}
        triggerLabel={<>Delete<span className="sr-only"> {row.name}</span></>}
        triggerSize="xs"
      />
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
 * @param props.canManage - Show quantity/payment/delete controls.
 * @param props.payments - Payments keyed by entry id.
 * @param props.hasDelivery - Fundraiser has a delivery price: show Pickup/Delivery per row.
 */
export function EntryTable({
  rows, canManage, payments, hasDelivery = false,
}: Readonly<{ rows: FundraiserRow[]; canManage: boolean; payments: Record<number, FundraiserPaymentItem[]>; hasDelivery?: boolean }>) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No entries yet.</p>
  return (
    <>
      <div className="space-y-3 xl:hidden">
        {rows.map((r) => (
          <div key={r.id} className="rounded-lg border bg-card p-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium text-foreground">{r.name}</div>
                <div className="text-xs text-muted-foreground">Ref {r.bankRef}</div>
              </div>
              <StatusBadge status={r.status} />
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 tabular">
              <dt className="text-muted-foreground">Qty x price</dt><dd>{r.quantity} x {money(toCents(r.unitPrice))}</dd>
              {hasDelivery && (<><dt className="text-muted-foreground">Type</dt><dd>{r.delivery ? "Delivery" : "Pickup"}</dd></>)}
              <dt className="text-muted-foreground">Owed</dt><dd>{money(r.owedCents)}</dd>
              <dt className="text-muted-foreground">Paid</dt><dd>{money(r.paidCents)}</dd>
              <dt className="text-muted-foreground">Remaining</dt><dd>{money(r.remainingCents)}</dd>
            </dl>
            {canManage && <div className="mt-3"><RowActions row={r} payments={payments[r.id] ?? []} hasDelivery={hasDelivery} /></div>}
          </div>
        ))}
      </div>
      <div className="hidden xl:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Bank ref</TableHead>
              <TableHead>Qty</TableHead>
              {hasDelivery && <TableHead>Type</TableHead>}
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
                <TableCell className="tabular">{r.bankRef}</TableCell>
                <TableCell className="tabular">{r.quantity}</TableCell>
                {hasDelivery && <TableCell>{r.delivery ? "Delivery" : "Pickup"}</TableCell>}
                <TableCell className="tabular">{money(toCents(r.unitPrice))}</TableCell>
                <TableCell className="tabular">{money(r.owedCents)}</TableCell>
                <TableCell className="tabular">{money(r.paidCents)}</TableCell>
                <TableCell className="tabular">{money(r.remainingCents)}</TableCell>
                <TableCell><StatusBadge status={r.status} /></TableCell>
                {canManage && <TableCell><RowActions row={r} payments={payments[r.id] ?? []} hasDelivery={hasDelivery} /></TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  )
}
