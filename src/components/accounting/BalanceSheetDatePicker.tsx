"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { Input } from "@/components/ui/input"

export function BalanceSheetDatePicker({ value = "" }: { value?: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const params = new URLSearchParams(searchParams.toString())
    if (e.target.value) {
      params.set("date", e.target.value)
    } else {
      params.delete("date")
    }
    const qs = params.toString()
    router.push(`/accounting/reports/balance-sheet${qs ? `?${qs}` : ""}`)
  }

  return (
    <Input
      type="date"
      value={value}
      onChange={handleChange}
      className="w-auto"
      aria-label="Balance sheet date"
    />
  )
}
