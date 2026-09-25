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
import { BIRTHDAY_WINDOWS } from "@/lib/birthdays"
import { sendBirthdayEmail, sendBirthdayEmailsBulk } from "@/lib/actions/birthday"
import { FetchCapNotice } from "@/components/people/FetchCapNotice"

type Row = {
  id: number
  name: string
  family: string
  dob: string
  ageTurning: number
  hasEmail: boolean
  emailConsent: boolean
}

export function BirthdaysClient({
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
  // can't be re-sent without a full page reload.
  const [sentIds, setSentIds] = useState<Set<number>>(new Set())

  const isSent = (r: Row) => sentIds.has(r.id)
  const eligible = (r: Row) => r.hasEmail && r.emailConsent && !isSent(r)
  const reason = (r: Row) =>
    isSent(r) ? "Sent" : !r.hasEmail ? "No email" : !r.emailConsent ? "No consent" : "Ready"

  const sendOne = (r: Row) => {
    setMessage(null)
    setSendingId(r.id)
    startTransition(async () => {
      const res = await sendBirthdayEmail(r.id)
      if (res && "error" in res) {
        setMessage(`❌ ${res.error}`)
      } else {
        setMessage(`✅ ${res?.success ?? "Sent"}`)
        setSentIds((prev) => new Set(prev).add(r.id))
      }
      setSendingId(null)
    })
  }

  const sendAll = () => {
    setMessage(null)
    const targetIds = rows.filter(eligible).map((r) => r.id)
    startTransition(async () => {
      const res = await sendBirthdayEmailsBulk(windowDays)
      if ("error" in res) {
        setMessage(`❌ ${res.error}`)
      } else {
        setMessage(`✅ Sent ${res.sent}, skipped ${res.skipped}, failed ${res.failed}`)
        // Bulk API returns only aggregate counts, not per-row ids. Mark the batch
        // Sent only when every target went out cleanly — on any skip/failure leave
        // rows eligible so the unsent ones can be retried ( review).
        if (res.failed === 0 && res.skipped === 0) {
          setSentIds((prev) => new Set([...prev, ...targetIds]))
        }
      }
    })
  }

  const eligibleCount = rows.filter(eligible).length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-foreground">🎂 Upcoming Birthdays</h2>
        {canEdit && (
          <Button size="sm" onClick={sendAll} disabled={pending || eligibleCount === 0}>
            Send all ({eligibleCount})
          </Button>
        )}
      </div>

      <div className="flex gap-2">
        {BIRTHDAY_WINDOWS.map((w) => (
          <Button
            key={w}
            size="sm"
            variant={w === windowDays ? "default" : "outline"}
            aria-pressed={w === windowDays}
            onClick={() => router.push(`/people/birthdays?window=${w}`)}
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
            No birthdays in this window
          </li>
        )}
        {rows.map((r) => (
          <li key={r.id} className="rounded-lg border bg-card p-4">
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium">{r.name}</span>
              <Badge variant={eligible(r) ? "default" : "outline"}>{reason(r)}</Badge>
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {r.family} · {r.dob} · turning {r.ageTurning}
            </div>
            {canEdit && (
              <Button
                className="mt-3 min-h-11 w-full"
                variant="outline"
                disabled={!eligible(r) || pending}
                onClick={() => sendOne(r)}
              >
                {sendingId === r.id ? "Sending…" : "Send"}
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
              <TableHead className="whitespace-nowrap">Name</TableHead>
              <TableHead className="whitespace-nowrap">Family</TableHead>
              <TableHead className="whitespace-nowrap">DOB</TableHead>
              <TableHead className="whitespace-nowrap">Age turning</TableHead>
              <TableHead className="whitespace-nowrap">Email</TableHead>
              {canEdit && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>

            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={canEdit ? 6 : 5} className="py-8 text-center text-muted-foreground">
                  No birthdays in this window
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.name}</TableCell>
                <TableCell>{r.family}</TableCell>
                <TableCell className="whitespace-nowrap">{r.dob}</TableCell>
                <TableCell>{r.ageTurning}</TableCell>
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
                      {sendingId === r.id ? "Sending…" : "Send"}
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
