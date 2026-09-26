import { NextRequest, NextResponse } from "next/server"
import { logger } from "@/lib/logger"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { parseCsv } from "@/lib/csv"
import type { CheckResult } from "@/lib/csv"
import { isAdmin } from "@/lib/roleGuard"
import { actorId } from "@/lib/actor"
import { rateLimit } from "@/lib/rateLimit"
import { exceedsBodyLimit } from "@/lib/bodyLimit"

// Same cap as the sibling import route: a 5 MB CSV of minimal-width rows
// parses into ~10^5 rows, which would build enormous `IN (...)` args on the two
// duplicate-lookup findMany below. Reject up front.
const MAX_IMPORT_ROWS = 5000

// Every CSV row's family.memberNo, if present, mapped to every CSV family name
// that carries it. A plain memberNo→name map kept only the last row, so when
// the CSV had the same memberNo on two different families only one got
// flagged and the other slipped through to a silent unique-constraint failure
// at import. Use a Map, not a plain object: a memberNo like "constructor"/
// "__proto__" would collide with Object.prototype keys and either crash
// (`.add` on an inherited function) or silently mis-key.
function buildMemberNoToFamilyNames(rows: CheckResult["rows"]): Map<string, Set<string>> {
  const memberNoToFamilyNames = new Map<string, Set<string>>()
  for (const r of rows) {
    if (!r.family.memberNo) continue
    let names = memberNoToFamilyNames.get(r.family.memberNo)
    if (!names) {
      names = new Set()
      memberNoToFamilyNames.set(r.family.memberNo, names)
    }
    names.add(r.family.name)
  }
  return memberNoToFamilyNames
}

// (a) memberNo already exists in the DB → flag every CSV family sharing it.
// (b) the same memberNo appears on 2+ distinct family names within the CSV
// itself → all but one would collide on import. Flag them all.
function collectDuplicateFamilyNames(
  matchedByName: Array<{ name: string }>,
  matchedByMemberNo: Array<{ name: string; memberNo: string | null }>,
  memberNoToFamilyNames: Map<string, Set<string>>,
): Set<string> {
  const duplicateSet = new Set<string>()
  for (const f of matchedByName) duplicateSet.add(f.name)

  for (const f of matchedByMemberNo) {
    const names = f.memberNo ? memberNoToFamilyNames.get(f.memberNo) : undefined
    if (names) for (const name of names) duplicateSet.add(name)
  }
  for (const names of memberNoToFamilyNames.values()) {
    if (names.size > 1) for (const name of names) duplicateSet.add(name)
  }
  return duplicateSet
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!isAdmin(session.user?.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  // Own bucket, distinct from the commit route — check and import are
  // separate workflow steps (ImportClient.tsx re-checks after fixing errors),
  // and sharing one budget let repeated /check calls starve the actual import.
  // Same pattern as the bank-statement pair's `import:bank` vs `import:bank:confirm`.
  if (!rateLimit(`import:families:check:${actorId(session)}`, 10, 60_000)) {
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
    logger.warn("CSV check rejected: row cap exceeded", { rows: rows.length, max: MAX_IMPORT_ROWS })
    return NextResponse.json(
      { error: `File has too many rows (max ${MAX_IMPORT_ROWS}). Split it into smaller files.` },
      { status: 413 }
    )
  }

  const allFamilyNames = Array.from(new Set(rows.map((r) => r.family.name)))
  const memberNos = rows
    .map((r) => r.family.memberNo)
    .filter((m): m is string => !!m)
  const uniqueMemberNos = Array.from(new Set(memberNos))

  const [matchedByName, matchedByMemberNo] = await Promise.all([
    allFamilyNames.length > 0
      ? prisma.family.findMany({ where: { name: { in: allFamilyNames } }, select: { name: true } })
      : Promise.resolve([]),
    uniqueMemberNos.length > 0
      ? prisma.family.findMany({ where: { memberNo: { in: uniqueMemberNos } }, select: { name: true, memberNo: true } })
      : Promise.resolve([]),
  ])

  const memberNoToFamilyNames = buildMemberNoToFamilyNames(rows)
  const duplicateSet = collectDuplicateFamilyNames(matchedByName, matchedByMemberNo, memberNoToFamilyNames)

  const result: CheckResult = {
    rows,
    duplicates: Array.from(duplicateSet),
    errors,
  }

  return NextResponse.json(result)
}
