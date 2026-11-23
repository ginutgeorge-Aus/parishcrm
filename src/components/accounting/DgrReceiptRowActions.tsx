"use client";

import { useState } from "react";
import Link from "next/link";
import { sendDgrReceipt, deleteDgrReceipt } from "@/lib/actions/dgrReceipt";
import { Button } from "@/components/ui/button";
import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton";
import {
  DGR_STATUS,
  isDgrReceiptEditable,
  isDgrReceiptDeletable,
} from "@/lib/dgr";

type Props = {
  id: number;
  receiptNo: string;
  /** Donor name + email, shown in the send confirm. */
  donorName?: string;
  donorEmail?: string | null;
  status: string;
  /** Claim time while SENDING (sent time once SENT); decides when a stuck send is editable. */
  sentAt?: Date | null;
  canManage: boolean;
};

export function DgrReceiptRowActions({
  id,
  receiptNo,
  donorName,
  donorEmail,
  status,
  sentAt = null,
  canManage,
}: Readonly<Props>) {
  const [error, setError] = useState<string | null>(null);

  /** Sends (or resends) the receipt to the confirmed email; runs inside the confirm dialog so errors show there. */
  async function handleSend(): Promise<{ error?: string } | void> {
    setError(null);
    const res = await sendDgrReceipt(id, donorEmail);
    if (res && "error" in res) return { error: res.error };
  }

  // SENT is frozen (the server refuses a duplicate delivery), so no send action;
  // UNKNOWN (possibly delivered) is the only resend.
  const canSend = status !== DGR_STATUS.SENT;
  const sendVerb = status === DGR_STATUS.UNKNOWN ? "Resend" : "Send";
  const toDonor = donorName ? ` to ${donorName}` : "";
  const atEmail = donorEmail ? ` (${donorEmail})` : "";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild variant="outline" size="sm">
        <Link
          href={`/accounting/dgr-receipts/${id}/pdf`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Preview PDF
        </Link>
      </Button>
      {canManage && (
        <>
          {/* DRAFT/FAILED are editable — a SENT or UNKNOWN (possibly delivered)
              one is frozen; a SENDING one becomes editable once its claim is
              stale (a stuck send). Matches updateDgrReceipt's guard. */}
          {isDgrReceiptEditable(status, sentAt) && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/accounting/dgr-receipts/${id}/edit`}>Edit</Link>
            </Button>
          )}
          {canSend && (
            <DeleteConfirmButton
              onConfirm={handleSend}
              title={`${sendVerb} this receipt?`}
              description={`${sendVerb} receipt ${receiptNo}${toDonor}${atEmail} by email? After sending, this receipt can no longer be edited or deleted.`}
              triggerLabel={sendVerb}
              triggerVariant="outline"
              triggerSize="sm"
              triggerClassName=""
              confirmLabel={sendVerb}
              pendingLabel="Sending…"
            />
          )}
          {isDgrReceiptDeletable(status) && (
            <DeleteConfirmButton
              onConfirm={async () => {
                const res = await deleteDgrReceipt(id);
                return "error" in res ? res : undefined;
              }}
              title="Delete this receipt?"
              description={`Delete receipt ${receiptNo}? This cannot be undone.`}
              triggerVariant="ghost"
              triggerSize="sm"
            />
          )}
        </>
      )}
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}
