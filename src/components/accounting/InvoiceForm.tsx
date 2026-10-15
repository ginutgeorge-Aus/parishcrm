"use client"

import { startTransition, useActionState, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { createInvoice, updateInvoice, getRecipientContact, type InvoiceView } from "@/lib/actions/invoice"
import { computeInvoiceTotals, INVOICE_MAX_LINES } from "@/lib/invoice"
import { toCents, fmtAUD, centsToNumber } from "@/lib/formatting"
import { sydneyTodayYMD } from "@/lib/dates"
import { RecipientPicker, type RecipientOption } from "./RecipientPicker"

type LineState = { description: string; qty: string; unitPrice: string; gst: boolean }
const blank = (gst: boolean): LineState => ({ description: "", qty: "1", unitPrice: "", gst })

/** Draft invoice editor with recipient picker, line items and live (display-only) totals. */
export default function InvoiceForm({ recipients, accounts, funds, gstEnabled, edit }: Readonly<{
  recipients: RecipientOption[]; accounts: { id: number; name: string }[]; funds: { id: number; name: string }[]
  gstEnabled: boolean; edit?: InvoiceView
}>) {
  const action = edit ? updateInvoice.bind(null, edit.id) : createInvoice
  const [state, formAction, isPending] = useActionState(action, undefined)
  const [options, setOptions] = useState(recipients)
  const initialKind = edit ? (edit.personId ? "person" : edit.customerId ? "customer" : "none") : "none"
  const [recipient, setRecipient] = useState<{ kind: "person" | "customer" | "none"; id: number | null; name: string }>({
    kind: initialKind, id: edit?.personId ?? edit?.customerId ?? null, name: edit?.recipientName ?? "",
  })
  const [name, setName] = useState(edit?.recipientName ?? "")
  const [email, setEmail] = useState(edit?.recipientEmail ?? "")
  const [address, setAddress] = useState(edit?.recipientAddress ?? "")
  const [lines, setLines] = useState<LineState[]>(
    edit ? edit.lines.map((l) => ({ description: l.description, qty: String(l.qty), unitPrice: (l.unitPriceCents / 100).toFixed(2), gst: l.gst })) : [blank(gstEnabled)],
  )
  const reqId = useRef(0)
  const [lookupPending, setLookupPending] = useState(false)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const today = sydneyTodayYMD()
  // Controlled fields: their state survives a rejected save (see the onSubmit note below).
  const [issueDate, setIssueDate] = useState(edit?.issueDate ?? today)
  const [dueDate, setDueDate] = useState(edit?.dueDate ?? today)
  const [accountId, setAccountId] = useState(edit ? String(edit.accountId) : "")
  const [fundId, setFundId] = useState(edit?.fundId ? String(edit.fundId) : "")
  const [notes, setNotes] = useState(edit?.notes ?? "")

  async function pick(o: RecipientOption | null) {
    const my = ++reqId.current
    setLookupError(null)
    if (!o) {
      // Drop the cleared recipient's contact so a manually typed name can't inherit it.
      setRecipient({ kind: "none", id: null, name }); setEmail(""); setAddress(""); setLookupPending(false); return
    }
    setRecipient({ kind: o.kind, id: o.id, name: o.name })
    setName(o.name)
    // Clear the previous recipient's contact at once and block saving until the lookup
    // lands, so a draft can never pair the new name with the old recipient's email.
    setEmail(""); setAddress("")
    setLookupPending(true)
    const res = await getRecipientContact(o.kind, o.id).catch(() => ({ error: "lookup failed" }))
    if (my !== reqId.current) return
    setLookupPending(false)
    if ("error" in res) { setLookupError("Couldn't load this recipient's contact details — enter them below."); return }
    setEmail(res.email); setAddress(res.address)
  }

  const totals = useMemo(() => {
    const parsed = lines.map((l) => {
      const qty = /^\d{1,4}$/.test(l.qty) ? Number.parseInt(l.qty, 10) : 0
      const c = toCents(l.unitPrice)
      return { description: l.description, qty, unitPriceCents: Number.isFinite(c) && c >= 0 ? c : 0, gst: l.gst }
    })
    return computeInvoiceTotals(parsed, gstEnabled)
  }, [lines, gstEnabled])

  const setLine = (i: number, patch: Partial<LineState>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  // Send each line's stored GST flag as-is: while GST is off the server ignores it, and
  // keeping it means re-enabling GST restores the draft's tax classification.
  const serialized = JSON.stringify(lines)

  return (
    <form
      className="max-w-3xl space-y-5"
      // onSubmit instead of action={formAction}: React 19 resets a form after an action
      // completes, which clears <select>s even when controlled, losing input on a rejected save.
      onSubmit={(e) => {
        e.preventDefault()
        const data = new FormData(e.currentTarget)
        startTransition(() => formAction(data))
      }}
    >
      {state?.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
      <input type="hidden" name="recipientKind" value={recipient.kind} />
      <input type="hidden" name="recipientId" value={recipient.id ?? ""} />
      <input type="hidden" name="lines" value={serialized} />

      <fieldset className="space-y-3">
        <legend className="font-medium">Recipient</legend>
        <RecipientPicker options={options} value={recipient} onPick={pick}
          onCreated={(o) => { setOptions((xs) => [...xs, o]); void pick(o) }} />
        {lookupError && <p role="alert" className="text-sm text-destructive">{lookupError}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor="recipientName">Name</Label>
            <Input id="recipientName" name="recipientName" value={name} onChange={(e) => setName(e.target.value)} required /></div>
          <div className="space-y-1"><Label htmlFor="recipientEmail">Email</Label>
            <Input id="recipientEmail" name="recipientEmail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        </div>
        <div className="space-y-1"><Label htmlFor="recipientAddress">Address</Label>
          <Textarea id="recipientAddress" name="recipientAddress" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} /></div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="issueDate">Issue date</Label>
          <Input id="issueDate" name="issueDate" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} required /></div>
        <div className="space-y-1"><Label htmlFor="dueDate">Due date</Label>
          <Input id="dueDate" name="dueDate" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required /></div>
        <div className="space-y-1"><Label htmlFor="accountId">Income account</Label>
          <select id="accountId" name="accountId" value={accountId} onChange={(e) => setAccountId(e.target.value)} required className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
            <option value="" disabled>Choose…</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select></div>
        <div className="space-y-1"><Label htmlFor="fundId">Fund (optional)</Label>
          <select id="fundId" name="fundId" value={fundId} onChange={(e) => setFundId(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
            <option value="">None</option>
            {funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select></div>
      </div>

      <fieldset className="space-y-2">
        <legend className="font-medium">Lines {gstEnabled && <span className="text-sm text-muted-foreground">(prices exclude GST)</span>}</legend>
        {lines.map((l, i) => (
          <div key={l.id} className="grid grid-cols-12 items-end gap-2">
            <Input className="col-span-6" aria-label={`Line ${i + 1} description`} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />
            <Input className="col-span-2" aria-label={`Line ${i + 1} quantity`} inputMode="numeric" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
            <Input className="col-span-2" aria-label={`Line ${i + 1} unit price`} inputMode="decimal" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} />
            {gstEnabled && (
              <label className="col-span-1 flex items-center gap-1 text-sm">
                <input type="checkbox" aria-label={`Line ${i + 1} GST`} checked={l.gst} onChange={(e) => setLine(i, { gst: e.target.checked })} /> GST
              </label>
            )}
            <Button type="button" variant="ghost" size="sm" className="col-span-1" aria-label={`Remove line ${i + 1}`}
              disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>✕</Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" disabled={lines.length >= INVOICE_MAX_LINES}
          onClick={() => setLines((ls) => [...ls, blank(gstEnabled)])}>Add line</Button>
      </fieldset>

      <dl className="ml-auto w-64 space-y-1 text-sm">
        <div className="flex justify-between"><dt>Subtotal</dt><dd data-testid="invoice-subtotal">{fmtAUD(centsToNumber(totals.subtotalCents))}</dd></div>
        {gstEnabled && <div className="flex justify-between"><dt>GST</dt><dd data-testid="invoice-gst">{fmtAUD(centsToNumber(totals.gstCents))}</dd></div>}
        <div className="flex justify-between font-semibold"><dt>Total</dt><dd data-testid="invoice-total">{fmtAUD(centsToNumber(totals.totalCents))}</dd></div>
      </dl>

      <div className="space-y-1"><Label htmlFor="notes">Notes (printed on the invoice)</Label>
        <Textarea id="notes" name="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>

      <Button type="submit" disabled={isPending || lookupPending}>{isPending ? "Saving…" : "Save draft"}</Button>
    </form>
  )
}
