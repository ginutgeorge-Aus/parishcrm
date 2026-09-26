"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { fetchTransactionsForReceipt, sendBatchReceipts } from "@/lib/actions/receipt"
import type { TransactionForReceipt } from "@/lib/actions/receipt"
import { format } from "date-fns"
import { fmtAUD } from "@/lib/formatting"

type Account = { id: number; code: string; name: string }

export function SendReceiptsClient({ accounts }: { accounts: Account[] }) {
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [accountId, setAccountId] = useState("")
  const [rows, setRows] = useState<TransactionForReceipt[]>([])
  const [emails, setEmails] = useState<Record<number, string>>({})
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [result, setResult] = useState<{ sent: number; failed: number; errors: { transactionId: number; error: string }[] } | null>(null)
  const [isFetching, startFetch] = useTransition()
  const [isSending, startSend] = useTransition()

  function handleLoad() {
    setFetchError(null)
    setRows([])
    setSelected(new Set())
    setResult(null)
    startFetch(async () => {
      try {
        const res = await fetchTransactionsForReceipt(from, to, accountId ? Number.parseInt(accountId) : undefined)
        if ("error" in res) { setFetchError(res.error); return }
        setRows(res.transactions)
        const initialEmails: Record<number, string> = {}
        res.transactions.forEach((t) => { initialEmails[t.id] = t.defaultEmail ?? "" })
        setEmails(initialEmails)
      } catch {
        setFetchError("Failed to load transactions. Please check your network connection and try again.")
      }
    })
  }

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      return next
    })
  }

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(rows.map((r) => r.id)) : new Set())
  }

  function handleSend() {
    setResult(null)
    setFetchError(null)
    const selectedIds = Array.from(selected)
    const payload = selectedIds
      .filter((id) => emails[id]?.trim())
      .map((id) => ({ transactionId: id, toEmail: emails[id].trim() }))
    // Validate client-side before dispatch (HTML5 validation doesn't fire on a
    // programmatic send). The server re-validates, but this surfaces typos as a
    // clear error instead of per-row SMTP failures. Selected rows with no
    // email were previously dropped silently — count them so the user knows
    //.
    const missing = selectedIds.length - payload.length
    const invalid = payload.filter((p) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.toEmail)).length
    if (missing + invalid > 0) {
      setFetchError(`${missing + invalid} selected row(s) have a missing or invalid email address. Fix or deselect them before sending.`)
      return
    }
    startSend(async () => {
      try {
        const res = await sendBatchReceipts(payload)
        if ("error" in res) { setFetchError(res.error); return }
        setResult(res)
        setSelected(new Set())
      } catch {
        // Delivery outcome is unknown here — the server may have sent some or
        // all receipts before the response was lost. Batch send is not
        // idempotent, so do NOT tell the operator to blindly resend the same
        // selection (that would double-email the batch). Point them at the
        // receipt audit to see what actually went out.
        setFetchError("The send could not be confirmed — some receipts may already have gone out. Check Receipt Audit before resending to avoid duplicates.")
      }
    })
  }

  const allChecked = rows.length > 0 && selected.size === rows.length

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">From</label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-36" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">To</label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-36" />
        </div>
        <div>
          <label htmlFor="receipt-account" className="text-xs text-muted-foreground block mb-1">Account</label>
          <Select
            value={accountId || "ALL"}
            onValueChange={(v: string) => setAccountId(v === "ALL" ? "" : v)}
          >
            <SelectTrigger id="receipt-account" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All accounts</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>{a.code} — {a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={handleLoad} disabled={isFetching || !from || !to}>{isFetching ? "Loading…" : "Load Transactions"}</Button>
      </div>

      {fetchError && <p role="alert" className="text-sm text-destructive">{fetchError}</p>}

      {result && (
        <div className={`p-3 rounded-md text-sm ${result.failed > 0 ? "bg-warning/10 text-warning" : "bg-success/10 text-success"}`}>
          {result.sent} sent · {result.failed} failed
          {result.errors.map((e) => (
            <div key={e.transactionId} className="text-destructive text-xs mt-1">
              Transaction #{e.transactionId}: {e.error}
            </div>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={allChecked}
                onCheckedChange={(c: boolean | "indeterminate") => toggleAll(c === true)}
              />
              Select all ({rows.length})
            </label>
            <Button onClick={handleSend} disabled={isSending || selected.size === 0}>
              {isSending ? "Sending…" : `Send ${selected.size} Receipt${selected.size !== 1 ? "s" : ""}`}
            </Button>
          </div>

          <div className="bg-card border border-border rounded-lg overflow-x-auto hidden md:block">
            <table className="w-full min-w-table-wide text-sm">
              <thead className="bg-muted border-b border-border">
                <tr>
                  {["", "Date", "Description", "Account", "Amount", "Linked To", "Email", "Last Sent"].map((h) => (
                    <th key={h} className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">
                      <Checkbox
                        aria-label={`Select receipt for ${row.description}`}
                        checked={selected.has(row.id)}
                        onCheckedChange={() => toggleSelect(row.id)}
                      />
                    </td>
                    <td className="px-3 py-2 text-muted-foreground text-xs whitespace-nowrap">
                      {format(row.date, "dd/MM/yyyy")}
                    </td>
                    <td className="px-3 py-2">{row.description}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{row.account}</td>
                    <td className="px-3 py-2 font-medium tabular">
                      {fmtAUD(row.amount)}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {row.familyName ?? row.personName ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="email"
                        aria-label={`Email for ${row.description}`}
                        value={emails[row.id] ?? ""}
                        onChange={(e) => setEmails((prev) => ({ ...prev, [row.id]: e.target.value }))}
                        className="border border-border rounded px-2 py-1 text-xs w-44"
                        placeholder="email@example.com"
                      />
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {row.lastSentAt ? format(row.lastSentAt, "dd/MM/yyyy") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: card per row (avoids sideways table scroll) */}
          <ul className="space-y-2 md:hidden">
            {rows.length === 0 && (
              <li className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
                No transactions found
              </li>
            )}
            {rows.map((row) => (
              <li key={row.id} className="rounded-lg border bg-card p-3">
                <div className="flex items-start justify-between gap-3">
                  <label className="flex min-w-0 items-start gap-2">
                    <Checkbox
                      aria-label={`Select receipt for ${row.description}`}
                      checked={selected.has(row.id)}
                      onCheckedChange={() => toggleSelect(row.id)}
                      className="mt-0.5"
                    />
                    <div className="min-w-0">
                      <p className="font-medium">{row.description}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {format(row.date, "dd/MM/yyyy")} · {row.account}
                      </p>
                    </div>
                  </label>
                  <span className="shrink-0 tabular font-semibold whitespace-nowrap">
                    {fmtAUD(row.amount)}
                  </span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {row.familyName ?? row.personName ?? "—"}
                  {" · Last sent: "}
                  {row.lastSentAt ? format(row.lastSentAt, "dd/MM/yyyy") : "—"}
                </p>
                <div className="mt-2">
                  <label htmlFor={`email-mobile-${row.id}`} className="text-xs text-muted-foreground block mb-1">
                    Email
                  </label>
                  <input
                    id={`email-mobile-${row.id}`}
                    type="email"
                    aria-label={`Email for ${row.description}`}
                    value={emails[row.id] ?? ""}
                    onChange={(e) => setEmails((prev) => ({ ...prev, [row.id]: e.target.value }))}
                    className="border border-border rounded px-2 py-1 text-xs w-full"
                    placeholder="email@example.com"
                  />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
