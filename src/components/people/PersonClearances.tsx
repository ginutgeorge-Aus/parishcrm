"use client"

import { useState, useTransition } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { CLEARANCE_STATUS_LABELS, CLEARANCE_TYPE_LABELS, type ClearanceStatus } from "@/lib/clearanceStatus"
import type { ClearanceCardData, ClearanceRowView } from "@/lib/clearanceView"
import { deleteClearance, unverifyClearance, upsertClearance, verifyClearance } from "@/lib/actions/clearance"

// Design-token classes only (no raw palette — eslint-raw-palette rule).
const STATUS_BADGE: Record<ClearanceStatus, { variant: "default" | "secondary" | "destructive" | "outline"; className?: string }> = {
  MISSING: { variant: "outline" },
  UNVERIFIED: { variant: "secondary" },
  VERIFIED: { variant: "outline", className: "border-income/50 text-income" },
  EXPIRING: { variant: "outline", className: "border-warning text-warning-foreground bg-warning/20" },
  EXPIRED: { variant: "destructive" },
}

/** Status pill for one clearance. */
function StatusBadge({ status }: Readonly<{ status: ClearanceStatus }>) {
  const { variant, className } = STATUS_BADGE[status]
  return <Badge variant={variant} className={className}>{CLEARANCE_STATUS_LABELS[status]}</Badge>
}

/**
 * Confirmation dialog for marking a clearance Verified, with an optional note.
 * WWCC only: a "Check on OCG portal" link so the admin can look the number up
 * before confirming. Safe Ministry has no portal link.
 */
function VerifyDialog({
  row,
  wwccVerifyUrl,
  open,
  onOpenChange,
}: Readonly<{
  row: ClearanceRowView
  wwccVerifyUrl: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}>) {
  const [note, setNote] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const label = CLEARANCE_TYPE_LABELS[row.type]

  /** Run the verify action; close on success, keep the dialog open on error. */
  function confirm() {
    setError(null)
    startTransition(async () => {
      const result = await verifyClearance(row.clearanceId ?? "", note)
      if (result && "error" in result) {
        setError(result.error)
        return
      }
      setNote("")
      onOpenChange(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Verify {label}?</DialogTitle>
          <DialogDescription>
            Confirm you have checked this clearance
            {row.type === "WWCC" ? " against the issuing portal" : ""}. Editing the number, expiry or
            document later will clear this verification.
          </DialogDescription>
        </DialogHeader>
        {row.type === "WWCC" && wwccVerifyUrl && (
          <a
            href={wwccVerifyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-primary underline"
          >
            Check on OCG portal ↗
          </a>
        )}
        <div className="space-y-1">
          <label htmlFor={`verify-note-${row.type}`} className="text-sm font-medium">Note (optional)</label>
          <Textarea
            id={`verify-note-${row.type}`}
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Checked on the OCG portal, status Current"
          />
        </div>
        <FormFeedback state={error ? { error } : undefined} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button type="button" onClick={confirm} disabled={pending}>{pending ? "Verifying…" : "Confirm"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Add / replace form (number, expiry, optional document). */
function ClearanceForm({
  personId,
  row,
  onDone,
}: Readonly<{ personId: number; row: ClearanceRowView; onDone: () => void }>) {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const id = `clearance-${row.type}`

  /** Submit via the action (its signature isn't useActionState-shaped). */
  function submit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    setError(null)
    startTransition(async () => {
      const result = await upsertClearance(personId, row.type, formData)
      if (result && "error" in result) {
        setError(result.error)
        return
      }
      onDone()
    })
  }

  return (
    <form onSubmit={submit} className="mt-3 grid gap-3 sm:grid-cols-2">
      <div>
        <label htmlFor={`${id}-number`} className="text-sm font-medium">Number</label>
        <input
          id={`${id}-number`}
          name="number"
          defaultValue={row.number ?? ""}
          maxLength={40}
          autoComplete="off"
          className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
        />
      </div>
      <div>
        <label htmlFor={`${id}-expiry`} className="text-sm font-medium">Expiry date</label>
        <input
          id={`${id}-expiry`}
          name="expiresAt"
          type="date"
          defaultValue={row.expiresYmd ?? ""}
          className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
        />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor={`${id}-doc`} className="text-sm font-medium">
          Document {row.hasDocument ? "(leave empty to keep the current file)" : ""}
        </label>
        <input
          id={`${id}-doc`}
          name="document"
          type="file"
          accept="image/png,image/jpeg,application/pdf"
          aria-describedby={`${id}-hint`}
          className="mt-1 block text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-primary-foreground"
        />
        <p id={`${id}-hint`} className="mt-1 text-xs text-muted-foreground">JPEG, PNG or PDF, up to 4 MB.</p>
      </div>
      <div className="sm:col-span-2 flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone} disabled={pending}>Cancel</Button>
      </div>
      <FormFeedback state={error ? { error } : undefined} className="sm:col-span-2" />
    </form>
  )
}

/** One clearance type's row: badge, details, and (managers) actions. */
function ClearanceRow({
  personId,
  canManage,
  wwccVerifyUrl,
  row,
}: Readonly<{ personId: number; canManage: boolean; wwccVerifyUrl: string | null; row: ClearanceRowView }>) {
  const [editing, setEditing] = useState(false)
  const [verifyOpen, setVerifyOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const exists = row.clearanceId !== undefined
  const verified = row.verifiedLabel != null

  /** Run unverify; surface an error inline. */
  function unverify() {
    setActionError(null)
    startTransition(async () => {
      const result = await unverifyClearance(row.clearanceId ?? "")
      if (result && "error" in result) setActionError(result.error)
    })
  }

  return (
    <li data-testid={`clearance-${row.type}`} className="rounded-lg border border-border bg-card px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{CLEARANCE_TYPE_LABELS[row.type]}</span>
          <StatusBadge status={row.status} />
        </div>
        {canManage && !editing && (
          <div className="flex flex-wrap items-center gap-1">
            {row.hasDocument && (
              <a
                href={`/api/people/${personId}/clearances/${row.clearanceId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary underline px-2"
              >
                View document
              </a>
            )}
            {exists && !verified && (
              <Button type="button" size="sm" variant="outline" onClick={() => setVerifyOpen(true)}>Verify</Button>
            )}
            {exists && verified && (
              <Button type="button" size="sm" variant="ghost" onClick={unverify} disabled={pending}>Unverify</Button>
            )}
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
              {exists ? "Update" : "Add"}
            </Button>
            {exists && (
              <DeleteConfirmButton
                onConfirm={() => deleteClearance(row.clearanceId ?? "")}
                title="Remove clearance?"
                description={`The ${CLEARANCE_TYPE_LABELS[row.type]} record and its document will be permanently removed.`}
                triggerLabel="Remove"
                confirmLabel="Remove"
                pendingLabel="Removing…"
              />
            )}
          </div>
        )}
      </div>

      {canManage && exists && (
        <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">Number</dt><dd>{row.number ?? "—"}</dd></div>
          <div><dt className="text-muted-foreground">Expires</dt><dd>{row.expiresLabel ?? "No expiry"}</dd></div>
          {verified && (
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Verified</dt>
              <dd>
                {row.verifiedByName ? `${row.verifiedByName}, ` : ""}{row.verifiedLabel}
                {row.verificationNote ? ` — ${row.verificationNote}` : ""}
              </dd>
            </div>
          )}
        </dl>
      )}

      {actionError && <FormFeedback state={{ error: actionError }} className="mt-2" />}
      {canManage && editing && (
        <ClearanceForm personId={personId} row={row} onDone={() => setEditing(false)} />
      )}
      {canManage && exists && (
        <VerifyDialog row={row} wwccVerifyUrl={wwccVerifyUrl} open={verifyOpen} onOpenChange={setVerifyOpen} />
      )}
    </li>
  )
}

/**
 * Safeguarding card body: one row per clearance type (WWCC, Safe Ministry).
 * Managers (canEdit roles) get number/expiry/verification detail plus upload,
 * view-document, verify and remove. Everyone else gets the status badge only —
 * the server never sends them anything more (see buildClearanceCard).
 */
export function PersonClearances({ personId, canManage, wwccVerifyUrl, rows }: Readonly<ClearanceCardData>) {
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <ClearanceRow
          key={row.type}
          personId={personId}
          canManage={canManage}
          wwccVerifyUrl={wwccVerifyUrl}
          row={row}
        />
      ))}
    </ul>
  )
}
