"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { markInvoicePaid, unmarkInvoicePaid, listPaymentCandidates, type PaymentCandidate } from "@/lib/actions/invoicePayment"
import { sydneyTodayYMD } from "@/lib/dates"

type Msg = { ok: boolean; text: string } | null

/** Inline result line shared by the payment actions. */
function ResultLine({ msg }: Readonly<{ msg: Msg }>) {
  if (!msg) return null
  return <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>{msg.text}</p>
}

/** Mark-paid dialog: link a suggested income transaction or record a new bank payment. */
export function MarkPaidDialog({ id, bankAccounts, hasEmail }: Readonly<{ id: number; bankAccounts: { id: number; name: string }[]; hasEmail: boolean }>) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<"link" | "create">("link")
  const [candidates, setCandidates] = useState<PaymentCandidate[] | null>(null)
  const [txId, setTxId] = useState<number | null>(null)
  const [date, setDate] = useState(() => sydneyTodayYMD())
  const [paId, setPaId] = useState<number | null>(bankAccounts[0]?.id ?? null)
  const [receipt, setReceipt] = useState(hasEmail)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Msg>(null)
  const [pending, start] = useTransition()

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) return
    setError(null)
    setCandidates(null)
    setTxId(null)
    listPaymentCandidates(id).then((r) => {
      const list = "error" in r ? [] : r
      setCandidates(list)
      setMode(list.length === 0 ? "create" : "link")
    }).catch(() => { setCandidates([]); setMode("create") })
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
      setResult(r.warning ? { ok: false, text: `${r.success}. ${r.warning}` } : { ok: true, text: r.success })
      router.refresh()
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogTrigger asChild><Button type="button">Mark paid</Button></DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark invoice paid</DialogTitle>
            <DialogDescription>Link the payment already in your transactions, or record it now.</DialogDescription>
          </DialogHeader>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <fieldset className="flex flex-wrap gap-4 text-sm">
            <legend className="sr-only">Payment source</legend>
            <label className="flex items-center gap-1">
              <input type="radio" name="mode" checked={mode === "link"} onChange={() => setMode("link")} disabled={candidates?.length === 0} /> Link existing transaction
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" name="mode" checked={mode === "create"} onChange={() => setMode("create")} /> Record new payment
            </label>
          </fieldset>
          {mode === "link" ? (
            <ul className="max-h-60 space-y-1 overflow-auto text-sm">
              {candidates === null && <li>Loading…</li>}
              {candidates?.map((c) => (
                <li key={c.id}>
                  <label className="flex items-center gap-2">
                    <input type="radio" name="tx" checked={txId === c.id} onChange={() => setTxId(c.id)} />
                    {c.date} · ${c.amount} · {c.paymentAccountName ?? "—"}{c.reference ? ` · ${c.reference}` : ""}
                  </label>
                </li>
              ))}
            </ul>
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
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                    {bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                )}
              </div>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={receipt} disabled={!hasEmail} onChange={(e) => setReceipt(e.target.checked)} /> Email a receipt to the recipient
          </label>
          <Button type="button" onClick={submit} disabled={pending}>{pending ? "Saving…" : "Confirm"}</Button>
        </DialogContent>
      </Dialog>
      <ResultLine msg={result} />
    </div>
  )
}

/** Unmark a PAID invoice (unlinks the payment; the transaction stays in the ledger). */
export function UnmarkPaidButton({ id }: Readonly<{ id: number }>) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<Msg>(null)
  function run() {
    if (!window.confirm("Unmark as paid? The payment transaction stays in your books, just unlinked from this invoice.")) return
    start(async () => {
      const r = await unmarkInvoicePaid(id)
      setMsg("error" in r ? { ok: false, text: r.error } : { ok: true, text: r.success })
      router.refresh()
    })
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" disabled={pending} onClick={run}>Unmark paid</Button>
      <ResultLine msg={msg} />
    </div>
  )
}
