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
import { fyLabel, fyRange, formatReceiptNo, buildDgrPdfModel, type DgrLine } from "@/lib/dgr"
import { renderDgrReceiptPdf } from "@/lib/pdf/DgrReceiptPdf"
import { sendDgrReceiptEmail } from "@/lib/email"
import { getChurchSettingsForReceipt } from "@/lib/churchSettings"
import { getReceiptSettings } from "@/lib/receiptSettings"
import { sumCents, centsToNumber, formatLongDate } from "@/lib/formatting"
import { EMAIL_REGEX, MIN_YEAR, MAX_YEAR, isP2002, isTwoDecimalMoney, isValidPgId, isRealCalendarDate } from "@/lib/validation"

const LIST_PATH = "/accounting/dgr-receipts"

// Bound the "All years" query so an absent/invalid `?fy` param can't trigger an
// unbounded full-table load. Ordered newest-first, so the cap drops only
// the oldest receipts — DgrReceipt grows ~1 row/donor/FY, so this is never hit in
// practice but keeps the query bounded by construction.
const LIST_ALL_YEARS_CAP = 1000

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
  donorEmail: z.string().max(254).regex(EMAIL_REGEX, "Invalid email address"),
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
    rawLines = JSON.parse(String(formData.get("lines") ?? ""))
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

export async function createDgrReceipt(
  _prev: { error: string } | undefined,
  formData: FormData
): Promise<{ error: string } | undefined> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const uid = actorId(session)

  const parsed = parseForm(formData)
  if ("error" in parsed) return parsed
  const { personId, donorEmail, fyEndYear, lines, totalAmount } = parsed.data

  const person = await prisma.person.findUnique({ where: { id: personId } })
  if (!person) return { error: "Selected donor no longer exists." }
  const donorName = `${person.firstName} ${person.lastName}`

  // One DGR receipt per donor per financial year — there is no supersede/amend
  // concept, so a second row is a double-claim risk. Block it; the
  // secretary edits or deletes the existing DRAFT instead.
  const dup = await prisma.dgrReceipt.findFirst({
    where: { personId, fyEndYear },
    select: { receiptNo: true },
  })
  if (dup)
    return {
      error: `A DGR receipt (${dup.receiptNo}) already exists for ${donorName} for the ${fyEndYear} financial year. Edit or delete it instead of creating a duplicate.`,
    }

  let created: { id: number } | null = null
  let receiptNo = ""
  const receipt = await getReceiptSettings()
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const outcome = await prisma.$transaction(async (tx) => {
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
            status: "DRAFT",
            createdById: uid,
          },
        })
        return { row, rNo }
      })
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

export async function updateDgrReceipt(
  id: number,
  _prev: { error: string } | undefined,
  formData: FormData
): Promise<{ error: string } | undefined> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(id)) return { error: "Invalid ID" }
  const uid = actorId(session)

  const existing = await prisma.dgrReceipt.findUnique({ where: { id } })
  if (!existing) return { error: "Receipt not found." }
  // A SENT receipt is a legal document already delivered — frozen. FAILED never
  // reached the donor, and SENDING is a stuck/in-flight send reset to
  // DRAFT by this edit; both stay editable before (re)send.
  if (existing.status !== "DRAFT" && existing.status !== "FAILED" && existing.status !== "SENDING") {
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

  await prisma.dgrReceipt.update({
    where: { id },
    // Editing a FAILED receipt clears the failure state so it reads as ready-to-send again.
    data: { personId, donorName, donorEmail: encrypt(donorEmail), lines, totalAmount, status: "DRAFT", errorMessage: null },
  })

  await logAudit(uid, "DGR_RECEIPT_UPDATED", "DgrReceipt", id, { receiptNo: existing.receiptNo })
  revalidatePath(LIST_PATH)
  redirect(LIST_PATH)
}

export async function deleteDgrReceipt(id: number): Promise<{ error: string } | { success: string }> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(id)) return { error: "Invalid ID" }
  const uid = actorId(session)

  const existing = await prisma.dgrReceipt.findUnique({ where: { id } })
  if (!existing) return { error: "Receipt not found." }
  if (existing.status === "SENT") return { error: "A sent receipt cannot be deleted." }

  await prisma.dgrReceipt.delete({ where: { id } })
  await logAudit(uid, "DGR_RECEIPT_DELETED", "DgrReceipt", id, { receiptNo: existing.receiptNo })
  revalidatePath(LIST_PATH)
  return { success: "Receipt deleted." }
}

export async function sendDgrReceipt(id: number): Promise<{ error: string } | { success: string }> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(id)) return { error: "Invalid ID" }
  const uid = actorId(session)

  const row = await prisma.dgrReceipt.findUnique({ where: { id } })
  if (!row) return { error: "Receipt not found." }
  // a SENT receipt is a legal ATO tax receipt already delivered to the
  // donor — a double-click or retry must never re-email it or overwrite
  // sentAt/sentById. Same freeze rule as updateDgrReceipt/deleteDgrReceipt.
  if (row.status === "SENT") return { error: "This receipt has already been sent." }

  // Atomically claim the row BEFORE the slow render+email. Only a DRAFT/FAILED
  // row is claimable; the conditional updateMany flips it to SENDING so a
  // concurrent double-click / parallel retry finds no claimable row — it can
  // neither re-email the donor nor let a losing failure overwrite the winner's
  // SENT with FAILED. Every finalize below is likewise guarded on `SENDING`, so
  // only this claimant writes the terminal state. A row wedged in
  // SENDING by a mid-send crash is recovered by editing it (resets to DRAFT).
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
    where: { id, status: { in: ["DRAFT", "FAILED"] } },
    data: { status: "SENDING", errorMessage: null },
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
    await prisma.dgrReceipt.updateMany({
      where: { id, status: "SENDING" },
      data: { status: "FAILED", errorMessage: "Email delivery failed. Please try again." },
    })
    await logAudit(uid, "DGR_RECEIPT_FAILED", "DgrReceipt", id, { receiptNo: row.receiptNo })
    revalidatePath(LIST_PATH)
    return { error: "Could not email the receipt. It has been marked failed." }
  }

  await prisma.dgrReceipt.updateMany({
    where: { id, status: "SENDING" },
    data: { status: "SENT", sentAt: new Date(), sentById: uid, errorMessage: null },
  })
  await logAudit(uid, "DGR_RECEIPT_SENT", "DgrReceipt", id, { receiptNo: row.receiptNo })
  revalidatePath(LIST_PATH)
  return { success: "Receipt emailed." }
}

// Fetch+decrypt a single donor's email on demand, so the new-receipt page never
// has to ship the whole congregation's plaintext emails to the client (#PII). Gated
// like every other mutation-adjacent action — accounting editors only.
export async function getDonorEmail(personId: number): Promise<{ email: string | null } | { error: string }> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
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

export async function listDgrReceipts(
  fyEndYear?: number
): Promise<DgrReceiptListRow[] | { error: string }> {
  const session = await auth()
  if (!canViewAccounting(session?.user?.role)) return { error: "Unauthorized" }

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
