"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { sendInvoice, markInvoiceSent, resendInvoice } from "@/lib/actions/invoiceSend"
import type { InvoiceStatus } from "@/lib/generated/prisma/enums"

/** Send / Mark as sent (DRAFT) and Re-send (SENT) buttons with inline result message. */
export function InvoiceSendActions({ id, status, hasEmail }: Readonly<{ id: number; status: InvoiceStatus; hasEmail: boolean }>) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const run = (fn: (id: number) => Promise<{ success: string } | { error: string }>, confirmText: string) => {
    if (!window.confirm(confirmText)) return
    start(async () => {
      const r = await fn(id)
      setMsg("error" in r ? { ok: false, text: r.error } : { ok: true, text: r.success })
      router.refresh()
    })
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "DRAFT" && (
        <>
          <Button type="button" disabled={pending || !hasEmail} title={hasEmail ? undefined : "Add a recipient email to send by email"}
            onClick={() => run(sendInvoice, "Email this invoice? It will be numbered and can no longer be edited.")}>Send by email</Button>
          <Button type="button" variant="outline" disabled={pending}
            onClick={() => run(markInvoiceSent, "Mark as sent? It will be numbered and can no longer be edited. You deliver it yourself.")}>Mark as sent (I&apos;ll deliver it)</Button>
        </>
      )}
      {status === "SENT" && hasEmail && (
        <Button type="button" variant="outline" disabled={pending} onClick={() => run(resendInvoice, "Email this invoice again?")}>Re-send</Button>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>{msg.text}</p>}
    </div>
  )
}
