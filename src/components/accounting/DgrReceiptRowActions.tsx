"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { sendDgrReceipt, deleteDgrReceipt } from "@/lib/actions/dgrReceipt"
import { Button } from "@/components/ui/button"
import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"

type Props = {
  id: number
  receiptNo: string
  status: string
  canManage: boolean
}

export function DgrReceiptRowActions({ id, receiptNo, status, canManage }: Props) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleSend() {
    setError(null)
    startTransition(async () => {
      try {
        const res = await sendDgrReceipt(id)
        if (res && "error" in res) setError(res.error)
      } catch {
        // Transport-level throw never reaches the {error} branch — surface a
        // retry message so a failed DGR-receipt send isn't silent.
        setError("Something went wrong, try again")
      }
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild variant="outline" size="sm">
        <Link href={`/accounting/dgr-receipts/${id}/pdf`} target="_blank" rel="noopener noreferrer">
          Preview PDF
        </Link>
      </Button>
      {canManage && (
        <>
          {/* DRAFT/FAILED are editable — a SENT one is a delivered legal
              document; a SENDING one is a stuck send recovered by editing it
              back to DRAFT. Matches updateDgrReceipt's guard. */}
          {(status === "DRAFT" || status === "FAILED" || status === "SENDING") && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/accounting/dgr-receipts/${id}/edit`}>Edit</Link>
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleSend} disabled={pending}>
            {status === "SENT" ? "Resend" : "Send"}
          </Button>
          {status !== "SENT" && (
            <DeleteConfirmButton
              onConfirm={async () => {
                const res = await deleteDgrReceipt(id)
                return "error" in res ? res : undefined
              }}
              title="Delete this receipt?"
              description={`Delete receipt ${receiptNo}? This cannot be undone.`}
              triggerVariant="ghost"
              triggerSize="sm"
            />
          )}
        </>
      )}
      {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
    </div>
  )
}
