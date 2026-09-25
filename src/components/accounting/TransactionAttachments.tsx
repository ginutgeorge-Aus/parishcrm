"use client"

import { useActionState } from "react"
import { attachTransactionReceipt, removeTransactionReceipt } from "@/lib/actions/transactionAttachment"
import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { Button } from "@/components/ui/button"

export type AttachmentView = {
  id: number
  filename: string
  contentType: string
  size: number
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${Math.round(kb)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

// Receipt/invoice attachments for a transaction. Images render an inline
// thumbnail; every attachment links to the auth-gated download route. Editors
// (canAccessAccounting) get an upload control and per-row Remove; read-only
// accounting roles (AUDITOR/OFFICE_ADMIN) see the list only.
export function TransactionAttachments({
  transactionId,
  attachments,
  canEdit,
}: {
  transactionId: number
  attachments: AttachmentView[]
  canEdit: boolean
}) {
  const [state, formAction, pending] = useActionState(
    attachTransactionReceipt.bind(null, transactionId),
    undefined,
  )
  const urlFor = (id: number) => `/api/accounting/transactions/${transactionId}/attachments/${id}`

  return (
    <div>
      <h2 className="text-lg font-semibold mb-3">Attachments</h2>
      {attachments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No receipts attached yet.</p>
      ) : (
        <ul className="space-y-2">
          {attachments.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-3 bg-card border border-border rounded-lg px-3 py-2"
            >
              {a.contentType.startsWith("image/") ? (
                // Private per-user blob from our own API — next/image optimisation N/A.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={urlFor(a.id)}
                  alt={`Receipt thumbnail: ${a.filename}`}
                  className="h-12 w-12 rounded object-cover border border-border"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex h-12 w-12 items-center justify-center rounded border border-border bg-muted text-xs font-semibold text-muted-foreground"
                >
                  PDF
                </span>
              )}
              <a
                href={urlFor(a.id)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 text-sm font-medium text-primary underline break-all"
              >
                {a.filename}
              </a>
              <span className="text-xs text-muted-foreground whitespace-nowrap">{fmtSize(a.size)}</span>
              {canEdit && (
                <DeleteConfirmButton
                  onConfirm={() => removeTransactionReceipt(a.id)}
                  title="Remove attachment?"
                  description={`"${a.filename}" will be permanently removed from this transaction.`}
                  triggerLabel="Remove"
                  confirmLabel="Remove"
                  pendingLabel="Removing…"
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <form action={formAction} className="mt-4 flex flex-wrap items-center gap-3">
          <label htmlFor="tx-attachment-file" className="sr-only">
            Attach a receipt image or PDF
          </label>
          <input
            id="tx-attachment-file"
            type="file"
            name="file"
            accept="image/png,image/jpeg,application/pdf"
            required
            aria-describedby="tx-attachment-hint"
            className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-primary-foreground"
          />
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Uploading…" : "Attach"}
          </Button>
          <p id="tx-attachment-hint" className="w-full text-xs text-muted-foreground">
            JPEG, PNG or PDF, up to 4 MB.
          </p>
          <FormFeedback state={state} className="w-full" />
        </form>
      )}
    </div>
  )
}
