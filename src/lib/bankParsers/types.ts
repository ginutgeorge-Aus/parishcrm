import type { ParseResult } from "@/lib/anzParser"

// Re-export ParseResult (the parser return shape) so the registry and future
// adapters import it from here. ParsedRow is not re-exported — its only
// consumers import it directly from `@/lib/anzParser`, unchanged (no churn).
export type { ParseResult }

export interface BankStatementParser {
  id: string
  detect(text: string): boolean
  parse(text: string): ParseResult
}
