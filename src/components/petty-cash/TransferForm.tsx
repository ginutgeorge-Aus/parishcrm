"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useActionState, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { sydneyTodayYMD } from "@/lib/dates"
import { fmtAUD, toCents } from "@/lib/formatting"
import type { ActionResult } from "@/lib/actions/types"
import { WINDOW_GUARD_TAG } from "@/lib/xferRefs"
import { APP_CURRENCY } from "@/lib/appConfig"
import type { ImportedTransferOption } from "@/lib/pettyCashTransferCandidates"
import { useSubmissionToken } from "./useSubmissionToken"

export function TransferForm({
  action,
  maxAmount,
  imported = [],
  importedTruncated = false,
  importedFiltered = false,
  isAdmin = false,
}: Readonly<{
  action: (_prev: ActionResult, formData: FormData) => Promise<ActionResult>
  maxAmount: number
  /** Bank-import deposits marked "from petty cash" not yet linked to a transfer. */
  imported?: ImportedTransferOption[]
  /** True when more matching imported deposits exist than the list shows. */
  importedTruncated?: boolean
  /** True when the list is narrowed to one amount + day via the lookup link. */
  importedFiltered?: boolean
  /** Viewer is ADMIN: may override the cross-day window guard (server re-checks the role). */
  isAdmin?: boolean
}>) {
  const router = useRouter()
  // Idempotency token (#491), stable per mounted form — see useSubmissionToken.
  const submitWithToken = useSubmissionToken(action)
  const [state, formAction, isPending] = useActionState(submitWithToken, undefined)
  // Controlled (not an uncontrolled field) so it survives React's post-action form reset.
  const [override, setOverride] = useState(false)
  const [importedId, setImportedId] = useState("")
  const [date, setDate] = useState(() => sydneyTodayYMD())
  const [amount, setAmount] = useState("")
  // Manual date/amount stashed before the first imported pick, restored on "None".
  const [manual, setManual] = useState<{ date: string; amount: string } | null>(null)
  // Cents computed once so option comparisons are exact (no float drift).
  const maxCents = toCents(maxAmount.toFixed(2))

  /** Picking an imported deposit prefills date + amount; choosing "None" restores the manually entered values stashed before the first pick. */
  function pickImported(id: string) {
    setImportedId(id)
    const opt = imported.find((o) => String(o.id) === id)
    if (opt) {
      if (importedId === "") setManual({ date, amount })
      setDate(opt.date)
      setAmount(opt.amount)
    } else {
      setDate(manual?.date ?? sydneyTodayYMD())
      setAmount(manual?.amount ?? "")
      setManual(null)
    }
  }

  // Client-side lookup links keep this form mounted while `imported` changes: if the picked deposit
  // left the list, drop the pick (and unlock/restore date + amount) so a hidden id is never submitted.
  if (importedId !== "" && !imported.some((o) => String(o.id) === importedId)) pickImported("")

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      {state?.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}

      {isAdmin && state?.error?.includes(WINDOW_GUARD_TAG) && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={override}
            onChange={(e) => setOverride(e.target.checked)}
            className="mt-1 size-4 shrink-0"
          />
          <span>Admin: record anyway (separate deposit)</span>
        </label>
      )}
      <input type="hidden" name="overrideWindowGuard" value={override ? "true" : ""} />

      <div className="rounded-lg border bg-muted/30 p-3 text-sm">
        Current cash in hand: <span className="font-semibold">{fmtAUD(maxAmount)}</span>
      </div>

      {(imported.length > 0 || importedTruncated || importedFiltered) && (
        <div className="space-y-1">
          <Label htmlFor="importedTransactionId">
            Imported bank deposit{" "}
            <span className="text-muted-foreground text-xs">(optional — marked as cash transfer on import)</span>
          </Label>
          <select
            id="importedTransactionId"
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
          {importedFiltered && (
            <p className="text-xs text-muted-foreground">
              Showing deposits for one date and amount only.{" "}
              <Link className="underline" href="?" scroll={false}>Show newest deposits</Link>
            </p>
          )}
          {importedTruncated && !importedFiltered && (
            <p className="text-xs text-muted-foreground">
              Showing the newest {imported.length} deposits; older ones are not listed.
              {date && amount && (
                <>
                  {" "}
                  <Link
                    className="underline"
                    href={`?date=${encodeURIComponent(date)}&amount=${encodeURIComponent(amount)}`}
                    scroll={false}
                  >
                    Look up deposits for the date and amount entered below
                  </Link>
                  .
                </>
              )}
            </p>
          )}
        </div>
      )}

      {/* State is the source of truth: React resets uncontrolled form fields after a
          failed action, which would revert the select and drop the id on resubmit. */}
      <input type="hidden" name="importedTransactionId" value={importedId} />

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
