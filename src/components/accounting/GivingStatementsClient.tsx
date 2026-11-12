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

/** Status badge for a family's latest send attempt. */
function StatusBadge({ status }: Readonly<{ status: StatementListRow["lastStatus"] }>) {
  if (!status) return <span className="text-xs text-muted-foreground">Not sent</span>
  return <Badge variant={status === "SENT" ? "default" : "destructive"}>{status}</Badge>
}

/**
 * Giving statements table with row selection and a bulk "Email selected" action.
 * Rows without a consenting email address can be previewed but not selected.
 */
export function GivingStatementsClient({ year, rows, canManage }: Readonly<Props>) {
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [errors, setErrors] = useState<string[]>([])
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

  /** Select every emailable family not already sent, or clear when all are selected. */
  function toggleAll() {
    const pendingIds = emailable.filter((r) => r.lastStatus !== "SENT").map((r) => r.familyId)
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
        const errs: string[] = []
        for (let i = 0; i < ids.length; i += 200) {
          const res = await sendGivingStatements(year, ids.slice(i, i + 200))
          if ("error" in res) {
            setMessage(res.error)
            return
          }
          sent += res.sent
          failed += res.failed
          skipped += res.skipped
          errs.push(...res.errors.map((e) => `${nameById.get(e.familyId) ?? `Family #${e.familyId}`}: ${e.error}`))
        }
        setSelected(new Set())
        setErrors(errs)
        setMessage(`Sent ${sent}, failed ${failed}${skipped ? `, skipped ${skipped} already sent` : ""}.`)
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
          {message && <span role="status" className="text-sm text-muted-foreground">{message}</span>}
        </div>
      )}
      {errors.length > 0 && (
        <ul role="alert" className="list-disc pl-5 text-xs text-destructive">
          {errors.map((e) => <li key={e}>{e}</li>)}
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
                  {!r.canEmail && <span className="ml-2 text-xs text-muted-foreground">no email</span>}
                </td>
                <td className="px-4 py-2 text-muted-foreground">{r.giftCount}</td>
                <td className="px-4 py-2 font-medium whitespace-nowrap">{fmtAUD(r.total)}</td>
                <td className="px-4 py-2"><StatusBadge status={r.lastStatus} /></td>
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
                    {r.giftCount} gift{r.giftCount === 1 ? "" : "s"}{!r.canEmail && " · no email"}
                  </span>
                </span>
              </label>
              <span className="shrink-0 tabular font-medium whitespace-nowrap">{fmtAUD(r.total)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <StatusBadge status={r.lastStatus} />
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
