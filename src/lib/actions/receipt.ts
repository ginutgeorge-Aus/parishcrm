"use server"

import { auth } from "@/auth"
import { logger } from "@/lib/logger"
import { actorId } from "@/lib/actor"
import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { sendReceiptEmail } from "@/lib/email"
import { canAccessAccounting, canViewAccounting } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { encrypt, decrypt, safeDecrypt } from "@/lib/crypto"
import { format } from "date-fns"
import { endOfDayUTC } from "@/lib/dates"
import { toCents, centsToNumber } from "@/lib/formatting"
import type { ReceiptData } from "@/lib/emails/ReceiptEmail"
import { getChurchSettingsForReceipt } from "@/lib/churchSettings"
import { isValidEmail } from "@/lib/validation"

// Double-click debounce window: a repeat send of the same receipt to the
// same recipient inside this window is treated as a no-op so a donor never gets
// two identical tax-receipt emails.
const RECEIPT_DEBOUNCE_MS = 10_000

const MAX_RECEIPT_BATCH_SIZE = 200
const RECEIPT_FETCH_CAP = 500

export type SingleReceiptResult = { success: string } | { error: string }
export type BatchReceiptResult =
  | { sent: number; failed: number; errors: { transactionId: number; error: string }[] }
  | { error: string }

export type TransactionForReceipt = {
  id: number
  date: Date
  description: string
  account: string
  amount: number
  familyName: string | null
  personName: string | null
  defaultEmail: string | null
  lastSentAt: Date | null
}

export type FetchResult = { transactions: TransactionForReceipt[] } | { error: string }

function buildReceiptData(
  tx: {
    id: number
    date: Date
    description: string
    amount: { toString(): string }
    type: string
    account: { code: string; name: string }
    family: { name: string } | null
    person: { firstName: string; lastName: string } | null
    reference: string | null
    notes: string | null
  },
  church: { name: string; address: string; abn: string; email: string }
): ReceiptData {
  return {
    transactionId: tx.id,
    date: format(tx.date, "dd/MM/yyyy"),
    description: safeDecrypt(tx.description),
    // Format from exact integer cents, never a parseFloat round-trip of the
    // Decimal. centsToNumber(...) of a small integer is exact, so the
    // 2dp display is byte-identical to the stored value.
    amount: `$${centsToNumber(toCents(tx.amount)).toFixed(2)}`,
    type: tx.type as "INCOME" | "EXPENSE",
    account: `${tx.account.code} — ${tx.account.name}`,
    reference: tx.reference ?? undefined,
    // notes is unencrypted for manually-keyed rows but encrypted for
    // bank-import rows — safeDecrypt is a no-op on plaintext.
    notes: tx.notes ? safeDecrypt(tx.notes) : undefined,
    familyName: tx.family?.name ?? undefined,
    personName: tx.person ? `${tx.person.firstName} ${tx.person.lastName}` : undefined,
    churchName: church.name,
    churchAddress: church.address,
    churchAbn: church.abn,
    churchEmail: church.email,
  }
}

export async function sendSingleReceipt(
  transactionId: number,
  toEmail: string
): Promise<SingleReceiptResult> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }

  if (!isValidEmail(toEmail)) return { error: "Invalid email address" }

  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: {
      account: { select: { code: true, name: true } },
      family: { select: { name: true, people: { select: { email: true, emailConsent: true } } } },
      person: { select: { firstName: true, lastName: true, emailConsent: true } },
    },
  })
  if (!tx) return { error: "Transaction not found" }

  const sentById = actorId(session)

  // Consent gate: mirrors sendBatchReceipts — an opted-out recipient must
  // not receive a receipt regardless of which send path (single vs batch) is used.
  const consentBlocked = "Recipient has not consented to email receipts"
  if (tx.person && tx.person.emailConsent === false) {
    return { error: consentBlocked }
  }
  if (!tx.person && tx.family) {
    const member = tx.family.people?.find((p) => {
      if (!p.email) return false
      try {
        return decrypt(p.email).toLowerCase() === toEmail.toLowerCase()
      } catch {
        // Corrupt/legacy member ciphertext can't be compared — treat as no-match.
        return false
      }
    })
    if (member && member.emailConsent === false) {
      return { error: consentBlocked }
    }
  }

  const churchRes = await getChurchSettingsForReceipt()
  if ("error" in churchRes) return { error: churchRes.error }
  const church = churchRes.church
  const data = buildReceiptData(tx, church)

  // Debounce: if an identical SUCCESS send to this recipient landed in the
  // last few seconds, skip the resend. sentTo is encrypted with a random IV, so it
  // can't be matched with a WHERE clause — decrypt the small recent set and compare.
  //
  // Residual race (best-effort): this check-then-send is NOT atomic — two
  // concurrent requests for the same transaction+recipient can both pass this
  // check before either has written a SUCCESS row, and both deliver the email.
  // Running the check as late as possible (right before the send, after the
  // church-settings/data-build work above) minimizes — but cannot eliminate —
  // that window. A real fix needs a deterministic recipient key (e.g. an HMAC
  // hash column with a DB `@@unique`) so the database itself rejects the
  // duplicate; that's a schema migration and is intentionally out of scope here.
  const recent = await prisma.receiptSend.findMany({
    where: { transactionId, status: "SUCCESS", sentAt: { gte: new Date(Date.now() - RECEIPT_DEBOUNCE_MS) } },
    select: { sentTo: true },
  })
  if (recent.some((r) => safeDecrypt(r.sentTo).toLowerCase() === toEmail.toLowerCase())) {
    return { success: `Receipt already sent to ${toEmail}` }
  }

  try {
    await sendReceiptEmail(toEmail, data)
  } catch {
    // Never log the raw error — nodemailer/SMTP messages embed the recipient
    // address. Log a stable message + the non-PII transactionId only.
    logger.error("[receipt] sendSingleReceipt failed", { transactionId })
    await prisma.receiptSend.create({
      data: { transactionId, sentTo: encrypt(toEmail), sentById, status: "FAILED", errorMessage: "Email delivery failed" },
    })
    return { error: "Email delivery failed" }
  }

  // The email is already delivered at this point — a failure persisting the
  // audit row must never be reported as a send failure: the donor
  // already has the receipt, so returning an error here would make an operator
  // resend a receipt that was never actually missing.
  try {
    await prisma.receiptSend.create({
      data: { transactionId, sentTo: encrypt(toEmail), sentById, status: "SUCCESS" },
    })
  } catch (err) {
    logger.error("[receipt] failed to persist SUCCESS receiptSend after delivery", {
      transactionId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
  revalidatePath(`/accounting/transactions/${transactionId}`)
  return { success: `Receipt sent to ${toEmail}` }
}

export async function sendBatchReceipts(
  rows: { transactionId: number; toEmail: string }[]
): Promise<BatchReceiptResult> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  if (rows.length > MAX_RECEIPT_BATCH_SIZE) return { error: `Max ${MAX_RECEIPT_BATCH_SIZE} per batch` }

  const sentById = actorId(session)
  const churchRes = await getChurchSettingsForReceipt()
  if ("error" in churchRes) return { error: churchRes.error }
  const church = churchRes.church
  let sent = 0
  let failed = 0
  const errors: { transactionId: number; error: string }[] = []

  // Fetch every referenced transaction in ONE query, then index by id.
  const ids = Array.from(new Set(rows.map((r) => r.transactionId)))
  const txList = await prisma.transaction.findMany({
    where: { id: { in: ids } },
    include: {
      account: { select: { code: true, name: true } },
      family: { select: { name: true, people: { select: { email: true, emailConsent: true } } } },
      person: { select: { firstName: true, lastName: true, emailConsent: true } },
    },
  })
  const txById = new Map(txList.map((tx) => [tx.id, tx]))

  // Dedup guard: a batch containing the same (transactionId, toEmail)
  // pair more than once must send once, not once per row. The first occurrence
  // of a pair gets full normal treatment (invalid/not-found/consent/send); any
  // exact repeat is reported as a skipped duplicate instead of re-sent.
  const seenPairs = new Set<string>()

  for (const row of rows) {
    const dedupeKey = `${row.transactionId}:${row.toEmail.toLowerCase()}`
    if (seenPairs.has(dedupeKey)) {
      failed++
      errors.push({ transactionId: row.transactionId, error: "Duplicate recipient — already processed in this batch" })
      continue
    }
    seenPairs.add(dedupeKey)

    if (!isValidEmail(row.toEmail)) {
      failed++
      errors.push({ transactionId: row.transactionId, error: "Invalid email address" })
      continue
    }
    const tx = txById.get(row.transactionId)
    if (!tx) {
      failed++
      errors.push({ transactionId: row.transactionId, error: "Transaction not found" })
      continue
    }
    // Consent gate. A consent block is reported (not silently dropped) so the
    // operator sees why a receipt wasn't sent and it isn't mistaken for a
    // successful send.
    const consentBlocked = "Recipient has not consented to email receipts"
    // Person-linked: skip if that person opted out.
    if (tx.person && tx.person.emailConsent === false) {
      failed++
      errors.push({ transactionId: row.transactionId, error: consentBlocked })
      continue
    }
    // Family-linked (no person): skip if the recipient matches a member who opted out.
    if (!tx.person && tx.family) {
      const member = tx.family.people?.find((p) => {
        if (!p.email) return false
        try {
          return decrypt(p.email).toLowerCase() === row.toEmail.toLowerCase()
        } catch {
          // Corrupt/legacy member ciphertext can't be compared — treat as no-match
          // rather than throwing out of the loop and aborting the whole batch.
          return false
        }
      })
      if (member && member.emailConsent === false) {
        failed++
        errors.push({ transactionId: row.transactionId, error: consentBlocked })
        continue
      }
    }
    const data = buildReceiptData(tx, church)
    // Write the ReceiptSend row immediately after each attempt — not in a single
    // createMany after the loop. An interrupted batch would otherwise leave
    // already-delivered emails with no record (lastSentAt null), so a re-send
    // would show them unsent and double-send receipts to members.
    try {
      await sendReceiptEmail(row.toEmail, data)
    } catch {
      // Never log the raw error — nodemailer/SMTP messages embed the recipient
      // address. transactionId is non-PII.
      logger.error("[receipt] sendBatchReceipts failed", { transactionId: row.transactionId })
      try {
        await prisma.receiptSend.create({
          data: {
            transactionId: row.transactionId,
            sentTo: encrypt(row.toEmail),
            sentById,
            status: "FAILED",
            errorMessage: "Email delivery failed",
          },
        })
      } catch (writeErr) {
        // A DB error persisting the FAILED row must not abort the remaining rows
        // or skip the final logAudit — log and carry on.
        logger.error("[receipt] failed to persist FAILED receiptSend", { transactionId: row.transactionId, error: writeErr instanceof Error ? writeErr.message : String(writeErr) })
      }
      failed++
      errors.push({ transactionId: row.transactionId, error: "Email delivery failed" })
      continue
    }

    // The email is already delivered at this point — a failure persisting the
    // audit row must never be reported as a send failure: the recipient
    // already has the receipt, so counting this row as failed would make an
    // operator resend a receipt that was never actually missing.
    try {
      await prisma.receiptSend.create({
        data: { transactionId: row.transactionId, sentTo: encrypt(row.toEmail), sentById, status: "SUCCESS" },
      })
    } catch (err) {
      logger.error("[receipt] failed to persist SUCCESS receiptSend after delivery", {
        transactionId: row.transactionId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
    sent++
  }

  await logAudit(sentById, "RECEIPT_BATCH_SENT", "Transaction", undefined, { count: rows.length, sent, failed })
  revalidatePath("/accounting/receipt-audit")
  return { sent, failed, errors }
}

export async function fetchTransactionsForReceipt(
  from: string,
  to: string,
  accountId?: number
): Promise<FetchResult> {
  // Read path — AUDITOR is allowed (matches the canViewAccounting page guard on
  // /accounting/receipt-audit). The actual send actions stay canAccessAccounting
  // (ADMIN/PASTOR). Previously this read used the stricter mutate-guard.
  const session = await auth()
  if (!canViewAccounting(session?.user?.role)) return { error: "Unauthorized" }

  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) return { error: "Invalid date range" }
  const fromDate = new Date(from)
  const toDate = new Date(to)
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()))
    return { error: "Invalid date range" }

  const rows = await prisma.transaction.findMany({
    where: {
      date: { gte: fromDate, lte: endOfDayUTC(toDate) },
      ...(accountId ? { accountId } : {}),
    },
    orderBy: { date: "desc" },
    take: RECEIPT_FETCH_CAP,
    include: {
      account: { select: { code: true, name: true } },
      family: {
        select: {
          name: true,
          people: {
            select: { email: true },
            where: { email: { not: null }, emailConsent: true },
            take: 1,
          },
        },
      },
      person: { select: { firstName: true, lastName: true, email: true } },
      receiptSends: { orderBy: { sentAt: "desc" }, take: 1, select: { sentAt: true } },
    },
  })

  const transactions: TransactionForReceipt[] = rows.map((tx) => ({
    id: tx.id,
    date: tx.date,
    description: safeDecrypt(tx.description),
    account: `${tx.account.code} — ${tx.account.name}`,
    amount: centsToNumber(toCents(tx.amount)),
    familyName: tx.family?.name ?? null,
    personName: tx.person ? `${tx.person.firstName} ${tx.person.lastName}` : null,
    defaultEmail:
      (tx.person?.email ? safeDecrypt(tx.person.email) : null) ??
      (tx.family?.people[0]?.email ? safeDecrypt(tx.family.people[0].email) : null) ??
      null,
    lastSentAt: tx.receiptSends[0]?.sentAt ?? null,
  }))

  return { transactions }
}
