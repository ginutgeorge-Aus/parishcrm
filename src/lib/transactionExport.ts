import { toFloat } from "@/lib/utils"
import { formatDMY } from "@/lib/formatting"
import { escapeCsv } from "@/lib/csvUtils"

const HEADERS = [
  "Date",
  "Description",
  "Category Code",
  "Category Name",
  "Type",
  "Amount",
  "Payment Account",
  "Family",
  "Person",
  "Reference",
  "Notes",
  "Reconciled",
]

export type TransactionRow = {
  date: Date
  description: string // must be decrypted before passing in
  account: { code: string; name: string }
  type: string
  amount: { toString(): string } | number
  // Already-resolved PaymentAccount.name (FK, not an enum) — the caller
  // fetches the account and passes its display name straight through.
  paymentAccountName: string | null
  family: { name: string } | null
  person: { firstName: string; lastName: string } | null
  reference: string | null
  notes: string | null
  reconciled: boolean
}

export function generateTransactionCsv(rows: TransactionRow[]): string {
  const csvRows = rows.map((tx) => {
    const person = tx.person
      ? `${tx.person.firstName} ${tx.person.lastName}`
      : ""

    return [
      formatDMY(tx.date),
      tx.description,
      tx.account.code,
      tx.account.name,
      tx.type,
      toFloat(tx.amount).toFixed(2),
      tx.paymentAccountName ?? "",
      tx.family?.name ?? "",
      person,
      tx.reference ?? "",
      tx.notes ?? "",
      tx.reconciled ? "Yes" : "No",
    ]
      .map(escapeCsv)
      .join(",")
  })

  return [HEADERS.map(escapeCsv).join(","), ...csvRows].join("\n")
}
