import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { MONEY_DECIMAL_RE } from "@/lib/validation"
import { dateOnlyFormField, optionalPgIdFormField, pgIdFormField } from "@/lib/formFieldSchemas"

/**
 * Positive money amount string for a Decimal(10,2) column: regex-validated (never
 * parsed to a float for storage), > 0, <= 99,999,999.99, at most 15 chars. Shared by
 * manual entry and the bank-import confirm schema so the two cannot drift.
 */
export const moneyAmountSchema = z
  .string()
  .min(1, "Amount is required")
  .max(15)
  // Keep the amount as a validated string and pass it straight to the Decimal
  // column — parseFloat would round-trip through binary float and store IEEE-754
  // artifacts (e.g. 10.99 → 10.989999…), corrupting balance/reconciliation math.
  // Same pattern as reconciliation.ts and petty-cash openingBalance.
  .regex(MONEY_DECIMAL_RE, "Amount must be positive")
  .refine((v) => Number.parseFloat(v) > 0, "Amount must be positive")
  // The 15-char cap is not a magnitude bound — "1000000000.00" passes it yet
  // overflows the Decimal(10,2) column and 500s at Prisma. Bound it like
  // reconciliation.ts's closingBalance.
  .refine((v) => Number.parseFloat(v) <= 99_999_999.99, "Amount too large")

export const TransactionSchema = z.object({
  // Real YYYY-MM-DD within MIN_YEAR..MAX_YEAR; "foo", "2026-99-01" and year 275760 are rejected (AUD-3-19).
  date: dateOnlyFormField("Invalid date"),
  description: z.string().min(1, "Description is required").max(1000),
  accountId: pgIdFormField("Category is required"),
  type: z.enum(["INCOME", "EXPENSE"]),
  amount: moneyAmountSchema,
  // CASH-kind accounts excluded (enforced in transaction.ts's
  // validatePaymentAccount): PETTY_CASH ledger rows are created only by the
  // petty-cash actions (mirrored, FK-linked). A manual entry against the cash
  // account would be invisible to sessions yet counted in petty-cash report
  // aggregates.
  paymentAccountId: pgIdFormField("Invalid payment account"),
  familyId: optionalPgIdFormField("Invalid family", null),
  personId: optionalPgIdFormField("Invalid person", null),
  reference: z.string().max(500).optional().transform((v) => v?.trim() || null),
  notes: z.string().max(1000).optional().transform((v) => v?.trim() || null),
  fundId: optionalPgIdFormField("Invalid fund", null),
  reconciled: z.string().optional().transform((v) => v === "on"),
  // Likely-duplicate confirmation: set by the "Post anyway" resubmit
  // when createTransaction has already warned about a matching prior row.
  // Never persisted — stripped out of `rest` before the Prisma create call.
  confirmDuplicate: z.string().optional().transform((v) => v === "true"),
})

/**
 * Verify client-supplied family/person FKs exist and are not archived. On edit, pass the party already on
 * the row as `keep` so a historical transaction whose family or person was later archived stays editable.
 * Returns an error message, or null if valid/absent.
 */
export async function validateParties(
  familyId: number | null,
  personId: number | null,
  keep?: { familyId: number | null; personId: number | null }
): Promise<string | null> {
  if (familyId !== null) {
    const fam = await prisma.family.findUnique({ where: { id: familyId }, select: { id: true, archivedAt: true } })
    if (!fam || (fam.archivedAt && familyId !== keep?.familyId)) return "Invalid family"
  }
  if (personId !== null) {
    const per = await prisma.person.findUnique({ where: { id: personId }, select: { id: true, familyId: true, archivedAt: true } })
    if (!per || (per.archivedAt && personId !== keep?.personId)) return "Invalid person"
    // Guard attribution: a person must belong to the linked family, else the
    // giving ledger credits family A from a member of family B.
    if (familyId !== null && per.familyId !== familyId) {
      return "Person does not belong to the selected family"
    }
  }
  return null
}
