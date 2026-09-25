"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useCallback } from "react"
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

const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "reconciled", label: "Reconciled" },
] as const

export function ReconciliationFilters({
  accounts,
  paymentAccountId,
  from,
  to,
  status,
}: {
  accounts: PaymentAccountLite[]
  paymentAccountId: number
  from: string
  to: string
  status: string
}) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const update = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value) params.set(key, value)
      else params.delete(key)
      router.push(`/accounting/reconciliation?${params.toString()}`)
    },
    [router, searchParams]
  )

  const reset = () => router.push("/accounting/reconciliation")

  return (
    <div className="flex flex-wrap items-center gap-3 print:hidden">
      <Select
        value={String(paymentAccountId)}
        onValueChange={(v: string) => update("paymentAccount", v)}
      >
        <SelectTrigger className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {accounts.map((a) => (
            <SelectItem key={a.id} value={String(a.id)}>
              {a.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        type="date"
        className="w-40"
        value={from}
        onChange={(e) => update("from", e.target.value)}
        aria-label="From date"
      />
      <Input
        type="date"
        className="w-40"
        value={to}
        onChange={(e) => update("to", e.target.value)}
        aria-label="To date"
      />
      <Select
        value={status || "all"}
        onValueChange={(v: string) => update("status", v === "all" ? "" : v)}
      >
        <SelectTrigger className="w-36" aria-label="Status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="ghost" size="sm" onClick={reset}>
        Reset
      </Button>
    </div>
  )
}
