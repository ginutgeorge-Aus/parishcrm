"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { verifyClearancesBulk } from "@/lib/actions/clearance"
import { BULK_VERIFY_MAX, batchRowIssues, batchTsv, isBatchRowReady, type WwccBatchRow } from "@/lib/clearanceComplianceView"

type Message = { kind: "success" | "error"; text: string }

/** Copies text to the clipboard; false when the browser blocks it. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** One value with a small copy button next to it. */
function CopyCell({ value, label }: Readonly<{ value: string | null; label: string }>) {
  const [copied, setCopied] = useState(false)
  if (!value) return <span className="text-muted-foreground">—</span>
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono text-sm">{value}</span>
      <Button
        type="button" size="sm" variant="ghost" aria-label={label}
        onClick={async () => { if (await copyText(value)) { setCopied(true); setTimeout(() => setCopied(false), 1500) } }}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </span>
  )
}

/**
 * WWCC verification helper. The OCG employer portal has no API, so each row
 * shows Family name, Date of birth and WWC number (the portal's field order)
 * with copy buttons. Staff verify in the portal, tick the rows it confirmed and
 * press Mark verified, which records who/when plus an optional outcome note.
 * Rows missing a DOB or number are flagged and cannot be ticked.
 */
export function WwccBatchVerify({ rows, verifyUrl }: Readonly<{ rows: WwccBatchRow[]; verifyUrl: string }>) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [note, setNote] = useState("")
  const [message, setMessage] = useState<Message | null>(null)
  const [pending, startTransition] = useTransition()
  const [copiedAll, setCopiedAll] = useState(false)

  const ready = rows.filter(isBatchRowReady)
  // Select all takes at most one server batch: the action rejects more than BULK_VERIFY_MAX.
  const selectable = ready.slice(0, BULK_VERIFY_MAX)
  const allReadySelected = selectable.length > 0 && selectable.every((r) => selected.has(r.clearanceId))

  /** Ticks or unticks one row; a tick past BULK_VERIFY_MAX is ignored. */
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (on && next.size < BULK_VERIFY_MAX) next.add(id)
      else next.delete(id)
      return next
    })

  /** Sends the ticked rows (with their loaded clearance and person updatedAt) to the bulk verify action and shows the result. */
  const markVerified = () =>
    startTransition(async () => {
      const items = rows
        .filter((r) => selected.has(r.clearanceId))
        .map((r) => ({ id: r.clearanceId, seenUpdatedAt: r.updatedAt, seenPersonUpdatedAt: r.personUpdatedAt }))
      const res = await verifyClearancesBulk(items, note)
      if (res && "error" in res) {
        setMessage({ kind: "error", text: res.error })
        return
      }
      if (res && "success" in res) {
        setMessage({ kind: "success", text: res.success })
        setSelected(new Set())
        setNote("")
        router.refresh()
      }
    })

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No unverified WWCCs to check. Verified WWCCs come back here when renewed.</p>
  }

  return (
    <div className="space-y-4">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Open the OCG employer portal and sign in.</li>
        <li>Paste each worker&apos;s family name, date of birth and WWC number (copy buttons below) and click Verify.</li>
        <li>Tick the rows the portal confirmed, add an optional note, then press Mark verified.</li>
      </ol>

      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm">
          <a href={verifyUrl} target="_blank" rel="noopener noreferrer">Open OCG portal ↗</a>
        </Button>
        <Button
          type="button" size="sm" variant="outline" disabled={ready.length === 0}
          onClick={async () => { if (await copyText(batchTsv(rows))) { setCopiedAll(true); setTimeout(() => setCopiedAll(false), 1500) } }}
        >
          {copiedAll ? "Copied" : "Copy all rows"}
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                aria-label={ready.length > BULK_VERIFY_MAX ? `Select the first ${BULK_VERIFY_MAX} ready rows` : "Select all ready rows"}
                checked={allReadySelected}
                disabled={ready.length === 0}
                onCheckedChange={(on) => setSelected(on === true ? new Set(selectable.map((r) => r.clearanceId)) : new Set())}
              />
            </TableHead>
            <TableHead>Family name</TableHead>
            <TableHead>Date of birth</TableHead>
            <TableHead>WWC number</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const issues = batchRowIssues(r)
            const who = `${r.givenName} ${r.familyName}`
            return (
              <TableRow key={r.clearanceId}>
                <TableCell>
                  <Checkbox
                    aria-label={`Select ${who}`}
                    checked={selected.has(r.clearanceId)}
                    disabled={issues.length > 0 || (!selected.has(r.clearanceId) && selected.size >= BULK_VERIFY_MAX)}
                    onCheckedChange={(on) => toggle(r.clearanceId, on === true)}
                  />
                </TableCell>
                <TableCell>
                  <CopyCell value={r.familyName} label={`Copy family name for ${who}`} />
                  <div className="text-xs text-muted-foreground">{r.givenName}</div>
                </TableCell>
                <TableCell><CopyCell value={r.dobDmy} label={`Copy date of birth for ${who}`} /></TableCell>
                <TableCell><CopyCell value={r.number} label={`Copy WWC number for ${who}`} /></TableCell>
                <TableCell>
                  <Badge variant={r.status === "EXPIRING" ? "outline" : "secondary"}>
                    {r.status === "EXPIRING" ? `Expiring ${r.expiresDmy ?? ""}`.trim() : "Unverified"}
                  </Badge>
                  {issues.map((i) => (
                    <div key={i} className="text-xs text-destructive">{i}</div>
                  ))}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          Portal outcome note (optional)
          <Input
            aria-label="Portal outcome note"
            maxLength={500} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. OCG: current, no restrictions"
            className="w-80 max-w-full"
          />
        </label>
        <Button type="button" disabled={selected.size === 0 || pending} onClick={markVerified}>
          {pending ? "Saving…" : `Mark verified (${selected.size})`}
        </Button>
      </div>

      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "text-sm text-destructive" : "text-sm text-success"}>
          {message.text}
        </p>
      )}
    </div>
  )
}
