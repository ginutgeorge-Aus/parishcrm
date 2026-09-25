"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { sydneyParts } from "@/lib/dates"
import { useCallback, useEffect, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import type { PaymentAccountLite } from "@/lib/paymentAccounts"

type Account = { id: number; code: string; name: string }
type Family = { id: number; name: string }

const RANGE_OPTIONS = [
  { value: "this-week", label: "This week" },
  { value: "last-week", label: "Last week" },
  { value: "this-month", label: "This month" },
  { value: "last-month", label: "Last month" },
  { value: "last-3-months", label: "Last 3 months" },
  { value: "last-6-months", label: "Last 6 months" },
  { value: "this-fy", label: "This financial year" },
] as const

function fmtDate(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

// Subtract N months, clamping the day to the target month's length. Plain
// setMonth/Date-constructor overflow (e.g. May 31 − 3 → Feb 31 → Mar 3) would
// widen the range past the intended month boundary.
function monthsAgo(base: Date, n: number): Date {
  const d = new Date(base.getFullYear(), base.getMonth() - n, 1)
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(base.getDate(), lastDay))
  return d
}

// Compute {from,to} ISO dates for a quick-range preset. "Today" is the
// APP_TIMEZONE calendar date, not the viewer's browser zone; the
// arithmetic below is pure calendar math on local Date fields.
// Week starts Monday. FY starts 1 July (matches currentFYYear()).
function presetRange(preset: string): { from: string; to: string } | null {
  const { year, month, day } = sydneyParts()
  const today = new Date(year, month - 1, day)
  const startOfWeek = (d: Date) => {
    const x = new Date(d)
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7)) // Mon = 0
    return x
  }
  switch (preset) {
    case "this-week":
      return { from: fmtDate(startOfWeek(today)), to: fmtDate(today) }
    case "last-week": {
      const start = startOfWeek(today)
      const lastStart = new Date(start)
      lastStart.setDate(start.getDate() - 7)
      const lastEnd = new Date(start)
      lastEnd.setDate(start.getDate() - 1)
      return { from: fmtDate(lastStart), to: fmtDate(lastEnd) }
    }
    case "this-month":
      return { from: fmtDate(new Date(today.getFullYear(), today.getMonth(), 1)), to: fmtDate(today) }
    case "last-month":
      return {
        from: fmtDate(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
        to: fmtDate(new Date(today.getFullYear(), today.getMonth(), 0)),
      }
    case "last-3-months":
      return { from: fmtDate(monthsAgo(today, 3)), to: fmtDate(today) }
    case "last-6-months":
      return { from: fmtDate(monthsAgo(today, 6)), to: fmtDate(today) }
    case "this-fy": {
      const fyYear = today.getMonth() >= 6 ? today.getFullYear() : today.getFullYear() - 1
      return { from: `${fyYear}-07-01`, to: fmtDate(today) }
    }
    default:
      return null
  }
}

// Quick-range preset whose computed dates exactly match the URL from/to, else "".
function currentPreset(from: string, to: string): string {
  if (!from || !to) return ""
  for (const o of RANGE_OPTIONS) {
    const r = presetRange(o.value)
    if (r && r.from === from && r.to === to) return o.value
  }
  return ""
}

export function TransactionFilters({
  accounts,
  families,
  paymentAccounts,
}: {
  accounts: Account[]
  families: Family[]
  paymentAccounts: PaymentAccountLite[]
}) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const update = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value) params.set(key, value)
      else params.delete(key)
      params.delete("page") // any filter change resets to page 1
      router.push(`/accounting/transactions?${params.toString()}`)
    },
    [router, searchParams]
  )

  // The description search drives a server render + decrypt scan, so debounce it
  // instead of firing a navigation per keystroke. Keep the input value in
  // local state for instant feedback; sync it when the URL changes elsewhere.
  const urlQ = searchParams.get("q") ?? ""
  const [qLocal, setQLocal] = useState(urlQ)
  const [prevUrlQ, setPrevUrlQ] = useState(urlQ)
  // Sync local input when the URL's q changes elsewhere (e.g. Clear), using the
  // adjust-state-during-render pattern instead of an effect.
  if (urlQ !== prevUrlQ) {
    setPrevUrlQ(urlQ)
    setQLocal(urlQ)
  }
  const qTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (qTimer.current) clearTimeout(qTimer.current) }, [])

  // Keep a ref to the LATEST `update` so the debounced search timer rebuilds
  // params from the current searchParams. Firing the closure captured at
  // keystroke time would rebuild from a stale snapshot and silently drop any
  // other filter the user changed within the 350ms window.
  const updateRef = useRef(update)
  useEffect(() => { updateRef.current = update }, [update])

  const onSearchChange = (value: string) => {
    setQLocal(value)
    if (qTimer.current) clearTimeout(qTimer.current)
    qTimer.current = setTimeout(() => updateRef.current("q", value), 350)
  }

  // Start empty so the server render and the first client render agree (the
  // Select shows "Quick range"). `currentPreset` derives "today" from the
  // local clock, so computing it during render would produce a different value
  // on a UTC server vs a Sydney browser near midnight — a hydration mismatch
  // ( round 2). Resolve it in an effect (client-only, post-hydration
  // — see below) so a direct visit / reload with from+to matching a preset
  // still reflects that preset ( round 1).
  const [rangeLocal, setRangeLocal] = useState("")

  const urlFrom = searchParams.get("from") ?? ""
  const urlTo = searchParams.get("to") ?? ""
  const rangeKey = `${urlFrom}|${urlTo}`
  // Reconcile the quick-range select with the URL dates after hydration and on
  // any later URL change (Clear, manual date edits). setRange also sets it
  // optimistically on selection. This MUST be an effect, not the render-phase
  // adjust-state pattern used for qLocal above: currentPreset reads the local
  // clock, so computing it during render would diverge between a UTC server and
  // a Sydney browser near midnight → a hydration mismatch. Deriving it during
  // render is therefore not an option here, and the set-state-in-effect warning
  // (which normally steers you to render-time derivation) does not apply.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRangeLocal(currentPreset(urlFrom, urlTo))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey])

  const setRange = useCallback(
    (preset: string) => {
      const r = presetRange(preset)
      if (!r) return
      setRangeLocal(preset)
      const params = new URLSearchParams(searchParams.toString())
      params.set("from", r.from)
      params.set("to", r.to)
      params.delete("page") // range change resets to page 1
      router.push(`/accounting/transactions?${params.toString()}`)
    },
    [router, searchParams]
  )

  const clear = () => {
    if (qTimer.current) {
      clearTimeout(qTimer.current)
      qTimer.current = null
    }
    // The render-sync only reacts to a URL q change; when the box holds
    // uncommitted text (debounce not yet fired) urlQ was already "" so the
    // sync won't clear it. Reset it here too.
    setQLocal("")
    router.push("/accounting/transactions")
  }

  const hasFilters = searchParams.size > 0

  return (
    <div className="flex flex-wrap items-center gap-3 print:hidden">
      <Input
        type="text"
        className="w-48"
        value={qLocal}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Search description…"
        aria-label="Search by description"
      />
      <Select value={rangeLocal} onValueChange={setRange}>
        <SelectTrigger className="w-44" aria-label="Quick range">
          <SelectValue placeholder="Quick range" />
        </SelectTrigger>
        <SelectContent>
          {RANGE_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        type="date"
        className="w-40"
        value={searchParams.get("from") ?? ""}
        onChange={(e) => update("from", e.target.value)}
        aria-label="From date"
      />
      <Input
        type="date"
        className="w-40"
        value={searchParams.get("to") ?? ""}
        onChange={(e) => update("to", e.target.value)}
        aria-label="To date"
      />
      <Select
        value={searchParams.get("account") ?? ""}
        onValueChange={(v: string) => update("account", v === "ALL" ? "" : v)}
      >
        <SelectTrigger className="w-44" aria-label="Account">
          <SelectValue placeholder="All accounts" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All accounts</SelectItem>
          {accounts.map((a) => (
            <SelectItem key={a.id} value={String(a.id)}>{a.code} {a.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={searchParams.get("type") ?? ""}
        onValueChange={(v: string) => update("type", v === "ALL" ? "" : v)}
      >
        <SelectTrigger className="w-36" aria-label="Type">
          <SelectValue placeholder="All types" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All types</SelectItem>
          <SelectItem value="INCOME">Income</SelectItem>
          <SelectItem value="EXPENSE">Expense</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={searchParams.get("family") ?? ""}
        onValueChange={(v: string) => update("family", v === "ALL" ? "" : v)}
      >
        <SelectTrigger className="w-44" aria-label="Family">
          <SelectValue placeholder="All families" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All families</SelectItem>
          {families.map((f) => (
            <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={searchParams.get("paymentAccount") ?? ""}
        onValueChange={(v: string) => update("paymentAccount", v === "ALL" ? "" : v)}
      >
        <SelectTrigger className="w-40" aria-label="Payment account">
          <SelectValue placeholder="All accounts" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All accounts</SelectItem>
          {paymentAccounts.map((a) => (
            <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={searchParams.get("reconciled") ?? ""}
        onValueChange={(v: string) => update("reconciled", v === "ALL" ? "" : v)}
      >
        <SelectTrigger className="w-36" aria-label="Reconciled status">
          <SelectValue placeholder="All status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All status</SelectItem>
          <SelectItem value="true">Reconciled</SelectItem>
          <SelectItem value="false">Pending</SelectItem>
        </SelectContent>
      </Select>
      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={clear}>
          Clear
        </Button>
      )}
    </div>
  )
}
