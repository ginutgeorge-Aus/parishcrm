import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { canAccessAccounting } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { getClientIp } from "@/lib/clientIp"
import { rateLimit } from "@/lib/rateLimit"
import { exceedsBodyLimit } from "@/lib/bodyLimit"
import { confirmBankImport } from "@/lib/bankImportConfirm"

// Thin transport wrapper: auth/role gate + per-user rate limit + body-size
// cap + parse, then delegate the full validation/insert pipeline to the reusable,
// unit-testable core in @/lib/bankImportConfirm, and log the audit trail.
export async function POST(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canAccessAccounting(session.user?.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  // The confirm step does the actual inserts (up to 1000 rows). Rate-limit it
  // separately from the upload step — a lower cap since each call is far more
  // expensive.
  if (!rateLimit(`import:bank:confirm:${actorId(session)}`, 5, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  if (exceedsBodyLimit(req, 4 * 1024 * 1024)) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 })
  }

  const userId = actorId(session)
  const ip = getClientIp(req)

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const result = await confirmBankImport(payload)
  if (!result.ok) {
    // A mid-batch DB fault can leave earlier rows already committed without a
    // rollback. Record the partial write so there is a forensic trail rather than
    // a false "total failure" with no audit entry at all.
    if (result.imported && result.imported > 0) {
      await logAudit(userId, "IMPORT_BANK_STATEMENT", "Transaction", undefined, {
        imported: result.imported,
        duplicates: result.duplicates ?? 0,
        partial: true,
      }, ip)
    } else {
      // A clean rejection (locked period, invalid/misattributed FK, bad
      // split, duplicate donor, inactive category) wrote nothing — but the
      // attempt to post into the financial ledger still needs a forensic trail
      //. result.error is a static validation message, never member PII.
      await logAudit(userId, "IMPORT_BANK_STATEMENT_REJECTED", "Transaction", undefined, {
        reason: result.error,
      }, ip)
    }
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  const { imported, skipped, duplicates } = result
  await logAudit(userId, "IMPORT_BANK_STATEMENT", "Transaction", undefined, { imported, skipped, duplicates }, ip)

  return NextResponse.json({ imported, skipped, duplicates })
}
