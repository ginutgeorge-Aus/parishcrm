"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { voidInvoice } from "@/lib/actions/invoiceVoid"

/** Void a sent invoice: asks for a required reason, keeps the number used. */
export function VoidInvoiceDialog({ id }: Readonly<{ id: number }>) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function submit() {
    setError(null)
    start(async () => {
      const r = await voidInvoice(id, reason)
      if ("error" in r) { setError(r.error); return }
      setOpen(false)
      setReason("")
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setError(null) }}>
      <DialogTrigger asChild><Button type="button" variant="outline">Void</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Void invoice</DialogTitle>
          <DialogDescription>A voided invoice can&apos;t be changed or paid. Its number stays used. To fix it, create a new invoice.</DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="space-y-1">
          <Label htmlFor="voidReason">Reason</Label>
          <Textarea id="voidReason" value={reason} maxLength={500} required onChange={(e) => setReason(e.target.value)} />
        </div>
        <Button type="button" variant="destructive" onClick={submit} disabled={pending || !reason.trim()}>
          {pending ? "Voiding…" : "Void invoice"}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
