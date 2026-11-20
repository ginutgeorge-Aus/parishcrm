"use server"

import { z } from "zod"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { actorId } from "@/lib/actor"
import { logger } from "@/lib/logger"
import { logAudit } from "@/lib/audit"
import { encrypt, safeDecrypt } from "@/lib/crypto"
import { canAccessAccounting, canViewAccounting } from "@/lib/roleGuard"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import {
  fyLabel,
  fyRange,
  formatReceiptNo,
  buildDgrPdfModel,
  type DgrLine,
  DGR_STATUS,
  DGR_SEND_STALE_MS,
  isDgrReceiptEditable,
  isDgrReceiptDeletable,
} from "@/lib/dgr"
import { renderDgrReceiptPdf } from "@/lib/pdf/DgrReceiptPdf"
import { sendDgrReceiptEmail, isAmbiguousDeliveryError } from "@/lib/email"
import { getChurchSettingsForReceipt } from "@/lib/churchSettings"
import { getReceiptSettings } from "@/lib/receiptSettings"
import { sumCents, centsToNumber, formatLongDate } from "@/lib/formatting"
import { isValidEmail, MIN_YEAR, MAX_YEAR, isP2002, isTwoDecimalMoney, isValidPgId, isRealCalendarDate } from "@/lib/validation"
import { featureGuard } from "@/lib/featureFlags"
import { serializableWrite } from "@/lib/serializableWrite"

const LIST_PATH = "/accounting/dgr-receipts"

// Bound the "All years" query so an absent/invalid `?fy` param can't trigger an
// unbounded full-table load. Ordered newest-first, so the cap drops only
// the oldest receipts — DgrReceipt grows ~1 row/donor/FY, so this is never hit in
// practice but keeps the query bounded by construction.
const LIST_ALL_YEARS_CAP = 1000

const DUP_RACE_ERROR = "A receipt for this donor and year was just created. Refresh the list and check before trying again."
const EDIT_RACE_ERROR = "This receipt is being sent or was sent"

const LineSchema = z.object({
  // Format AND real-calendar-date check: the regex alone lets 2025-02-30 through,
  // which normalises to 2 Mar and is then printed verbatim on the tax receipt
  // while silently sliding into a different month/FY.
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Line date must be YYYY-MM-DD")
    .refine(isRealCalendarDate, "Line date is not a real calendar date"),
  amount: z
    .number()
    .positive("Amount must be positive")
    .max(1_000_000)
    // Reject sub-cent precision — every other money field in the
    // codebase is restricted to 2 decimal places (MONEY_DECIMAL_RE).
    .refine(isTwoDecimalMoney, "Amount must have at most 2 decimal places"),
  method: z.string().min(1).max(50),
})

const FormSchema = z.object({
  personId: z.coerce.number().int().positive(),
  donorEmail: z.string().refine(isValidEmail, "Invalid email address"),
  fyEndYear: z.coerce.number().int().min(MIN_YEAR).max(MAX_YEAR),
})

type ParsedForm = {
  personId: number
  donorEmail: string
  fyEndYear: number
  lines: DgrLine[]
  totalAmount: string
}

/** Parse + validate the shared receipt form. Returns an error string on failure. */
function parseForm(formData: FormData): { data: ParsedForm } | { error: string } {
  const base = FormSchema.safeParse({
    personId: formData.get("personId"),
    donorEmail: formData.get("donorEmail"),
    fyEndYear: formData.get("fyEndYear"),
  })
  if (!base.success) return { error: base.error.issues[0].message }

  let rawLines: unknown
  try {
    const linesField = formData.get("lines")
    rawLines = JSON.parse(typeof linesField === "string" ? linesField : "")
  } catch {
    return { error: "Donation lines are invalid." }
  }
  const lines = z.array(LineSchema).min(1, "Add at least one donation line").max(500).safeParse(rawLines)
  if (!lines.success) return { error: lines.error.issues[0].message }

  // Every donation line must fall inside the receipt's financial year — the
  // PDF asserts "gifts received between 1 July … and 30 June …", so a line in
  // another FY produces a false ATO deductible-gift receipt. LineSchema
  // only checks the YYYY-MM-DD *format*; range is enforced here against
  // fyRange (both bounds UTC date-only, so a Jul-1 / Jun-30 gift is inclusive).
  const { from, to } = fyRange(base.data.fyEndYear)
  const outOfRange = lines.data.find((l) => {
    const d = new Date(`${l.date}T00:00:00.000Z`)
    return d < from || d > to
  })
  if (outOfRange)
    return {
      error: `Donation date ${outOfRange.date} is outside the receipt's financial year (${formatLongDate(from)} – ${formatLongDate(to)}).`,
    }

  // Sum in integer cents — never float `+` on money — so accumulated
  // IEEE-754 drift across up to 500 lines can't cross a rounding boundary.
  const totalAmount = centsToNumber(sumCents(lines.data.map((l) => l.amount))).toFixed(2)
  return {
    data: {
      personId: base.data.personId,
      donorEmail: base.data.donorEmail,
      fyEndYear: base.data.fyEndYear,
      lines: lines.data,
      totalAmount,
    },
  }
}

/** Create a DGR receipt. ADMIN/PASTOR only. */
export async function createDgrReceipt(
  _prev: { error: string } | undefined,
  formData: FormData
): Promise<{ error: string } | undefined> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const off = await featureGuard("dgrReceipts")
  if (off) return off
  const uid = actorId(session)

  const parsed = parseForm(formData)
  if ("error" in parsed) return parsed
  const { personId, donorEmail, fyEndYear, lines, totalAmount } = parsed.data

  const person = await prisma.person.findUnique({ where: { id: personId } })
  if (!person) return { error: "Selected donor no longer exists." }
  const donorName = `${person.firstName} ${person.lastName}`

  let created: { id: number } | null = null
  let receiptNo = ""
  const receipt = await getReceiptSettings()
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // The duplicate check and the insert run in one Serializable transaction:
      // a double click can no longer pass the check twice and insert two receipts.
      // The losing request gets P2034, and serializableWrite re-runs it against the
      // committed state, where the check finds the winner's row.
      const outcome = await serializableWrite(async (tx): Promise<{ row: { id: number }; rNo: string } | { error: string }> => {
        // One DGR receipt per donor per financial year — there is no supersede/amend
        // concept, so a second row is a double-claim risk. Block it; the
        // secretary edits or deletes the existing DRAFT instead.
        const dup = await tx.dgrReceipt.findFirst({
          where: { personId, fyEndYear },
          select: { receiptNo: true },
        })
        if (dup)
          return {
            error: `A DGR receipt (${dup.receiptNo}) already exists for ${donorName} for the ${fyEndYear} financial year. Edit or delete it instead of creating a duplicate.`,
          }
        const agg = await tx.dgrReceipt.aggregate({ where: { fyEndYear }, _max: { seq: true } })
        const seq = (agg._max.seq ?? 0) + 1
        const rNo = formatReceiptNo(fyEndYear, seq, receipt.numberPrefix)
        const row = await tx.dgrReceipt.create({
          data: {
            receiptNo: rNo,
            fyEndYear,
            seq,
            personId,
            donorName,
            donorEmail: encrypt(donorEmail),
            lines,
            totalAmount,
            status: DGR_STATUS.DRAFT,
            createdById: uid,
          },
        })
        return { row, rNo }
      }, { error: DUP_RACE_ERROR })
      if ("error" in outcome) return { error: outcome.error }
      created = outcome.row
      receiptNo = outcome.rNo
      break
    } catch (e) {
      if (isP2002(e) && attempt === 0) continue
      logger.error("createDgrReceipt failed", { message: e instanceof Error ? e.message : "unknown" })
      return { error: "Could not create the receipt. Please try again." }
    }
  }
  if (!created) return { error: "Could not create the receipt. Please try again." }

  await logAudit(uid, "DGR_RECEIPT_CREATED", "DgrReceipt", created.id, { receiptNo, fyEndYear, personId })
  revalidatePath(LIST_PATH)
  redirect(LIST_PATH)
}

/** Update a DGR receipt. ADMIN/PASTOR only. */
export async function updateDgrReceipt(
  id: number,
  _prev: { error: string } | undefined,
  formData: FormData
): Promise<{ error: string } | undefined> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const off = await featureGuard("dgrReceipts")
  if (off) return off
  if (!isValidPgId(id)) return { error: "Invalid ID" }
  const uid = actorId(session)

  const existing = await prisma.dgrReceipt.findUnique({ where: { id } })
  if (!existing) return { error: "Receipt not found." }
  // A SENT receipt is a legal document already delivered — frozen, and so is an
  // UNKNOWN one (may have been delivered). FAILED (definite failure) never reached
  // the donor. A SENDING row is editable only once its claim went stale (a
  // mid-send crash); a live send must not be reset to DRAFT under it.
  if (!isDgrReceiptEditable(existing.status, existing.sentAt)) {
    if (existing.status === DGR_STATUS.SENDING) return { error: "This receipt is being sent. Try again in a few minutes." }
    if (existing.status === DGR_STATUS.UNKNOWN)
      return { error: "This receipt may have been delivered and can no longer be edited." }
    return { error: "This receipt has been sent and can no longer be edited." }
  }

  const parsed = parseForm(formData)
  if ("error" in parsed) return parsed
  const { personId, donorEmail, fyEndYear, lines, totalAmount } = parsed.data

  // The financial year is immutable on edit — there is no re-year concept.
  // parseForm validated the lines against the SUBMITTED fyEndYear, so a crafted
  // edit submitting a different year would smuggle a next-FY gift into this
  // receipt while it keeps its original year. Reject the mismatch.
  if (fyEndYear !== existing.fyEndYear)
    return { error: "A receipt's financial year cannot be changed. Delete it and create a new one." }

  const person = await prisma.person.findUnique({ where: { id: personId } })
  if (!person) return { error: "Selected donor no longer exists." }
  const donorName = `${person.firstName} ${person.lastName}`

  // Re-pointing the receipt at a different donor must honour the same
  // one-receipt-per-donor-per-FY rule createDgrReceipt enforces —
  // otherwise editing a DRAFT/FAILED onto a donor who already has one for this
  // FY yields two sendable receipts. Exclude this row from the check.
  if (personId !== existing.personId) {
    const dup = await prisma.dgrReceipt.findFirst({
      where: { personId, fyEndYear: existing.fyEndYear, id: { not: id } },
      select: { receiptNo: true },
    })
    if (dup)
      return {
        error: `A DGR receipt (${dup.receiptNo}) already exists for ${donorName} for the ${existing.fyEndYear} financial year.`,
      }
  }

  // Status predicate in the write itself: a send that claimed the row after the
  // read above (DRAFT → SENDING) makes this match no row, so the edit can't
  // overwrite a receipt in flight or reset a delivered one to DRAFT.
  const staleBefore = new Date(Date.now() - DGR_SEND_STALE_MS)
  const res = await prisma.dgrReceipt.updateMany({
    where: {
      id,
      OR: [
        { status: { in: [DGR_STATUS.DRAFT, DGR_STATUS.FAILED] } },
        { status: DGR_STATUS.SENDING, OR: [{ sentAt: null }, { sentAt: { lt: staleBefore } }] },
      ],
    },
    // Editing a FAILED or stale SENDING receipt clears the failure state and the
    // claim time so it reads as ready-to-send again.
    data: {
      personId,
      donorName,
      donorEmail: encrypt(donorEmail),
      lines,
      totalAmount,
      status: DGR_STATUS.DRAFT,
      errorMessage: null,
      sentAt: null,
    },
  })
  if (res.count === 0) return { error: EDIT_RACE_ERROR }

  await logAudit(uid, "DGR_RECEIPT_UPDATED", "DgrReceipt", id, { receiptNo: existing.receiptNo })
  revalidatePath(LIST_PATH)
  redirect(LIST_PATH)
}

/** Delete a DGR receipt. ADMIN/PASTOR only. */
export async function deleteDgrReceipt(id: number): Promise<{ error: string } | { success: string }> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const off = await featureGuard("dgrReceipts")
  if (off) return off
  if (!isValidPgId(id)) return { error: "Invalid ID" }
  const uid = actorId(session)

  const existing = await prisma.dgrReceipt.findUnique({ where: { id } })
  if (!existing) return { error: "Receipt not found." }
  // Only DRAFT, or FAILED with a definite failure. SENDING and UNKNOWN may have
  // reached the donor: deleting them would free the number for the next receipt
  // and leave the donor holding a document the books no longer have.
  if (!isDgrReceiptDeletable(existing.status)) {
    if (existing.status === DGR_STATUS.SENT) return { error: "A sent receipt cannot be deleted." }
    if (existing.status === DGR_STATUS.SENDING) return { error: "This receipt is being sent and cannot be deleted." }
    return { error: "This receipt may have been delivered and cannot be deleted." }
  }

  // Same predicate in the write, so a send that claimed the row after the read can't be deleted under it.
  const res = await prisma.dgrReceipt.deleteMany({
    where: { id, status: { in: [DGR_STATUS.DRAFT, DGR_STATUS.FAILED] } },
  })
  if (res.count === 0) return { error: "This receipt is being sent or was sent and cannot be deleted." }
  await logAudit(uid, "DGR_RECEIPT_DELETED", "DgrReceipt", id, { receiptNo: existing.receiptNo })
  revalidatePath(LIST_PATH)
  return { success: "Receipt deleted." }
}

/** Email a DGR receipt to the donor. ADMIN/PASTOR only. */
export async function sendDgrReceipt(id: number): Promise<{ error: string } | { success: string }> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const off = await featureGuard("dgrReceipts")
  if (off) return off
  if (!isValidPgId(id)) return { error: "Invalid ID" }
  const uid = actorId(session)

  const row = await prisma.dgrReceipt.findUnique({ where: { id } })
  if (!row) return { error: "Receipt not found." }
  // a SENT receipt is a legal ATO tax receipt already delivered to the
  // donor — a double-click or retry must never re-email it or overwrite
  // sentAt/sentById. Same freeze rule as updateDgrReceipt/deleteDgrReceipt.
  if (row.status === DGR_STATUS.SENT) return { error: "This receipt has already been sent." }

  // Atomically claim the row BEFORE the slow render+email. Only a DRAFT/FAILED
  // row is claimable, plus UNKNOWN (possibly delivered): its content is frozen, so
  // a resend after staff check can only repeat the identical receipt; the conditional updateMany flips it to SENDING so a
  // concurrent double-click / parallel retry finds no claimable row — it can
  // neither re-email the donor nor let a losing failure overwrite the winner's
  // SENT with FAILED. Every finalize below is likewise guarded on `SENDING`, so
  // only this claimant writes the terminal state. A row wedged in
  // SENDING by a mid-send crash is recovered by editing it (resets to DRAFT) once
  // the claim time stored in sentAt is older than DGR_SEND_STALE_MS.
  // Read strict church settings BEFORE claiming the row: a strict read
  // rejects on a cold-cache/transient DB error, and if that happened after the
  // claim flipped the row to SENDING (outside the delivery try) the receipt would
  // wedge in SENDING and fail every future claim until an operator edits it.
  // Reading first means a transient failure aborts with the row still DRAFT/FAILED
  // and retryable.
  const churchRes = await getChurchSettingsForReceipt()
  if ("error" in churchRes) return { error: churchRes.error }
  const church = churchRes.church
  const receipt = await getReceiptSettings()
  const model = buildDgrPdfModel(
    {
      receiptNo: row.receiptNo,
      fyEndYear: row.fyEndYear,
      issueDate: row.createdAt,
      donorName: row.donorName,
      lines: row.lines as DgrLine[],
    },
    church,
    receipt
  )

  const claim = await prisma.dgrReceipt.updateMany({
    where: { id, status: { in: [DGR_STATUS.DRAFT, DGR_STATUS.FAILED, DGR_STATUS.UNKNOWN] } },
    data: { status: DGR_STATUS.SENDING, errorMessage: null, sentAt: new Date() },
  })
  if (claim.count === 0)
    return { error: "This receipt is already being sent or has already been sent." }

  try {
    const pdf = await renderDgrReceiptPdf(model)
    await sendDgrReceiptEmail(safeDecrypt(row.donorEmail), pdf, {
      receiptNo: row.receiptNo,
      fyLabel: fyLabel(row.fyEndYear),
      churchName: church.name,
      donorName: row.donorName,
      churchAbn: model.churchAbn,
      churchAddress: model.churchAddress,
      churchEmail: model.churchEmail,
      issueDate: model.issueDate,
      documentTitle: model.documentTitle,
      totalLabel: model.totalLabel,
      totalDonationsLabel: model.totalDonationsLabel,
      coveredPeriod: model.coveredPeriod,
    })
  } catch (e) {
    // Never log the raw error — SMTP messages can embed the recipient email.
    logger.error("sendDgrReceipt delivery failed", { receiptNo: row.receiptNo })
    if (isAmbiguousDeliveryError(e)) {
      // The provider may have accepted the mail before the connection dropped.
      // UNKNOWN is frozen like SENT (no edit, no delete), so the donor can never
      // end up with two different documents under one receipt number. sentAt
      // keeps the attempt time.
      const message = "Delivery status unknown: the receipt may have been delivered, check before resending."
      await prisma.dgrReceipt.updateMany({
        where: { id, status: DGR_STATUS.SENDING },
        data: { status: DGR_STATUS.UNKNOWN, errorMessage: message },
      })
      await logAudit(uid, "DGR_RECEIPT_FAILED", "DgrReceipt", id, { receiptNo: row.receiptNo, outcome: "unknown" })
      revalidatePath(LIST_PATH)
      return { error: message }
    }
    await prisma.dgrReceipt.updateMany({
      where: { id, status: DGR_STATUS.SENDING },
      data: { status: DGR_STATUS.FAILED, errorMessage: "Email delivery failed. Please try again.", sentAt: null },
    })
    await logAudit(uid, "DGR_RECEIPT_FAILED", "DgrReceipt", id, { receiptNo: row.receiptNo })
    revalidatePath(LIST_PATH)
    return { error: "Could not email the receipt. It has been marked failed." }
  }

  await prisma.dgrReceipt.updateMany({
    where: { id, status: DGR_STATUS.SENDING },
    data: { status: DGR_STATUS.SENT, sentAt: new Date(), sentById: uid, errorMessage: null },
  })
  await logAudit(uid, "DGR_RECEIPT_SENT", "DgrReceipt", id, { receiptNo: row.receiptNo })
  revalidatePath(LIST_PATH)
  return { success: "Receipt emailed." }
}

/**
 * Fetch+decrypt a single donor's email on demand, so the new-receipt page never has to ship the
 * whole congregation's plaintext emails to the client (#PII). Gated like every other
 * mutation-adjacent action — accounting editors only.
 */
export async function getDonorEmail(personId: number): Promise<{ email: string | null } | { error: string }> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const off = await featureGuard("dgrReceipts")
  if (off) return off
  if (!Number.isInteger(personId) || personId <= 0) return { error: "Invalid person." }
  const person = await prisma.person.findUnique({ where: { id: personId }, select: { email: true } })
  if (!person) return { error: "Person not found." }
  return { email: person.email ? safeDecrypt(person.email) : null }
}

export type DgrReceiptListRow = {
  id: number
  receiptNo: string
  fyLabel: string
  donorName: string
  total: number
  status: string
  sentAt: Date | null
}

/** List DGR receipts. Accounting viewers only. */
export async function listDgrReceipts(
  fyEndYear?: number
): Promise<DgrReceiptListRow[] | { error: string }> {
  const session = await auth()
  if (!canViewAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const off = await featureGuard("dgrReceipts")
  if (off) return off

  const rows = await prisma.dgrReceipt.findMany({
    where: fyEndYear ? { fyEndYear } : {},
    // A single-FY filter is naturally small; the all-years branch is capped so an
    // absent/invalid `?fy` param can't load the whole table.
    ...(fyEndYear ? {} : { take: LIST_ALL_YEARS_CAP }),
    orderBy: [{ fyEndYear: "desc" }, { seq: "desc" }],
    select: {
      id: true,
      receiptNo: true,
      fyEndYear: true,
      donorName: true,
      totalAmount: true,
      status: true,
      sentAt: true,
    },
  })

  return rows.map((r) => ({
    id: r.id,
    receiptNo: r.receiptNo,
    fyLabel: fyLabel(r.fyEndYear),
    donorName: r.donorName,
    total: Number(r.totalAmount),
    status: r.status,
    sentAt: r.sentAt,
  }))
}
