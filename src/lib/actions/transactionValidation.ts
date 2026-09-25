import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { MONEY_DECIMAL_RE } from "@/lib/validation"

export const TransactionSchema = z.object({
  date: z
    .string()
    .min(1, "Date is required")
    .transform((v) => new Date(v))
    // Zod does not validate transform output, so a malformed string ("foo",
    // "2026-99-01") yields an Invalid Date that would reach Prisma and throw an
    // unhandled 500 on the DateTime column. Reject it here.
    .refine((d) => !isNaN(d.getTime()), "Invalid date"),
  description: z.string().min(1, "Description is required").max(1000),
  accountId: z.string().min(1, "Category is required").transform((v) => Number(v)),
  type: z.enum(["INCOME", "EXPENSE"]),
  amount: z
    .string()
    .min(1, "Amount is required")
    .max(15)
    // Keep the amount as a validated string and pass it straight to the Decimal
    // column — parseFloat would round-trip through binary float and store IEEE-754
    // artifacts (e.g. 10.99 → 10.989999…), corrupting balance/reconciliation math.
    // Same pattern as reconciliation.ts and petty-cash openingBalance.
    .regex(MONEY_DECIMAL_RE, "Amount must be positive")
    .refine((v) => parseFloat(v) > 0, "Amount must be positive")
    // The 15-char cap is not a magnitude bound — "1000000000.00" passes it yet
    // overflows the Decimal(10,2) column and 500s at Prisma. Bound it like
    // reconciliation.ts's closingBalance.
    .refine((v) => parseFloat(v) <= 99_999_999.99, "Amount too large"),
  // CASH-kind accounts excluded (enforced in transaction.ts's
  // validatePaymentAccount): PETTY_CASH ledger rows are created only by the
  // petty-cash actions (mirrored, FK-linked). A manual entry against the cash
  // account would be invisible to sessions yet counted in petty-cash report
  // aggregates.
  paymentAccountId: z.coerce.number().int().positive(),
  familyId: z.string().optional().transform((v) => (v && v !== "" ? Number(v) : null)),
  personId: z.string().optional().transform((v) => (v && v !== "" ? Number(v) : null)),
  reference: z.string().max(500).optional().transform((v) => v?.trim() || null),
  notes: z.string().max(1000).optional().transform((v) => v?.trim() || null),
  fundId: z.string().optional().transform((v) => (v && v !== "" ? Number(v) : null)),
  reconciled: z.string().optional().transform((v) => v === "on"),
  // Likely-duplicate confirmation: set by the "Post anyway" resubmit
  // when createTransaction has already warned about a matching prior row.
  // Never persisted — stripped out of `rest` before the Prisma create call.
  confirmDuplicate: z.string().optional().transform((v) => v === "true"),
})

// Verify client-supplied family/person FKs exist (existence only — no archivedAt
// filter, so editing a historical transaction whose family was later archived
// still succeeds). Returns an error message, or null if valid/absent.
export async function validateParties(
  familyId: number | null,
  personId: number | null
): Promise<string | null> {
  if (familyId !== null) {
    const fam = await prisma.family.findUnique({ where: { id: familyId }, select: { id: true } })
    if (!fam) return "Invalid family"
  }
  if (personId !== null) {
    const per = await prisma.person.findUnique({ where: { id: personId }, select: { id: true, familyId: true } })
    if (!per) return "Invalid person"
    // Guard attribution: a person must belong to the linked family, else the
    // giving ledger credits family A from a member of family B.
    if (familyId !== null && per.familyId !== familyId) {
      return "Person does not belong to the selected family"
    }
  }
  return null
}
