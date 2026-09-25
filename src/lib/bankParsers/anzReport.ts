import { parseAnzTransactionReport } from "@/lib/anzParser"
import type { BankStatementParser } from "./types"

// ANZ Transaction Report: "Transaction Report" header + Withdrawals/Deposits
// columns, but no statement-style "TOTALS AT END OF PERIOD" footer. This detect
// is the sniff previously inline in route.ts, moved verbatim.
export const anzReportParser: BankStatementParser = {
  id: "anz-report",
  detect: (text) =>
    /Transaction Report/i.test(text.slice(0, 200)) &&
    /Withdrawals/.test(text) &&
    /Deposits/.test(text) &&
    !/TOTALS AT END OF PERIOD/.test(text),
  parse: (text) => parseAnzTransactionReport(text),
}
