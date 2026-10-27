import type { ParsedRow } from "@/lib/anzParser"
import type { SplitLine } from "@/lib/bankSplit"

export type ReviewRow = ParsedRow & {
  accountId: number | null
  skip: boolean
  isDuplicate: boolean
  // Same date + amount + direction as an existing transaction but not an exact
  // dedup match (e.g. imported earlier from a PDF, now from OFX). Pre-skipped.
  isPossibleDuplicate?: boolean
  familyId: number | null
  personId: number | null
  fromPettyCash: boolean
  splits?: SplitLine[]
}
