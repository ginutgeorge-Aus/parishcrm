"use client"

import { useRouter } from "next/navigation"
import type { PaymentAccountLite } from "@/lib/paymentAccounts"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PrintButton } from "@/components/ui/PrintButton"

interface Props {
  accounts: PaymentAccountLite[]
  paymentAccountId: number
  statementDate: string // YYYY-MM-DD
}

export function ReconReportControls({ accounts, paymentAccountId, statementDate }: Props) {
  const router = useRouter()

  function push(accountId: number, date: string) {
    router.push(
      `/accounting/reports/reconciliation?paymentAccount=${accountId}&statementDate=${date}`
    )
  }

  return (
    <div className="flex items-center gap-3 print:hidden">
      <Select
        value={String(paymentAccountId)}
        onValueChange={(v: string) => push(Number(v), statementDate)}
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
        value={statementDate}
        onChange={(e) => push(paymentAccountId, e.target.value)}
        className="w-40"
      />
      <div className="ml-auto">
        <PrintButton />
      </div>
    </div>
  )
}
