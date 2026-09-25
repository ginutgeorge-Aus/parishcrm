import type { BankStatementParser, ParseResult } from "./types"
import { anzReportParser } from "./anzReport"
import { anzStatementParser } from "./anzStatement"

export type { BankStatementParser } from "./types"

// Ordered most-specific → fallback. First adapter whose detect(text) is true wins.
export const PARSERS: BankStatementParser[] = [anzReportParser, anzStatementParser]

export function selectParser(
  text: string,
  parsers: BankStatementParser[] = PARSERS,
): BankStatementParser | null {
  return parsers.find((p) => p.detect(text)) ?? null
}

export function parseWithRegistry(
  text: string,
  parsers: BankStatementParser[] = PARSERS,
): ParseResult {
  const parser = selectParser(text, parsers)
  if (!parser) {
    return { rows: [], period: { from: "", to: "" }, accountNumber: "", errors: ["Unrecognized statement format"] }
  }
  return parser.parse(text)
}
