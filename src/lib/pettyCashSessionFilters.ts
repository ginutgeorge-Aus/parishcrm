import { PettyCashSessionStatus } from "@/lib/generated/prisma/enums"

export type PettyCashSearchParams = { status?: string; from?: string; to?: string; custodian?: string }

/**
 * Translate the petty-cash list URL params into a Prisma `where`. Pure — no DB —
 * so the param-validation edge cases are unit-testable.
 */
export function buildSessionWhere(sp: PettyCashSearchParams) {
  // Validate URL params before they reach Prisma — a crafted ?custodian=abc or
  // ?from=notadate would otherwise produce NaN / Invalid Date in the where
  // clause and either 500 or silently return wrong results.
  // Allowlist the status param before it reaches Prisma's enum cast — a crafted
  // ?status=FOO would otherwise throw PrismaClientValidationError → 500.
  const VALID_STATUSES = new Set<PettyCashSessionStatus>(["OPEN", "CLOSED"])
  const statusFilter =
    sp.status && VALID_STATUSES.has(sp.status as PettyCashSessionStatus)
      ? (sp.status as PettyCashSessionStatus)
      : undefined
  const custodianId = sp.custodian ? Number.parseInt(sp.custodian, 10) : undefined
  const fromDate = sp.from ? new Date(sp.from) : undefined
  const toDate = sp.to ? new Date(sp.to + "T23:59:59.999") : undefined
  const fromValid = fromDate && !Number.isNaN(fromDate.getTime())
  const toValid = toDate && !Number.isNaN(toDate.getTime())

  return {
    ...(statusFilter && { status: statusFilter }),
    ...(custodianId !== undefined && !Number.isNaN(custodianId) && { custodianId }),
    ...(fromValid || toValid
      ? {
          openedAt: {
            ...(fromValid && { gte: fromDate }),
            ...(toValid && { lte: toDate }),
          },
        }
      : {}),
  }
}
