import { safeDecrypt } from "@/lib/crypto"
import { ClearanceType, type UserRole } from "@/lib/generated/prisma/enums"
import { canManageClearances, canViewClearanceStatus } from "@/lib/roleGuard"
import { clearanceStatus, type ClearanceStatus } from "@/lib/clearanceStatus"
import { formatSydneyDate } from "@/lib/dates"
import { APP_LOCALE } from "@/lib/appConfig"

/** One row of the Safeguarding card as sent to the client. */
export type ClearanceRowView = {
  type: ClearanceType
  status: ClearanceStatus
  // Manager-only fields below are ABSENT (not null) for a VIEWER, so they never
  // reach the browser. See buildClearanceCard.
  clearanceId?: string
  /** ISO `updatedAt` the manager saw; round-tripped for optimistic concurrency. */
  updatedAt?: string
  number?: string | null
  expiresYmd?: string | null
  expiresLabel?: string | null
  hasDocument?: boolean
  documentName?: string | null
  verifiedLabel?: string | null
  verifiedByName?: string | null
  verificationNote?: string | null
}

/** Everything `PersonClearances` needs. */
export type ClearanceCardData = {
  personId: number
  canManage: boolean
  wwccVerifyUrl: string | null
  rows: ClearanceRowView[]
}

/**
 * The columns the person page selects (never `document`). Only the first four
 * are present for a VIEWER (see `clearanceSelectFor`); the rest are manager-only.
 */
export type ClearanceDbRow = {
  id: string
  type: ClearanceType
  expiresAt: Date | null
  verifiedAt: Date | null
  updatedAt?: Date
  number?: string | null
  documentName?: string | null
  documentType?: string | null
  verificationNote?: string | null
  verifiedBy?: { name: string } | null
}

/**
 * Prisma `select` for the person page's clearance query, by role: a non-manager
 * (VIEWER) only needs the status inputs, so number/note/filename/verifier are
 * never read from the DB for them. Never includes the `document` blob.
 * @param role the viewing user's role
 */
export function clearanceSelectFor(role: UserRole | undefined) {
  const status = { id: true, type: true, expiresAt: true, verifiedAt: true } as const
  if (!canManageClearances(role)) return status
  return {
    ...status,
    updatedAt: true,
    number: true,
    documentName: true,
    documentType: true,
    verificationNote: true,
    verifiedBy: { select: { name: true } },
  } as const
}

const TYPE_ORDER: ClearanceType[] = [ClearanceType.WWCC, ClearanceType.SAFE_MINISTRY]

/**
 * Build the role-filtered Safeguarding card. Decryption happens only AFTER the
 * role gate and only for managers; a VIEWER receives `{type, status}` per row
 * and nothing else (client props are serialised to the browser). Returns null
 * when the role may not see clearances at all, or when a VIEWER would see an
 * empty card (person has no ministry roles and no clearance rows).
 * @param args.today Sydney calendar date at UTC midnight (`sydneyToday()`)
 * @param args.ministryRoleCount `person.ministryRoles.length` (OSS-47)
 */
export function buildClearanceCard(args: {
  role: UserRole | undefined
  personId: number
  rows: ClearanceDbRow[]
  today: Date
  wwccVerifyUrl: string
  ministryRoleCount: number
}): ClearanceCardData | null {
  const { role, personId, rows, today, wwccVerifyUrl, ministryRoleCount } = args
  if (!canViewClearanceStatus(role)) return null
  const canManage = canManageClearances(role)
  if (!canManage && ministryRoleCount === 0 && rows.length === 0) return null

  const views = TYPE_ORDER.map((type): ClearanceRowView => {
    const row = rows.find((r) => r.type === type) ?? null
    const status = clearanceStatus(row, today)
    if (!canManage || !row) return { type, status }
    return {
      type,
      status,
      clearanceId: row.id,
      updatedAt: row.updatedAt?.toISOString(),
      number: row.number ? safeDecrypt(row.number) : null,
      expiresYmd: row.expiresAt ? row.expiresAt.toISOString().slice(0, 10) : null,
      expiresLabel: row.expiresAt ? row.expiresAt.toLocaleDateString(APP_LOCALE, { timeZone: "UTC" }) : null,
      hasDocument: row.documentType != null,
      documentName: row.documentName ? safeDecrypt(row.documentName) : null,
      verifiedLabel: row.verifiedAt ? formatSydneyDate(row.verifiedAt) : null,
      verifiedByName: row.verifiedBy?.name ?? null,
      verificationNote: row.verificationNote ? safeDecrypt(row.verificationNote) : null,
    }
  })
  return { personId, canManage, wwccVerifyUrl: canManage ? wwccVerifyUrl : null, rows: views }
}
