"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { sendGivingStatements, type StatementListRow } from "@/lib/actions/givingStatement"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { fmtAUD } from "@/lib/formatting"
import { APP_LOCALE, APP_TIMEZONE } from "@/lib/appConfig"

type Props = {
  year: number
  rows: StatementListRow[]
  canManage: boolean
}

/**
 * Status badge for a family's latest send attempt, with the send-claim state when a send is
 * in progress (PENDING) or delivery is unconfirmed (UNKNOWN), so staff know which need a check.
 */
function StatusBadge({ status, claim }: Readonly<{ status: StatementListRow["lastStatus"]; claim: StatementListRow["claim"] }>) {
  let note: React.ReactNode = null
  if (claim === "PENDING") note = <span className="ml-2 text-xs text-muted-foreground">send in progress</span>
  else if (claim === "UNKNOWN") note = <span className="ml-2 text-xs text-muted-foreground">delivery unconfirmed, check before resending</span>
  if (!status) return <span><span className="text-xs text-muted-foreground">Not sent</span>{note}</span>
  return <span><Badge variant={status === "SENT" ? "default" : "destructive"}>{status}</Badge>{note}</span>
}

/**
 * Giving statements table with row selection and a bulk "Email selected" action.
 * Rows without a consenting email address can be previewed but not selected.
 */
export function GivingStatementsClient({ year, rows, canManage }: Readonly<Props>) {
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [errors, setErrors] = useState<{ familyId: number; text: string }[]>([])
  const [resend, setResend] = useState(false)
  const emailable = rows.filter((r) => r.canEmail)

  /** Toggle one family in the selection. */
  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /**
   * Select every emailable family with no send claim, or clear when all are selected. Families
   * that are sent, in progress or delivery-unknown (UNKNOWN/PENDING claim) are left out: those
   * need a human check, then the Resend option.
   */
  function toggleAll() {
    const pendingIds = emailable.filter((r) => r.lastStatus !== "SENT" && r.claim === null).map((r) => r.familyId)
    setSelected((prev) => (pendingIds.every((i) => prev.has(i)) ? new Set() : new Set(pendingIds)))
  }

  /** Send to the selected families in chunks of 200 and summarise the outcome. */
  function handleSend() {
    setMessage(null)
    setErrors([])
    const nameById = new Map(rows.map((r) => [r.familyId, r.familyName]))
    startTransition(async () => {
      try {
        const ids = Array.from(selected)
        let sent = 0
        let failed = 0
        let skipped = 0
        let inProgress = 0
        let fatal: string | null = null
        let auditFailed = 0
        let pending = ids // ids not yet attempted; the server hands back any it ran out of time for
        const errs: { familyId: number; text: string }[] = []
        while (pending.length > 0) {
          const res = await sendGivingStatements(year, pending.slice(0, 200), !resend)
          if ("error" in res) {
            fatal = res.error
            break
          }
          pending = [...(res.remaining ?? []), ...pending.slice(200)]
          sent += res.sent
          failed += res.failed
          skipped += res.skipped
          inProgress += res.inProgress
          auditFailed += res.auditFailed ?? 0
          errs.push(...res.errors.map((e) => ({ familyId: e.familyId, text: `${nameById.get(e.familyId) ?? "Family #" + e.familyId}: ${e.error}` })))
        }
        // On an early stop keep only the unprocessed families, so a forced resend can't re-send finished chunks.
        setSelected(fatal ? new Set(pending) : new Set())
        setErrors(errs)
        const skippedNote = skipped ? `, skipped ${skipped} (already sent or claimed)` : ""
        const progressNote = inProgress
          ? `, skipped ${inProgress} with a send in progress or delivery unknown (check, then tick Resend)`
          : ""
        const auditNote = auditFailed ? ` ${auditFailed} attempt(s) could not be written to the send log; check before resending.` : ""
        const counts = `Sent ${sent}, failed ${failed}${skippedNote}${progressNote}.${auditNote}`
        setMessage(fatal ? `${counts} Stopped early: ${fatal}` : counts)
      } catch {
        setMessage("Something went wrong, try again")
      }
    })
  }

  const when = (d: Date | null) => (d ? d.toLocaleDateString(APP_LOCALE, { timeZone: APP_TIMEZONE }) : "—")
  const pdfHref = (id: number) => `/accounting/giving-statements/${id}/pdf?year=${year}`

  return (
    <div className="space-y-3">
      {canManage && (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" size="sm" onClick={toggleAll} disabled={pending || emailable.length === 0}>
            Select all unsent
          </Button>
          <Button type="button" size="sm" onClick={handleSend} disabled={pending || selected.size === 0}>
            {pending ? "Sending…" : `Email selected (${selected.size})`}
          </Button>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={resend} disabled={pending} onChange={(e) => setResend(e.target.checked)} />
            Resend to families already sent
          </label>
          {message && <output className="text-sm text-muted-foreground">{message}</output>}
        </div>
      )}
      {errors.length > 0 && (
        <ul role="alert" className="list-disc pl-5 text-xs text-destructive">
          {errors.map((e) => <li key={e.familyId}>{e.text}</li>)}
        </ul>
      )}

      <div className="hidden md:block bg-card border border-border rounded-lg overflow-x-auto">
        <table className="w-full min-w-table-wide text-sm">
          <thead className="bg-muted border-b border-border">
            <tr>
              {canManage && <th className="w-10 px-4 py-2"><span className="sr-only">Select</span></th>}
              {["Family", "Gifts", "Total", "Last send", "Date", ""].map((h) => (
                <th key={h || "actions"} className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.familyId} className="border-b border-border last:border-0">
                {canManage && (
                  <td className="px-4 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.familyName}`}
                      checked={selected.has(r.familyId)}
                      disabled={!r.canEmail || pending}
                      onChange={() => toggle(r.familyId)}
                    />
                  </td>
                )}
                <td className="px-4 py-2 font-medium">
                  {r.familyName}
                  {r.archived && <span className="ml-2 text-xs text-muted-foreground">archived</span>}
                  {!r.canEmail && !r.archived && <span className="ml-2 text-xs text-muted-foreground">no email</span>}
                </td>
                <td className="px-4 py-2 text-muted-foreground">{r.giftCount}</td>
                <td className="px-4 py-2 font-medium whitespace-nowrap">{fmtAUD(r.total)}</td>
                <td className="px-4 py-2"><StatusBadge status={r.lastStatus} claim={r.claim} /></td>
                <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">{when(r.lastAt)}</td>
                <td className="px-4 py-2">
                  <Button asChild variant="outline" size="sm">
                    <Link href={pdfHref(r.familyId)} target="_blank" rel="noopener noreferrer">Preview PDF</Link>
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-2 md:hidden">
        {rows.map((r) => (
          <li key={r.familyId} className="rounded-lg border bg-card p-3">
            <div className="flex items-start justify-between gap-3">
              <label className="flex min-w-0 items-start gap-2">
                {canManage && (
                  <input
                    type="checkbox"
                    className="mt-1"
                    aria-label={`Select ${r.familyName}`}
                    checked={selected.has(r.familyId)}
                    disabled={!r.canEmail || pending}
                    onChange={() => toggle(r.familyId)}
                  />
                )}
                <span className="min-w-0">
                  <span className="block font-medium">{r.familyName}</span>
                  <span className="block text-xs text-muted-foreground">
                    {r.giftCount} gift{r.giftCount === 1 ? "" : "s"}{r.archived ? " · archived" : !r.canEmail && " · no email"}
                  </span>
                </span>
              </label>
              <span className="shrink-0 tabular font-medium whitespace-nowrap">{fmtAUD(r.total)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <StatusBadge status={r.lastStatus} claim={r.claim} />
              <span className="text-xs text-muted-foreground">{when(r.lastAt)}</span>
            </div>
            <div className="mt-2 border-t pt-2">
              <Button asChild variant="outline" size="sm">
                <Link href={pdfHref(r.familyId)} target="_blank" rel="noopener noreferrer">Preview PDF</Link>
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
