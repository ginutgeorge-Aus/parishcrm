"use client"

import { useRouter } from "next/navigation"
import { useActionState, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { sydneyTodayYMD } from "@/lib/dates"
import { fmtAUD, toCents } from "@/lib/formatting"
import type { ActionResult } from "@/lib/actions/types"
import { APP_CURRENCY } from "@/lib/appConfig"
import type { ImportedTransferOption } from "@/lib/pettyCashTransferCandidates"

export function TransferForm({
  action,
  maxAmount,
  imported = [],
}: Readonly<{
  action: (_prev: ActionResult, formData: FormData) => Promise<ActionResult>
  maxAmount: number
  /** Bank-import deposits marked "from petty cash" not yet linked to a transfer. */
  imported?: ImportedTransferOption[]
}>) {
  const router = useRouter()
  const [state, formAction, isPending] = useActionState(action, undefined)
  const [importedId, setImportedId] = useState("")
  const [date, setDate] = useState(sydneyTodayYMD())
  const [amount, setAmount] = useState("")
  // Cents computed once so option comparisons are exact (no float drift).
  const maxCents = toCents(maxAmount.toFixed(2))

  /** Picking an imported deposit prefills date + amount; clearing keeps manual values. */
  function pickImported(id: string) {
    setImportedId(id)
    const opt = imported.find((o) => String(o.id) === id)
    if (opt) {
      setDate(opt.date)
      setAmount(opt.amount)
    }
  }

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      {state?.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}

      <div className="rounded-lg border bg-muted/30 p-3 text-sm">
        Current cash in hand: <span className="font-semibold">{fmtAUD(maxAmount)}</span>
      </div>

      {imported.length > 0 && (
        <div className="space-y-1">
          <Label htmlFor="importedTransactionId">
            Imported bank deposit{" "}
            <span className="text-muted-foreground text-xs">(optional — marked as cash transfer on import)</span>
          </Label>
          <select
            id="importedTransactionId"
            name="importedTransactionId"
            value={importedId}
            onChange={(e) => pickImported(e.target.value)}
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          >
            <option value="">— None (enter manually) —</option>
            {imported.map((o) => {
              const exceeds = toCents(o.amount) > maxCents
              return (
                <option key={o.id} value={o.id} disabled={exceeds}>
                  {o.date} · {fmtAUD(Number(o.amount))} · {o.description}{exceeds ? " (exceeds cash in hand)" : ""}
                </option>
              )
            })}
          </select>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="date">Transfer date</Label>
          <Input
            id="date"
            name="date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            readOnly={importedId !== ""}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="amount">Amount deposited ({APP_CURRENCY})</Label>
          <Input
            id="amount"
            name="amount"
            type="number"
            step="0.01"
            min="0.01"
            max={maxAmount.toFixed(2)}
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            readOnly={importedId !== ""}
            required
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="retainedFloat">
          Retained float ({APP_CURRENCY}){" "}
          <span className="text-muted-foreground text-xs">(informational — amount kept back)</span>
        </Label>
        <Input
          id="retainedFloat"
          name="retainedFloat"
          type="number"
          step="0.01"
          min="0"
          defaultValue="0.00"
          placeholder="0.00"
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="depositedByName">Deposited by</Label>
        <Input id="depositedByName" name="depositedByName" required />
      </div>

      <div className="space-y-1">
        <Label htmlFor="depositSlipRef">
          Deposit slip ref{" "}
          <span className="text-muted-foreground text-xs">(optional)</span>
        </Label>
        <Input id="depositSlipRef" name="depositSlipRef" />
      </div>

      <div className="space-y-1">
        <Label htmlFor="notes">
          Notes <span className="text-muted-foreground text-xs">(optional)</span>
        </Label>
        <Textarea id="notes" name="notes" rows={2} />
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Record transfer"}</Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
