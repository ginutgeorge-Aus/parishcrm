"use client"

import { useState, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { ParsedRow } from "@/lib/anzParser"
import type { PaymentAccountLite } from "@/lib/paymentAccounts"

interface BankUploadStepProps {
  paymentAccounts: PaymentAccountLite[]
  onUploadComplete: (
    rows: ParsedRow[],
    duplicates: string[],
    period: { from: string; to: string } | null,
    paymentAccountId: number,
    parseErrors: string[]
  ) => void
}

export function BankUploadStep({ paymentAccounts, onUploadComplete }: BankUploadStepProps) {
  // Preselect the account flagged Default (active BANK) so the upload picker
  // isn't blank on first render.
  const defaultBankId = paymentAccounts.find(
    (a) => a.kind === "BANK" && a.isDefault && a.isActive
  )?.id
  const [paymentAccountId, setPaymentAccountId] = useState<number | "">(defaultBankId ?? "")
  const [uploading, setUploading] = useState(false)
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleParse() {
    const file = fileRef.current?.files?.[0]
    // Surface why nothing happens instead of silently no-opping — the button is
    // enabled before a file is picked.
    if (!paymentAccountId) { setParseErrors(["Please select a bank account."]); return }
    if (!file) { setParseErrors(["Please select a statement PDF."]); return }
    setUploading(true)
    const formData = new FormData()
    formData.append("file", file)
    let res: Response
    try {
      res = await fetch("/api/import/bank-statement", { method: "POST", body: formData })
    } catch {
      // A network throw (offline, timeout, reset) would otherwise skip
      // setUploading(false) and leave the Parse button disabled forever.
      setUploading(false)
      setParseErrors(["Network error — please retry."])
      return
    }
    setUploading(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setParseErrors([body.error ?? "Failed to parse PDF. Ensure it is an ANZ Business Extra Statement."])
      return
    }
    const data = await res.json()
    const errors: string[] = data.errors ?? []
    setParseErrors(errors)
    onUploadComplete(
      data.rows as ParsedRow[],
      data.duplicateBankRefs as string[],
      data.period ?? null,
      paymentAccountId as number,
      errors
    )
  }

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>Import ANZ Bank Statement</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Upload an ANZ Business Extra Statement PDF. Transactions are previewed before import.
        </p>
        {parseErrors.length > 0 && (
          <p className="text-sm text-destructive">{parseErrors[0]}</p>
        )}
        <div className="space-y-1">
          <label htmlFor="bank-account" className="text-sm font-medium">Which account? *</label>
          <Select
            value={paymentAccountId === "" ? "" : String(paymentAccountId)}
            onValueChange={(v: string) => setPaymentAccountId(Number(v))}
          >
            <SelectTrigger id="bank-account" className="w-full">
              <SelectValue placeholder="Select account…" />
            </SelectTrigger>
            <SelectContent>
              {paymentAccounts.map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label htmlFor="bank-pdf" className="text-sm font-medium">Statement PDF *</label>
          <input ref={fileRef} id="bank-pdf" type="file" accept="application/pdf" className="text-sm" />
        </div>
        <Button onClick={handleParse} disabled={uploading || !paymentAccountId}>
          {uploading ? "Parsing…" : "Parse Statement"}
        </Button>
      </CardContent>
    </Card>
  )
}
