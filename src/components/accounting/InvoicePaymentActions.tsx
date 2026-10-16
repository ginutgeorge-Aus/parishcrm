"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { markInvoicePaid, unmarkInvoicePaid, listPaymentCandidates, type PaymentCandidate } from "@/lib/actions/invoicePayment"
import { sydneyTodayYMD } from "@/lib/dates"
import { centsToNumber, fmtAUD, toCents } from "@/lib/formatting"

type Msg = { ok: boolean; text: string } | null

/** Mark-paid dialog: link a suggested income transaction or record a new bank payment. Reports the outcome via onDone. */
function MarkPaidDialog({ id, bankAccounts, hasEmail, onDone }: Readonly<{
  id: number; bankAccounts: { id: number; name: string }[]; hasEmail: boolean; onDone: (m: Msg) => void
}>) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<"link" | "create">("link")
  const [candidates, setCandidates] = useState<PaymentCandidate[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [txId, setTxId] = useState<number | null>(null)
  const [date, setDate] = useState(() => sydneyTodayYMD())
  const [paId, setPaId] = useState<number | null>(bankAccounts[0]?.id ?? null)
  const [receipt, setReceipt] = useState(hasEmail)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const request = useRef(0)
  const userPicked = useRef(false)

  const pickMode = (m: "link" | "create") => { userPicked.current = true; setMode(m) }

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) return
    const seq = ++request.current
    userPicked.current = false
    setError(null); setLoadError(false); setCandidates(null); setTxId(null); setMode("link")
    // Ignore stale responses (dialog reopened) and never override a mode the user already chose.
    const settle = (list: PaymentCandidate[], failed: boolean) => {
      if (seq !== request.current) return
      setCandidates(list)
      setLoadError(failed)
      if (list.length === 0 && !userPicked.current) setMode("create")
    }
    listPaymentCandidates(id)
      .then((r) => ("error" in r ? settle([], true) : settle(r, false)))
      .catch(() => settle([], true))
  }

  function submit() {
    setError(null)
    let input: Parameters<typeof markInvoicePaid>[1] | null = null
    if (mode === "link" && txId !== null) input = { mode, transactionId: txId, sendReceipt: receipt }
    if (mode === "create" && paId !== null) input = { mode, date, paymentAccountId: paId, sendReceipt: receipt }
    if (!input) { setError(mode === "link" ? "Choose a transaction" : "Choose a bank account"); return }
    const payload = input
    start(async () => {
      const r = await markInvoicePaid(id, payload)
      if ("error" in r) { setError(r.error); return }
      setOpen(false)
      onDone(r.warning ? { ok: false, text: `${r.success}. ${r.warning}` } : { ok: true, text: r.success })
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild><Button type="button">Mark paid</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark invoice paid</DialogTitle>
          <DialogDescription>Link the payment already in your transactions, or record it now.</DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {loadError && <p className="text-sm text-muted-foreground">Couldn&apos;t load matching transactions — you can still record a new payment.</p>}
        <fieldset className="flex flex-wrap gap-4 text-sm">
          <legend className="sr-only">Payment source</legend>
          <label className="flex items-center gap-1">
            <input type="radio" name="mode" checked={mode === "link"} onChange={() => pickMode("link")} disabled={candidates?.length === 0} /> Link existing transaction
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" name="mode" checked={mode === "create"} onChange={() => pickMode("create")} /> Record new payment
          </label>
        </fieldset>
        {mode === "link" ? (
          <div className="space-y-2">
            <ul className="max-h-60 space-y-1 overflow-auto text-sm">
              {candidates === null && <li>Loading…</li>}
              {candidates?.map((c) => (
                <li key={c.id}>
                  <label className="flex items-center gap-2">
                    <input type="radio" name="tx" checked={txId === c.id} onChange={() => setTxId(c.id)} />
                    {c.date} · {fmtAUD(centsToNumber(toCents(c.amount)))} · {c.paymentAccountName ?? "—"} · {c.accountName}{c.reference ? ` · ${c.reference}` : ""}
                  </label>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">The linked transaction moves to this invoice&apos;s income account and fund.</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="paidDate">Payment date</Label>
              <Input id="paidDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="paidAccount">Bank account</Label>
              {bankAccounts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active bank account — add one in accounting settings.</p>
              ) : (
                <select id="paidAccount" value={paId ?? ""} onChange={(e) => setPaId(Number.parseInt(e.target.value, 10))}
                  className="h-11 md:h-9 any-pointer-coarse:h-11 w-full rounded-md border border-input bg-background px-2 text-sm">
                  {bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              )}
            </div>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={receipt} disabled={!hasEmail} onChange={(e) => setReceipt(e.target.checked)} /> Email the recipient that payment was received
        </label>
        <Button type="button" onClick={submit} disabled={pending}>{pending ? "Saving…" : "Confirm"}</Button>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Payment actions for a SENT (Mark paid) or PAID (Unmark paid) invoice. Rendered in one place for both statuses so
 * the result message survives the refresh that flips the status.
 */
export function InvoicePaymentActions({ id, status, bankAccounts, hasEmail }: Readonly<{
  id: number; status: "SENT" | "PAID"; bankAccounts: { id: number; name: string }[]; hasEmail: boolean
}>) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<Msg>(null)

  function unmark() {
    if (!window.confirm("Unmark as paid? The payment transaction stays in your books, just unlinked from this invoice.")) return
    setMsg(null)
    start(async () => {
      const r = await unmarkInvoicePaid(id)
      setMsg("error" in r ? { ok: false, text: r.error } : { ok: true, text: r.success })
      router.refresh()
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "SENT"
        ? <MarkPaidDialog id={id} bankAccounts={bankAccounts} hasEmail={hasEmail} onDone={setMsg} />
        : <Button type="button" variant="outline" disabled={pending} onClick={unmark}>Unmark paid</Button>}
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>{msg.text}</p>}
    </div>
  )
}
