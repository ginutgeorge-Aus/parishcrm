"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { saveStatementBalance } from "@/lib/actions/reconciliation"
import { APP_LOCALE } from "@/lib/appConfig"
import { fmtAUD as fmt } from "@/lib/formatting"

// Format a YMD string directly — never via `new Date(s)`, which would parse as
// UTC midnight and can shift the displayed day across the Sydney timezone.
function fmtStatementDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number)
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return ymd

  const date = new Date(Date.UTC(y, m - 1, d))
  // Reject day overflow (e.g. 31 Feb) rather than rolling into the next month.
  if (date.getUTCDate() !== d) return ymd
  return new Intl.DateTimeFormat(APP_LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date)
}

interface Props {
  paymentAccountId: number
  statementDate: string
  initialValue: string | null
  calculatedBalance: number
  canEdit: boolean
}

export function StatementBalanceInput({
  paymentAccountId,
  statementDate,
  initialValue,
  calculatedBalance,
  canEdit,
}: Props) {
  const [value, setValue] = useState(initialValue ?? "")
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const statementAmt = value !== "" ? parseFloat(value) : null
  // Compare in integer cents to avoid IEEE-754 noise (e.g. 1e-15) from
  // subtracting two floats; the input is constrained to ≤2 decimal places.
  const diffCents =
    statementAmt !== null && !isNaN(statementAmt)
      ? Math.round(calculatedBalance * 100) - Math.round(statementAmt * 100)
      : null
  const difference = diffCents !== null ? diffCents / 100 : null
  const balanced = diffCents !== null && diffCents === 0

  function handleSave() {
    setError(null)
    setNotice(null)
    startTransition(async () => {
      try {
        const result = await saveStatementBalance(paymentAccountId, statementDate, value)
        if (result && "error" in result) setError(result.error)
        else if (result && "success" in result) setNotice(result.success)
      } catch {
        // Transport-level throw bypasses the {error}/{success} branches.
        setError("Something went wrong, try again")
      }
    })
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground w-52">
          Statement Closing Balance
          <span className="block text-xs text-muted-foreground">as of {fmtStatementDate(statementDate)}</span>
        </span>
        {canEdit ? (
          <>
            <div className="relative">
              <span className="absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm select-none">
                $
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="border rounded px-2 py-1 ps-6 text-sm w-36 tabular"
                placeholder="0.00"
                maxLength={15}
                aria-label="Statement closing balance"
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleSave}
              disabled={isPending || value === "" || !/^-?\d+(\.\d{1,2})?$/.test(value)}
            >
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        ) : (
          <span className="text-sm tabular text-muted-foreground">
            {value !== "" && !isNaN(parseFloat(value)) ? fmt(parseFloat(value)) : "—"}
          </span>
        )}
      </div>
      {error && <p role="alert" className="text-xs text-destructive ml-52">{error}</p>}
      {notice && !error && (
        <p
          className={`text-xs ml-52 ${notice.startsWith("Balanced") ? "text-success" : "text-warning"}`}
        >
          {notice}
        </p>
      )}
      {difference !== null && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground w-52">Difference</span>
          <span
            className={`text-sm font-semibold tabular ${
              balanced ? "text-success" : "text-destructive"
            }`}
          >
            {balanced ? "$0.00 ✓" : `${fmt(Math.abs(difference))} out of balance`}
          </span>
        </div>
      )}
    </div>
  )
}
