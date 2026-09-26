import { AccountType, TransactionType } from "@/lib/generated/prisma/enums"
import type { PaymentAccountLite } from "@/lib/paymentAccounts"

// Radix Select can't have a SelectItem with an empty value, so callers use a
// non-empty sentinel ("NONE" by default) for "nothing selected" and map it
// back to "" here before it reaches form state.
export function fromSentinel(value: string, sentinel: string = "NONE"): string {
  return value === sentinel ? "" : value
}

// Same falsy-id-to-empty-string mapping used for accountId/familyId/personId
// initial select state: a real (truthy) id becomes its string form, anything
// falsy (including 0/null/undefined) becomes "".
export function idToStringOrEmpty(id: number | null | undefined): string {
  return id ? String(id) : ""
}

// New entries preselect the account flagged Default (an active BANK account);
// edits keep the row's own account (handled by the caller).
export function findDefaultBankAccountId(paymentAccounts: PaymentAccountLite[]): number | undefined {
  return paymentAccounts.find((a) => a.kind === "BANK" && a.isDefault && a.isActive)?.id
}

export function initialPaymentAccountId(
  paymentAccountId: number | null | undefined,
  defaultBankAccountId: number | undefined
): string {
  if (paymentAccountId) return String(paymentAccountId)
  return defaultBankAccountId != null ? String(defaultBankAccountId) : ""
}

// Edit mode must reflect the row's actual fundId — including genuinely null
// (unassigned) — never fall back to General, or saving an untouched select
// silently reassigns the transaction to General. The General default only
// applies when creating a brand-new transaction (no `transaction` prop).
export function initialFundId(
  isEditing: boolean,
  transactionFundId: number | null | undefined,
  generalFundId: number | undefined
): string {
  if (isEditing) return transactionFundId != null ? String(transactionFundId) : ""
  return generalFundId != null ? String(generalFundId) : ""
}

// Type is derived from the selected account, not stored. No account selected
// → fall back to the row's stored type (edit) or INCOME (new).
export function deriveTransactionType(
  selectedAccountType: AccountType | undefined,
  existingType: TransactionType | undefined
): TransactionType {
  if (selectedAccountType) {
    return selectedAccountType === AccountType.INCOME ? TransactionType.INCOME : TransactionType.EXPENSE
  }
  return existingType ?? TransactionType.INCOME
}

// Optimistic-concurrency token value, serialized across the RSC boundary as
// a Date or ISO string depending on Next's transport.
export function formatUpdatedAt(updatedAt: Date | string): string {
  return typeof updatedAt === "string" ? updatedAt : updatedAt.toISOString()
}

export function submitLabel(isPending: boolean, isEditing: boolean): string {
  if (isPending) return "Saving…"
  return isEditing ? "Save changes" : "Create transaction"
}
