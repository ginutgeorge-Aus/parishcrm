"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ANNIVERSARY_WINDOWS } from "@/lib/anniversaries"
import { sendAnniversaryEmail, sendAnniversaryEmailsBulk } from "@/lib/actions/anniversary"
import { FetchCapNotice } from "@/components/people/FetchCapNotice"

type Row = {
  familyId: number
  names: string
  family: string
  date: string
  years: number
  hasEmail: boolean
  emailConsent: boolean
}

export function AnniversariesClient({
  rows,
  windowDays,
  canEdit,
  truncated = false,
}: {
  rows: Row[]
  windowDays: number
  canEdit: boolean
  truncated?: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [sendingId, setSendingId] = useState<number | null>(null)
  // Rows successfully emailed this session — kept client-side so a sent row
  // can't be re-sent without a full page reload (mirrors for birthdays).
  const [sentIds, setSentIds] = useState<Set<number>>(new Set())

  const isSent = (r: Row) => sentIds.has(r.familyId)
  const eligible = (r: Row) => r.hasEmail && r.emailConsent && !isSent(r)
  const reason = (r: Row) =>
    isSent(r) ? "Sent" : !r.hasEmail ? "No email" : !r.emailConsent ? "No consent" : "Ready"

  const sendOne = (r: Row) => {
    setMessage(null)
    setSendingId(r.familyId)
    startTransition(async () => {
      try {
        const res = await sendAnniversaryEmail(r.familyId)
        if (res && "error" in res) {
          setMessage(`❌ ${res.error}`)
        } else {
          setMessage(`✅ ${res?.success ?? "Sent"}`)
          setSentIds((prev) => new Set(prev).add(r.familyId))
        }
      } catch {
        setMessage(`❌ Failed to send anniversary email`)
      } finally {
        setSendingId(null)
      }
    })
  }

  const sendAll = () => {
    setMessage(null)
    const targetIds = rows.filter(eligible).map((r) => r.familyId)
    startTransition(async () => {
      try {
        const res = await sendAnniversaryEmailsBulk(windowDays)
        if ("error" in res) {
          setMessage(`❌ ${res.error}`)
        } else {
          setMessage(`✅ Sent ${res.sent}, skipped ${res.skipped}, failed ${res.failed}`)
          // Bulk API returns only aggregate counts, not per-row ids. Mark the batch
          // Sent only when every target went out cleanly — on any skip/failure leave
          // rows eligible so the unsent ones can be retried (mirrors birthday/).
          if (res.failed === 0 && res.skipped === 0) {
            setSentIds((prev) => new Set([...prev, ...targetIds]))
          }
        }
      } catch {
        setMessage(`❌ Failed to send bulk anniversary emails`)
      }
    })
  }

  const eligibleCount = rows.filter(eligible).length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-foreground">💍 Upcoming Anniversaries</h2>
        {canEdit && (
          <Button size="sm" onClick={sendAll} disabled={pending || eligibleCount === 0}>
            Send all ({eligibleCount})
          </Button>
        )}
      </div>

      <div className="flex gap-2">
        {ANNIVERSARY_WINDOWS.map((w) => (
          <Button
            key={w}
            size="sm"
            variant={w === windowDays ? "default" : "outline"}
            aria-pressed={w === windowDays}
            onClick={() => router.push(`/people/anniversaries?window=${w}`)}
          >
            Next {w} days
          </Button>
        ))}
      </div>

      {truncated && <FetchCapNotice />}

      {message && (
        <p role="status" aria-live="polite" className="text-sm">
          {message}
        </p>
      )}

      {/* Mobile: stacked cards */}
      <ul className="space-y-3 md:hidden">
        {rows.length === 0 && (
          <li className="rounded-lg border bg-card py-8 text-center text-muted-foreground">
            No anniversaries in this window
          </li>
        )}
        {rows.map((r) => (
          <li key={r.familyId} className="rounded-lg border bg-card p-4">
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium">{r.names}</span>
              <Badge variant={eligible(r) ? "default" : "outline"}>{reason(r)}</Badge>
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {r.family} · {r.date} · {r.years} yrs
            </div>
            {canEdit && (
              <Button
                className="mt-3 min-h-11 w-full"
                variant="outline"
                disabled={!eligible(r) || pending}
                onClick={() => sendOne(r)}
              >
                {sendingId === r.familyId ? "Sending…" : "Send"}
              </Button>
            )}
          </li>
        ))}
      </ul>

      {/* Desktop: table */}
      <div className="hidden overflow-x-auto md:block">
        <Table className="min-w-table">
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-nowrap">Couple</TableHead>
              <TableHead className="whitespace-nowrap">Family</TableHead>
              <TableHead className="whitespace-nowrap">Date</TableHead>
              <TableHead className="whitespace-nowrap">Years</TableHead>
              <TableHead className="whitespace-nowrap">Email</TableHead>
              {canEdit && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={canEdit ? 6 : 5} className="py-8 text-center text-muted-foreground">
                  No anniversaries in this window
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.familyId}>
                <TableCell>{r.names}</TableCell>
                <TableCell>{r.family}</TableCell>
                <TableCell className="whitespace-nowrap">{r.date}</TableCell>
                <TableCell>{r.years}</TableCell>
                <TableCell>
                  <Badge variant={eligible(r) ? "default" : "outline"}>{reason(r)}</Badge>
                </TableCell>
                {canEdit && (
                  <TableCell>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!eligible(r) || pending}
                      onClick={() => sendOne(r)}
                    >
                      {sendingId === r.familyId ? "Sending…" : "Send"}
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
