import type { ParsedRow } from "@/lib/anzParser"
import type { SplitLine } from "@/lib/bankSplit"

export type ReviewRow = ParsedRow & {
  accountId: number | null
  skip: boolean
  isDuplicate: boolean
  familyId: number | null
  personId: number | null
  fromPettyCash: boolean
  splits?: SplitLine[]
}
