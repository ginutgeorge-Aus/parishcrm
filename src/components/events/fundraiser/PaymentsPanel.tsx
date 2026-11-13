"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { recordPayment, deletePayment } from "@/lib/actions/fundraiser"
import { centsToNumber, fmtAUD } from "@/lib/formatting"
import { sydneyTodayYMD } from "@/lib/dates"
import { randomUuid } from "@/lib/randomUuid"
// Type-only (erased at build), so the server-only query module never reaches the client bundle.
import type { FundraiserPaymentItem } from "@/lib/fundraiserQueries"

/**
 * Format integer cents as a plain 2-dp decimal string for an input default.
 * @param cents - Non-negative integer cents.
 */
function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2)
}

/**
 * Dialog listing an entry's payments plus a record-payment form. A fresh
 * `submissionKey` is minted each time the dialog opens so a double-submit is
 * idempotent server-side. ONLINE payments cannot be deleted here (refund in Stripe).
 *
 * @param props.entryId - Entry id.
 * @param props.name - Entry display name.
 * @param props.remainingCents - Amount still owed, used as the amount default.
 * @param props.payments - Payments recorded for the entry.
 */
export function PaymentsPanel({
  entryId, name, remainingCents, payments,
}: Readonly<{ entryId: number; name: string; remainingCents: number; payments: FundraiserPaymentItem[] }>) {
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState("")
  const [amount, setAmount] = useState("")
  const [method, setMethod] = useState<"CASH" | "BANK">("CASH")
  const [paidAt, setPaidAt] = useState("")
  const [note, setNote] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  /** Reset the form and mint a new submission key when the dialog opens. */
  function onOpenChange(next: boolean) {
    setOpen(next)
    if (next) {
      setKey(randomUuid())
      setAmount(remainingCents > 0 ? centsToInput(remainingCents) : "")
      setMethod("CASH")
      setPaidAt(sydneyTodayYMD())
      setNote("")
      setError(null)
    }
  }

  /** Submit the record-payment form and show any server error (or a generic one if the call throws). */
  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    start(async () => {
      let res: Awaited<ReturnType<typeof recordPayment>>
      try {
        res = await recordPayment(entryId, { amount, method, paidAt, note, submissionKey: key })
      } catch {
        setError("Could not record the payment. Please try again.")
        return
      }
      if (res?.error) setError(res.error)
      else {
        setKey(randomUuid())
        setAmount("")
        setNote("")
      }
    })
  }

  /** Delete one payment and show any server error (or a generic one if the call throws). */
  function remove(id: number) {
    setError(null)
    start(async () => {
      let res: Awaited<ReturnType<typeof deletePayment>>
      try {
        res = await deletePayment(id)
      } catch {
        setError("Could not delete the payment. Please try again.")
        return
      }
      if (res?.error) setError(res.error)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="xs" aria-label={`Payments for ${name}`}>Payments</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Payments: {name}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Remaining: {fmtAUD(centsToNumber(remainingCents))}</p>
        <ul className="divide-y rounded-md border text-sm">
          {payments.length === 0 && <li className="p-3 text-muted-foreground">No payments yet.</li>}
          {payments.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 p-3">
              <div>
                <div className="tabular font-medium">{fmtAUD(centsToNumber(p.amountCents))}</div>
                <div className="text-xs text-muted-foreground">
                  {p.method} · {p.paidAt}{p.note ? ` · ${p.note}` : ""}
                </div>
              </div>
              {p.method === "ONLINE" ? (
                <span className="text-xs text-muted-foreground">Refund in Stripe</span>
              ) : (
                <Button variant="ghost" size="xs" disabled={pending} onClick={() => remove(p.id)} aria-label={`Delete payment of ${fmtAUD(centsToNumber(p.amountCents))}`}>
                  Delete
                </Button>
              )}
            </li>
          ))}
        </ul>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor={`amt-${entryId}`}>Amount</Label>
              <Input id={`amt-${entryId}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`mth-${entryId}`}>Method</Label>
              <select
                id={`mth-${entryId}`}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={method}
                onChange={(e) => setMethod(e.target.value as "CASH" | "BANK")}
              >
                <option value="CASH">Cash</option>
                <option value="BANK">Bank</option>
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`dt-${entryId}`}>Date</Label>
            <Input id={`dt-${entryId}`} type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`nt-${entryId}`}>Note</Label>
            <Input id={`nt-${entryId}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </div>
          <FormFeedback state={{ error }} />
          <Button type="submit" disabled={pending}>{pending ? "Saving..." : "Record payment"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
