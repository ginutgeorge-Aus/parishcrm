import { toCents, centsToNumber, formatDMY } from "@/lib/formatting"
import { escapeCsv } from "@/lib/csvUtils"

export type GLRow = {
  date: Date
  description: string // must be decrypted before passing in
  reference: string | null
  type: "INCOME" | "EXPENSE"
  amount: { toString(): string } | number
}

export type GLRowWithBalance = GLRow & { balanceCents: number }

/** Signed integer cents: income positive, expense negative. */
export function signedCents(type: "INCOME" | "EXPENSE", amount: { toString(): string } | number): number {
  const cents = toCents(amount)
  return type === "EXPENSE" ? -cents : cents
}

/**
 * Cumulative running balance (integer cents) in input order, starting at 0.
 * Caller must pass rows already sorted chronologically.
 */
export function withRunningBalance(rows: GLRow[]): GLRowWithBalance[] {
  let running = 0
  return rows.map((r) => {
    running += signedCents(r.type, r.amount)
    return { ...r, balanceCents: running }
  })
}

const HEADERS = ["Date", "Description", "Reference", "Type", "Amount", "Running Balance"]

/** CSV mirroring transactionExport.ts; description already decrypted by caller. */
export function generateGeneralLedgerCsv(rows: GLRowWithBalance[]): string {
  const body = rows.map((r) =>
    [
      formatDMY(r.date),
      r.description,
      r.reference ?? "",
      r.type,
      centsToNumber(signedCents(r.type, r.amount)).toFixed(2),
      centsToNumber(r.balanceCents).toFixed(2),
    ]
      .map(escapeCsv)
      .join(","),
  )
  return [HEADERS.map(escapeCsv).join(","), ...body].join("\n")
}
