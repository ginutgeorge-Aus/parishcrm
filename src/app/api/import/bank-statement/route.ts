import { NextResponse } from "next/server"
import { logger } from "@/lib/logger"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { contentKeyFromBankRef } from "@/lib/anzParser"
import { parseWithRegistry } from "@/lib/bankParsers/registry"
import { canAccessAccounting } from "@/lib/roleGuard"
import { extractText } from "unpdf"
import { actorId } from "@/lib/actor"
import { rateLimit } from "@/lib/rateLimit"
import { exceedsBodyLimit } from "@/lib/bodyLimit"

// Cap the number of parsed rows before the dedup scan / per-row confirm inserts —
// same resource-exhaustion class the families CSV import guards. A
// 50MB PDF can parse to thousands of rows. Aligned with the confirm route's
// `BodySchema.max(1000)` so a parse can never produce more rows than confirm will
// accept — mirrors the families route's up-front MAX_IMPORT_ROWS reject.
const MAX_IMPORT_ROWS = 1000

export async function POST(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canAccessAccounting(session.user?.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  if (!rateLimit(`import:bank:${actorId(session)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  // Reject before formData() streams the whole multipart body into memory.
  // 50MB file budget + multipart/encoding overhead; file.size is re-checked below.
  if (exceedsBodyLimit(req, 55 * 1024 * 1024)) {
    return NextResponse.json({ error: "File too large (max 50MB)" }, { status: 413 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }
  const file = formData.get("file")
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 })
  }

  if (file.size > 50 * 1024 * 1024) {
    return NextResponse.json({ error: "File too large (max 50MB)" }, { status: 413 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())

  // Reject non-PDF uploads early. file.type is client-supplied and trivially
  // spoofed, so the %PDF magic header is authoritative — a file claiming
  // application/pdf without the real header no longer slips through.
  // Scan the first 1KB rather than offset 0 only: the PDF spec permits leading
  // bytes (whitespace/BOM) before %PDF, so an exact-offset check false-rejects
  // otherwise-valid PDFs.
  const hasPdfMagic = buffer.subarray(0, 1024).toString("latin1").includes("%PDF")
  if (!hasPdfMagic) {
    return NextResponse.json({ error: "File must be a PDF" }, { status: 400 })
  }

  let text: string
  try {
    const { text: pages } = await extractText(new Uint8Array(buffer), { mergePages: false })
    text = pages.join("\n")
  } catch (e) {
    logger.error("PDF parse failed", { error: e instanceof Error ? e.message : String(e) })
    return NextResponse.json({ error: "Failed to read PDF" }, { status: 400 })
  }

  // Auto-detect format: the registry tries each adapter's detect() in order and
  // parses with the first match (ANZ Transaction Report, else ANZ statement).
  const result = parseWithRegistry(text)

  // Parser errors embed raw statement lines (payees = member names). Container
  // logs are PII-readable by anyone with log access, so log only the count —
  // never the raw error text. Client gets the same count summary.
  if (result.errors.length > 0) {
    logger.warn("ANZ parse errors", { count: result.errors.length })
  }
  const clientErrors =
    result.errors.length > 0
      ? [`${result.errors.length} statement block${result.errors.length === 1 ? "" : "s"} could not be parsed and ${result.errors.length === 1 ? "was" : "were"} skipped`]
      : []

  if (result.rows.length === 0 && result.errors.length > 0) {
    return NextResponse.json({ error: "Could not parse any transactions from this statement" }, { status: 400 })
  }

  if (result.rows.length > MAX_IMPORT_ROWS) {
    logger.warn("Bank import rejected: row cap exceeded", { rows: result.rows.length, max: MAX_IMPORT_ROWS })
    return NextResponse.json(
      { error: `This statement has too many transactions (max ${MAX_IMPORT_ROWS}). Import a shorter period.` },
      { status: 413 }
    )
  }

  // Exact-ref matches (same-format re-import) plus a cross-format content-key match
  // over the import's date window: a transaction imported once as a Statement and
  // again as a Transaction Report has different exact bankRefs but the same content
  // key, so it must still be flagged as a duplicate for the review UI to auto-skip
  //. Content-key matching is only against pre-existing DB rows, so two
  // genuinely-identical lines in this upload are not falsely flagged against each
  // other.
  const bankRefs = result.rows.map((r) => r.bankRef)
  const importTimes = result.rows.map((r) => new Date(r.date).getTime()).filter((n) => !Number.isNaN(n))
  const DAY_MS = 24 * 60 * 60 * 1000
  const existing = await prisma.transaction.findMany({
    where: {
      OR: [
        { bankRef: { in: bankRefs } },
        ...(importTimes.length > 0
          ? [
              {
                date: { gte: new Date(Math.min(...importTimes) - DAY_MS), lte: new Date(Math.max(...importTimes) + DAY_MS) },
                bankRef: { not: null },
              },
            ]
          : []),
      ],
    },
    select: { bankRef: true },
  })
  const existingRefs = new Set(existing.map((t) => t.bankRef))
  const existingContentKeys = new Set<string>()
  for (const t of existing) {
    const key = t.bankRef ? contentKeyFromBankRef(t.bankRef) : null
    if (key) existingContentKeys.add(key)
  }
  const duplicateBankRefs = result.rows
    .filter((r) => existingRefs.has(r.bankRef) || existingContentKeys.has(r.dedupKey))
    .map((r) => r.bankRef)

  return NextResponse.json({
    rows: result.rows,
    duplicateBankRefs,
    period: result.period,
    accountNumber: result.accountNumber,
    errors: clientErrors,
  })
}
