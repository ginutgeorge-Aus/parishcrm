import { NextRequest, NextResponse } from "next/server"
import { logger } from "@/lib/logger"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@/lib/generated/prisma/client"
import { parseCsv } from "@/lib/csv"
import { isAdmin } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { getClientIp } from "@/lib/clientIp"
import { encrypt, hmacEmail, hmacMobile } from "@/lib/crypto"
import { actorId } from "@/lib/actor"
import { rateLimit } from "@/lib/rateLimit"
import { exceedsBodyLimit } from "@/lib/bodyLimit"

// A 5 MB file can hold tens of thousands of rows — unbounded rows.length meant
// a huge import did per-row sequential DB round trips and risked a request
// timeout / partial import. Reject oversized files up front.
const MAX_IMPORT_ROWS = 5000

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!isAdmin(session.user?.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  if (!rateLimit(`import:families:${actorId(session)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  // Reject before formData() streams the whole multipart body into memory.
  // 5MB file budget + multipart/encoding overhead; file.size is re-checked below.
  if (exceedsBodyLimit(req, 6 * 1024 * 1024)) {
    return NextResponse.json({ error: "File too large (max 5 MB)" }, { status: 413 })
  }

  const formData = await req.formData()
  const file = formData.get("file") as File | null
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 })
  if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: "File too large (max 5 MB)" }, { status: 413 })

  const content = await file.text()
  const { rows, errors } = parseCsv(content)

  if (rows.length > MAX_IMPORT_ROWS) {
    logger.warn("CSV import rejected: row cap exceeded", { rows: rows.length, max: MAX_IMPORT_ROWS })
    return NextResponse.json(
      { error: `File has too many rows (max ${MAX_IMPORT_ROWS}). Split it into smaller files.` },
      { status: 413 }
    )
  }

  let imported = 0
  let skipped = 0
  const importErrors = [...errors]

  // Group rows by family name — parseCsv already inherits family fields across
  // a group, so the first row's family object is representative of the whole
  // group. Upsert each distinct family once instead of once per member.
  const familyRowIndexes = new Map<string, number[]>()
  for (let i = 0; i < rows.length; i++) {
    const name = rows[i].family.name
    const idxs = familyRowIndexes.get(name)
    if (idxs) idxs.push(i)
    else familyRowIndexes.set(name, [i])
  }

  const familyIdByName = new Map<string, number>()
  for (const [name, rowIdxs] of familyRowIndexes) {
    const { family } = rows[rowIdxs[0]]
    try {
      const upserted = await prisma.family.upsert({
        // exclude archived families from the match — Family.name is
        // globally unique, so scoping the lookup to archivedAt: null means an
        // archived "Smith" no longer matches. If an archived family already
        // holds the name, the create() below hits the unique constraint and
        // falls into the existing "duplicate record" row-error path instead
        // of silently resurrecting new members under a frozen, invisible family.
        where: { name: family.name, archivedAt: null },
        create: {
          name: family.name,
          memberNo: family.memberNo,
          address: family.address ? encrypt(family.address) : undefined,
          suburb: family.suburb ? encrypt(family.suburb) : undefined,
          state: family.state ? encrypt(family.state) : undefined,
          postcode: family.postcode ? encrypt(family.postcode) : undefined,
        },
        update: {},
      })
      familyIdByName.set(name, upserted.id)
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error"
      // Log the full error server-side for diagnosis; return a friendly,
      // PII-free reason to the client. Admin-only route, but raw Prisma
      // messages echo field values, so don't surface them.: the family
      // surname is PII too — log the CSV row range (enough to find the row),
      // never the name itself (matches's PERSON_* audit metadata, which
      // omits member PII for the same reason).
      logger.error("CSV import DB error (family)", { rows: rowIdxs.map((i) => i + 2), error: msg })
      let detail = "record could not be saved"
      if (msg.includes("Unique constraint") && msg.includes("memberNo")) detail = "member number already in use"
      else if (msg.includes("Unique constraint")) detail = "duplicate record"
      for (const idx of rowIdxs) {
        const { person } = rows[idx]
        importErrors.push({ row: idx + 2, message: `${person.firstName} ${person.lastName}: ${detail}` })
      }
    }
  }

  // Rows whose family failed to upsert already got a row error above and are
  // dropped here (no familyId to attach a person to).
  const resolvedRows = rows
    .map((row, idx) => ({ row, idx, familyId: familyIdByName.get(row.family.name) }))
    .filter((r): r is { row: (typeof rows)[number]; idx: number; familyId: number } => r.familyId !== undefined)

  // Batch existence check across every (familyId, firstName, lastName) tuple —
  // replaces the old per-row findUnique. Re-import never overwrites an
  // existing person, so a match is a skip, not an import.
  const existingKeys = new Set<string>()
  if (resolvedRows.length > 0) {
    const existing = await prisma.person.findMany({
      where: {
        OR: resolvedRows.map((r) => ({
          familyId: r.familyId,
          firstName: r.row.person.firstName,
          lastName: r.row.person.lastName,
        })),
      },
      select: { familyId: true, firstName: true, lastName: true },
    })
    for (const p of existing) existingKeys.add(`${p.familyId}|${p.firstName}|${p.lastName}`)
  }

  const createData: Prisma.PersonCreateManyInput[] = []
  const createMeta: Array<{ rowNum: number; firstName: string; lastName: string }> = []
  const seenInBatch = new Set<string>()
  for (const { row, idx, familyId } of resolvedRows) {
    const { person } = row
    const key = `${familyId}|${person.firstName}|${person.lastName}`
    if (existingKeys.has(key) || seenInBatch.has(key)) {
      skipped++
      continue
    }
    seenInBatch.add(key)
    createData.push({
      familyId,
      firstName: person.firstName,
      lastName: person.lastName,
      dateOfBirth: person.dateOfBirth ? encrypt(person.dateOfBirth.toISOString().slice(0, 10)) : undefined,
      gender: person.gender,
      role: person.role,
      classification: person.classification,
      email: person.email ? encrypt(person.email) : undefined,
      emailHash: person.email ? hmacEmail(person.email) : undefined, // blind index
      mobile: person.mobile ? encrypt(person.mobile) : undefined,
      mobileHash: person.mobile ? hmacMobile(person.mobile) : undefined, // blind index (mirrors emailHash)
      consentUpdatedAt: new Date(), // match the normal create path
    })
    createMeta.push({ rowNum: idx + 2, firstName: person.firstName, lastName: person.lastName })
  }

  if (createData.length > 0) {
    try {
      const result = await prisma.person.createMany({ data: createData, skipDuplicates: true })
      imported = result.count
      // skipDuplicates silently drops any row that still collided on a unique
      // constraint (e.g. a concurrent import) — count those as skipped too.
      skipped += createData.length - result.count
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error"
      logger.error("CSV import DB error (person batch)", { error: msg })
      for (const meta of createMeta) {
        importErrors.push({ row: meta.rowNum, message: `${meta.firstName} ${meta.lastName}: record could not be saved` })
      }
    }
  }

  const ip = getClientIp(req)
  await logAudit(actorId(session), "IMPORT_CSV", "Family", undefined, { imported, skipped }, ip)

  return NextResponse.json({ imported, skipped, errors: importErrors })
}
