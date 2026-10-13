"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { updateInvoiceSettings } from "@/lib/actions/invoiceSettings"
import { INVOICE_PAYMENT_DETAILS_MAX, type InvoiceSettings } from "@/lib/invoiceSettingsShared"

/** Accounting-settings card: GST registration toggle + payment details printed on invoices. */
export function InvoiceSettingsForm({ initial }: Readonly<{ initial: InvoiceSettings }>) {
  const [gst, setGst] = useState(initial.gstRegistered)
  const [details, setDetails] = useState(initial.paymentDetails)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()

  function save() {
    start(async () => {
      const res = await updateInvoiceSettings({ gstRegistered: gst, paymentDetails: details })
      setMsg("error" in res ? { ok: false, text: res.error } : { ok: true, text: "Saved" })
    })
  }

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={gst} onChange={(e) => setGst(e.target.checked)} />
        The church is registered for GST (invoices become Tax Invoices with GST)
      </label>
      <div className="space-y-1">
        <Label htmlFor="invoicePaymentDetails">Payment details on invoices</Label>
        <Textarea id="invoicePaymentDetails" value={details} maxLength={INVOICE_PAYMENT_DETAILS_MAX}
          onChange={(e) => setDetails(e.target.value)} rows={3} placeholder="Bank transfer: BSB 000-000, Account 00000000, Ref: invoice number" />
      </div>
      <div className="flex items-center gap-3">
        <Button type="button" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
        {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>{msg.text}</p>}
      </div>
    </div>
  )
}
