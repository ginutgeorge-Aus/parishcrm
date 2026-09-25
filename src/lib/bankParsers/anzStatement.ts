import { parseAnzStatement } from "@/lib/anzParser"
import type { BankStatementParser } from "./types"

// ANZ Business Extra statement — the default/terminal adapter. `detect` always
// returns true so, listed last, it reproduces the old route behavior:
// "if it is not a Transaction Report, parse it as a statement."
export const anzStatementParser: BankStatementParser = {
  id: "anz-statement",
  detect: () => true,
  parse: (text) => parseAnzStatement(text),
}
