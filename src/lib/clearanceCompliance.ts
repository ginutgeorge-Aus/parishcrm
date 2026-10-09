import { prisma } from "@/lib/prisma"
import { safeDecrypt } from "@/lib/crypto"
import { ClearanceType, type MinistryRole } from "@/lib/generated/prisma/enums"
import { clearanceStatus, EXPIRING_WINDOW_DAYS, type ClearanceStatus } from "@/lib/clearanceStatus"
import { safeDobDate } from "@/lib/formatting"
import {
  COMPLIANCE_FILTERS, FILTER_STATUS, dmy, type ComplianceFilter, type WwccBatchRow,
} from "@/lib/clearanceComplianceView"

/**
 * Compliance queries shared by the /people/clearances page, the CSV export and
 * the monthly digest. A person is "required" to hold both clearance types when
 * they carry at least one ministry role; a person with no role who nonetheless
 * has a clearance on file is listed too, but an absent type is then simply
 * not required (`status: null`) rather than MISSING.
 *
 * The WWC number is never put on a row here (only `hasNumber`); the batch
 * loader below is the single place that decrypts it.
 */

/** Rows decrypted/listed per request; one past it is fetched to detect truncation. */
export const COMPLIANCE_CAP = 2000

export type ComplianceCell = {
  status: ClearanceStatus | null // null = not required and none on file
  clearanceId: string | null
  expiresAt: Date | null
  verifiedAt: Date | null
  hasNumber: boolean
}

export type ComplianceRow = {
  personId: number
  firstName: string
  lastName: string
  familyName: string
  ministryRoles: MinistryRole[]
  wwcc: ComplianceCell
  safeMinistry: ComplianceCell
}

/** The shape `loadComplianceRows` selects from Prisma (no document bytes). */
export type CompliancePerson = {
  id: number
  firstName: string
  lastName: string
  ministryRoles: MinistryRole[]
  family: { name: string }
  clearances: {
    id: string
    type: ClearanceType
    number: string | null
    expiresAt: Date | null
    verifiedAt: Date | null
  }[]
}

/**
 * Builds one list row from a person and their clearances, computing each
 * cell's status as of `today` (a Sydney calendar date at UTC midnight).
 */
export function toComplianceRow(p: CompliancePerson, today: Date): ComplianceRow {
  const required = p.ministryRoles.length > 0
  const cell = (type: ClearanceType): ComplianceCell => {
    const c = p.clearances.find((x) => x.type === type)
    if (!c) {
      return { status: required ? "MISSING" : null, clearanceId: null, expiresAt: null, verifiedAt: null, hasNumber: false }
    }
    return {
      status: clearanceStatus(c, today),
      clearanceId: c.id,
      expiresAt: c.expiresAt,
      verifiedAt: c.verifiedAt,
      hasNumber: c.number !== null,
    }
  }
  return {
    personId: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    familyName: p.family.name,
    ministryRoles: p.ministryRoles,
    wwcc: cell(ClearanceType.WWCC),
    safeMinistry: cell(ClearanceType.SAFE_MINISTRY),
  }
}

/** The (non-null) statuses of a row's two cells. */
export function rowStatuses(row: ComplianceRow): ClearanceStatus[] {
  return [row.wwcc.status, row.safeMinistry.status].filter((s): s is ClearanceStatus => s !== null)
}

/** True when either cell has the status the filter stands for. */
export function matchesFilter(row: ComplianceRow, f: ComplianceFilter): boolean {
  return rowStatuses(row).includes(FILTER_STATUS[f])
}

/** `rows` unchanged for no filter, otherwise only the matching rows. */
export function filterRows(rows: ComplianceRow[], f: ComplianceFilter | null): ComplianceRow[] {
  return f ? rows.filter((r) => matchesFilter(r, f)) : rows
}

export type BucketEntry = { personId: number; name: string; types: ClearanceType[] }
export type ComplianceBuckets = Record<ComplianceFilter, BucketEntry[]>

/**
 * Groups rows into the digest buckets (expired / expiring / missing /
 * unverified). A person appears once per bucket with the clearance type(s)
 * that put them there, so two problems on one person show in two buckets.
 */
export function bucketCompliance(rows: ComplianceRow[]): ComplianceBuckets {
  const buckets: ComplianceBuckets = { expired: [], expiring: [], missing: [], unverified: [] }
  for (const row of rows) {
    const cells: [ClearanceType, ComplianceCell][] = [
      [ClearanceType.WWCC, row.wwcc],
      [ClearanceType.SAFE_MINISTRY, row.safeMinistry],
    ]
    for (const bucket of COMPLIANCE_FILTERS) {
      const types = cells.filter(([, c]) => c.status === FILTER_STATUS[bucket]).map(([t]) => t)
      if (types.length) buckets[bucket].push({ personId: row.personId, name: `${row.firstName} ${row.lastName}`, types })
    }
  }
  return buckets
}

/** True when no bucket has anyone in it (the digest is skipped). */
export function bucketsEmpty(b: ComplianceBuckets): boolean {
  return COMPLIANCE_FILTERS.every((k) => b[k].length === 0)
}

/** Distinct people across all buckets. */
export function countFlaggedPeople(b: ComplianceBuckets): number {
  return new Set(COMPLIANCE_FILTERS.flatMap((k) => b[k].map((e) => e.personId))).size
}

/**
 * Loads every active person with a ministry role or any clearance, ordered by
 * surname, as list rows. `truncated` is true when more than COMPLIANCE_CAP
 * people matched (rows then holds the first COMPLIANCE_CAP).
 */
export async function loadComplianceRows(today: Date): Promise<{ rows: ComplianceRow[]; truncated: boolean }> {
  const people = await prisma.person.findMany({
    where: {
      archivedAt: null,
      OR: [{ ministryRoles: { isEmpty: false } }, { clearances: { some: {} } }],
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: COMPLIANCE_CAP + 1,
    select: {
      id: true, firstName: true, lastName: true, ministryRoles: true,
      family: { select: { name: true } },
      clearances: { select: { id: true, type: true, number: true, expiresAt: true, verifiedAt: true } },
    },
  })
  return {
    rows: people.slice(0, COMPLIANCE_CAP).map((p) => toComplianceRow(p, today)),
    truncated: people.length > COMPLIANCE_CAP,
  }
}

// What cryptoCore.safeDecrypt returns when a value cannot be decrypted.
const DECRYPT_FAILED = "[decryption error]"

/** Decrypts a stored value; null when absent or when decryption fails. */
function decryptOrNull(value: string | null): string | null {
  if (!value) return null
  const plain = safeDecrypt(value)
  return plain === DECRYPT_FAILED ? null : plain
}

/**
 * WWCCs that need checking on the OCG portal: never verified (verifiedAt null)
 * and not yet expired (UNVERIFIED, or EXPIRING while unverified), with the
 * three portal fields decrypted (surname, DOB dd/mm/yyyy, WWC number). This is
 * the only loader that returns a WWC number or DOB; callers must be gated by
 * `canManageClearances`. A DOB or number that is absent or cannot be decrypted
 * comes back null so the UI flags the row instead of offering junk to paste.
 */
export async function loadWwccVerifyBatch(today: Date): Promise<WwccBatchRow[]> {
  const clearances = await prisma.personClearance.findMany({
    where: { type: ClearanceType.WWCC, person: { archivedAt: null } },
    orderBy: [{ person: { lastName: "asc" } }, { person: { firstName: "asc" } }],
    take: COMPLIANCE_CAP,
    select: {
      id: true, number: true, expiresAt: true, verifiedAt: true,
      person: { select: { id: true, firstName: true, lastName: true, dateOfBirth: true } },
    },
  })
  const out: WwccBatchRow[] = []
  for (const c of clearances) {
    const status = clearanceStatus(c, today)
    // Verified rows are done until renewal (a changed number/expiry clears verification); expired ones cannot pass the portal.
    if (c.verifiedAt || status === "EXPIRED") continue
    // clearanceStatus gives UNVERIFIED precedence over EXPIRING; the batch list still
    // wants to show that an unverified WWCC is also lapsing soon.
    const daysLeft = c.expiresAt ? Math.floor((c.expiresAt.getTime() - today.getTime()) / 86_400_000) : null
    const batchStatus: WwccBatchRow["status"] = daysLeft !== null && daysLeft <= EXPIRING_WINDOW_DAYS ? "EXPIRING" : "UNVERIFIED"
    const dobPlain = decryptOrNull(c.person.dateOfBirth)
    out.push({
      clearanceId: c.id,
      personId: c.person.id,
      familyName: c.person.lastName,
      givenName: c.person.firstName,
      dobDmy: dmy(dobPlain ? safeDobDate(dobPlain) : null),
      number: decryptOrNull(c.number),
      status: batchStatus,
      expiresDmy: dmy(c.expiresAt),
      verifiedDmy: dmy(c.verifiedAt),
    })
  }
  return out
}
