import { NextResponse } from "next/server"
import { logger } from "@/lib/logger"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { contentKeyFromBankRef, type ParsedRow, type ParseResult } from "@/lib/anzParser"
import { parseWithRegistry } from "@/lib/bankParsers/registry"
import { detectOfx, parseOfx } from "@/lib/bankParsers/ofx"
import { detectQif, parseQif, type QifDateOrder } from "@/lib/bankParsers/qif"
import { findPossibleDuplicates } from "@/lib/bankPossibleDuplicate"
import { suggestPaymentAccountId } from "@/lib/bankAccountMap"
import { IMPORT_SOURCES, isImportSource, type ImportSource } from "@/lib/importSources"
import { canAccessAccounting } from "@/lib/roleGuard"
import { extractText } from "unpdf"
import { actorId } from "@/lib/actor"
import { rateLimit } from "@/lib/rateLimit"
import { exceedsBodyLimit } from "@/lib/bodyLimit"
import { isDemoMode, DEMO_IMPORT_MAX_BYTES } from "@/lib/demoMode"
import { featureNotFound } from "@/lib/featureFlags"

// Cap the number of parsed rows before the dedup scan / per-row confirm inserts —
// same resource-exhaustion class the families CSV import guards. A
// 50MB PDF can parse to thousands of rows. Aligned with the confirm route's
// `BodySchema.max(1000)` so a parse can never produce more rows than confirm will
// accept — mirrors the families route's up-front MAX_IMPORT_ROWS reject.
const MAX_IMPORT_ROWS = 1000

// Tagged (not `{error}|{data}`) so the `ok` discriminant narrows cleanly —
// a plain `{error}|{data}` union lets TS add `error?: undefined` to the
// success branch, which breaks `"error" in x` narrowing.
type RouteFailure = { ok: false; error: string; status: number }

type UploadFields = { source: ImportSource; paymentAccountId: number | null; dateOrder: QifDateOrder | undefined }

/**
 * Validate + read the uploaded multipart file: body-size caps (checked before
 * AND after formData() streams the body), file-field presence, and the
 * source/paymentAccountId/dateOrder fields. `source` defaults to "anz" so a
 * client that predates the wizard keeps working.
 */
async function readUpload(req: Request): Promise<RouteFailure | { ok: true; buffer: Buffer; fields: UploadFields }> {
  // Reject before formData() streams the whole multipart body into memory.
  // 50MB file budget + multipart/encoding overhead; file.size is re-checked below.
  if (isDemoMode() && exceedsBodyLimit(req, DEMO_IMPORT_MAX_BYTES + 16 * 1024)) {
    return { ok: false, error: "Demo imports are limited to 200 KB", status: 413 }
  }
  if (exceedsBodyLimit(req, 55 * 1024 * 1024)) {
    return { ok: false, error: "File too large (max 50MB)", status: 413 }
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return { ok: false, error: "Invalid request body", status: 400 }
  }
  const file = formData.get("file")
  if (!(file instanceof File)) {
    return { ok: false, error: "No file provided", status: 400 }
  }

  if (file.size > 50 * 1024 * 1024) {
    return { ok: false, error: "File too large (max 50MB)", status: 413 }
  }

  if (isDemoMode() && file.size > DEMO_IMPORT_MAX_BYTES) {
    return { ok: false, error: "Demo imports are limited to 200 KB", status: 413 }
  }

  const buffer = Buffer.from(await file.arrayBuffer())

  const rawSource = formData.get("source") ?? "anz"
  if (!isImportSource(rawSource)) return { ok: false, error: "Unknown import source", status: 400 }
  const rawAccount = formData.get("paymentAccountId")
  const accountNum = typeof rawAccount === "string" && /^\d{1,9}$/.test(rawAccount) ? Number.parseInt(rawAccount, 10) : null
  const rawOrder = formData.get("dateOrder")
  const dateOrder = rawOrder === "DMY" || rawOrder === "MDY" ? rawOrder : undefined

  return { ok: true, buffer, fields: { source: rawSource, paymentAccountId: accountNum && accountNum > 0 ? accountNum : null, dateOrder } }
}

/**
 * True when the buffer carries the %PDF magic header. file.type is
 * client-supplied and trivially spoofed, so the header is authoritative. Scans
 * the first 1KB rather than offset 0 only: the PDF spec permits leading bytes
 * (whitespace/BOM) before %PDF, so an exact-offset check false-rejects
 * otherwise-valid PDFs.
 */
function hasPdfMagic(buffer: Buffer): boolean {
  return buffer.subarray(0, 1024).toString("latin1").includes("%PDF")
}

/** Decode a text export: strict UTF-8, falling back to latin1 (older bank exports); BOM stripped. */
function decodeText(buffer: Buffer): string {
  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer)
  } catch {
    text = buffer.toString("latin1")
  }
  return text.replace(/^\uFEFF/, "")
}

/** Name the format a text export actually looks like, for a helpful mismatch error. */
function sniffTextSource(text: string): ImportSource | null {
  if (detectOfx(text)) return "ofx"
  if (detectQif(text)) return "qif"
  return null
}

async function extractPdfText(buffer: Buffer): Promise<RouteFailure | { ok: true; text: string }> {
  try {
    const { text: pages } = await extractText(new Uint8Array(buffer), { mergePages: false })
    return { ok: true, text: pages.join("\n") }
  } catch (e) {
    logger.error("PDF parse failed", { error: e instanceof Error ? e.message : String(e) })
    return { ok: false, error: "Failed to read PDF", status: 400 }
  }
}

/** Parse the upload according to its declared source; the PDF path is the pre-wizard behaviour verbatim. */
async function parseUpload(buffer: Buffer, fields: UploadFields): Promise<RouteFailure | { ok: true; result: ParseResult }> {
  if (fields.source === "anz") {
    if (!hasPdfMagic(buffer)) return { ok: false, error: "File must be a PDF", status: 400 }
    const textResult = await extractPdfText(buffer)
    if (!textResult.ok) return textResult
    // Auto-detect ANZ shape: the registry tries each adapter's detect() in order
    // (Transaction Report, else statement).
    return { ok: true, result: parseWithRegistry(textResult.text) }
  }

  if (hasPdfMagic(buffer)) return { ok: false, error: "This is a PDF — go back and choose ANZ statement", status: 400 }
  const text = decodeText(buffer)
  const actual = sniffTextSource(text)
  if (actual !== fields.source) {
    const msg = actual
      ? `This looks like a ${IMPORT_SOURCES[actual].label} file — go back and choose ${IMPORT_SOURCES[actual].label}`
      : `This doesn't look like a ${IMPORT_SOURCES[fields.source].label} file`
    return { ok: false, error: msg, status: 400 }
  }
  if (fields.source === "ofx") return { ok: true, result: parseOfx(text) }

  if (fields.paymentAccountId === null) {
    return { ok: false, error: "Choose the bank account before uploading a QIF file", status: 400 }
  }
  return { ok: true, result: parseQif(text, { accountKey: `PA${fields.paymentAccountId}`, dateOrder: fields.dateOrder }) }
}

// Checks the parsed statement is postable (some rows, not over the row cap)
// and builds the client-facing error summary. Parser errors embed raw
// statement lines (payees = member names): container logs are PII-readable
// by anyone with log access, so only the count is logged — never the raw
// error text. The client gets the same count summary.
function validateParsedStatement(result: ParseResult): RouteFailure | { ok: true; clientErrors: string[] } {
  if (result.fatalError) return { ok: false, error: result.fatalError, status: 400 }
  if (result.errors.length > 0) {
    logger.warn("Bank import parse errors", { count: result.errors.length })
  }
  const clientErrors =
    result.errors.length > 0
      ? [`${result.errors.length} statement block${result.errors.length === 1 ? "" : "s"} could not be parsed and ${result.errors.length === 1 ? "was" : "were"} skipped`]
      : []

  if (result.rows.length === 0 && result.errors.length > 0) {
    return { ok: false, error: "Could not parse any transactions from this statement", status: 400 }
  }
  if (result.rows.length === 0) {
    return { ok: false, error: "No transactions found in this file", status: 400 }
  }

  if (result.rows.length > MAX_IMPORT_ROWS) {
    logger.warn("Bank import rejected: row cap exceeded", { rows: result.rows.length, max: MAX_IMPORT_ROWS })
    return {
      ok: false,
      error: `This statement has too many transactions (max ${MAX_IMPORT_ROWS}). Import a shorter period.`,
      status: 413,
    }
  }

  return { ok: true, clientErrors }
}

// Exact-ref matches (same-format re-import) plus a cross-format content-key match
// over the import's date window: a transaction imported once as a Statement and
// again as a Transaction Report has different exact bankRefs but the same content
// key, so it must still be flagged as a duplicate for the review UI to auto-skip
//. Content-key matching is only against pre-existing DB rows, so two
// genuinely-identical lines in this upload are not falsely flagged against each
// other.
async function findDuplicateBankRefs(rows: ParsedRow[]): Promise<string[]> {
  const bankRefs = rows.map((r) => r.bankRef)
  const importTimes = rows.map((r) => new Date(r.date).getTime()).filter((n) => !Number.isNaN(n))
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
  return rows
    .filter((r) => existingRefs.has(r.bankRef) || existingContentKeys.has(r.dedupKey))
    .map((r) => r.bankRef)
}

/**
 * Soft cross-format check over the import's date window: any existing
 * transaction (bank-imported or manual) with the same date + amount + direction
 * that the exact/content-key pass did not already catch. The UI pre-unticks
 * these rows with a "possible duplicate" chip; commit-time dedup is unchanged.
 */
async function findPossibleDuplicateBankRefs(rows: ParsedRow[], exact: string[]): Promise<string[]> {
  const importTimes = rows.map((r) => new Date(r.date).getTime()).filter((n) => !Number.isNaN(n))
  if (importTimes.length === 0) return []
  const existing = await prisma.transaction.findMany({
    where: { date: { gte: new Date(Math.min(...importTimes)), lte: new Date(Math.max(...importTimes)) } },
    select: { date: true, amount: true, type: true },
  })
  return findPossibleDuplicates(rows, new Set(exact), existing)
}

/** POST /api/import/bank-statement — parse an ANZ PDF, OFX/QFX or QIF upload for review (no save). ADMIN/PASTOR only. */
export async function POST(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canAccessAccounting(session.user?.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const off = await featureNotFound("bankImport")
  if (off) return off

  if (!rateLimit(`import:bank:${actorId(session)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const upload = await readUpload(req)
  if (!upload.ok) return NextResponse.json({ error: upload.error }, { status: upload.status })

  const parsed = await parseUpload(upload.buffer, upload.fields)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status })
  const result = parsed.result

  const validated = validateParsedStatement(result)
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: validated.status })

  const duplicateBankRefs = await findDuplicateBankRefs(result.rows)
  const [possibleDuplicateBankRefs, suggestedPaymentAccountId] = await Promise.all([
    findPossibleDuplicateBankRefs(result.rows, duplicateBankRefs),
    suggestPaymentAccountId(result.accountNumber),
  ])

  return NextResponse.json({
    rows: result.rows,
    duplicateBankRefs,
    possibleDuplicateBankRefs,
    period: result.period,
    accountNumber: result.accountNumber,
    suggestedPaymentAccountId,
    dateFormatAmbiguous: result.dateFormatAmbiguous === true,
    errors: validated.clientErrors,
  })
}
