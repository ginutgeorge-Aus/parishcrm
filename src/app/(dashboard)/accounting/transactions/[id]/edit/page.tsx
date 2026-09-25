import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { canAccessAccounting } from "@/lib/roleGuard"
import { updateTransaction } from "@/lib/actions/transaction"
import { getActiveFunds } from "@/lib/actions/fund"
import { getAccountingLockDate, isDateLocked } from "@/lib/accountingLock"
import { safeDecrypt } from "@/lib/crypto"
import { getPaymentAccounts } from "@/lib/paymentAccounts"
import { TransactionForm } from "@/components/accounting/TransactionForm"

export default async function EditTransactionPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) redirect("/")

  const txId = parseInt(params.id, 10)
  if (isNaN(txId) || txId <= 0 || txId > 2147483647) notFound()

  const [transaction, accounts, families, funds, paymentAccounts] = await Promise.all([
    prisma.transaction.findUnique({
      where: { id: txId },
      include: {
        pettyCashReceipt: { select: { sessionId: true } },
        pettyCashExpense: { select: { sessionId: true } },
        pettyCashTransfer: { select: { sessionId: true } },
      },
    }),
    prisma.account.findMany({ where: { isActive: true }, orderBy: { code: "asc" } }),
    prisma.family.findMany({
      where: { archivedAt: null },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        people: { select: { id: true, firstName: true, lastName: true }, orderBy: { firstName: "asc" } },
      },
    }),
    getActiveFunds(),
    // activeOnly: false — this is an edit of a possibly-historical row, so a
    // since-deactivated payment account (or the CASH account, if this row is
    // somehow tagged with it) must still resolve for the form's picker.
    getPaymentAccounts({ activeOnly: false }),
  ])

  if (!transaction) notFound()

  // Include this row's own account even if it was later deactivated, so a
  // historical transaction still renders its category in the dropdown.
  // New-transaction entry stays active-only; only the edit path needs this.
  const accountOptions = accounts.some((a) => a.id === transaction.accountId)
    ? accounts
    : [...accounts, ...(await prisma.account.findMany({ where: { id: transaction.accountId } }))].sort(
        (a, b) => a.code.localeCompare(b.code)
      )

  // Petty cash transactions are read-only — redirect to their session
  if (transaction.pettyCashReceiptId != null || transaction.pettyCashExpenseId != null || transaction.pettyCashTransferId != null) {
    const sessionId = transaction.pettyCashReceipt?.sessionId ?? transaction.pettyCashExpense?.sessionId ?? transaction.pettyCashTransfer?.sessionId
    redirect(`/accounting/petty-cash/sessions/${sessionId}`)
  }

  // Locked-period rows are read-only — mirror the list page's disabled Edit
  // button so a direct URL can't open the form. The action rejects the
  // write regardless, but this avoids a wasted, silently-failing edit.
  const lockDate = await getAccountingLockDate()
  if (isDateLocked(transaction.date, lockDate)) redirect(`/accounting/transactions/${transaction.id}`)

  const action = updateTransaction.bind(null, transaction.id)

  return (
    <div>
      <h2 className="text-2xl font-semibold text-foreground mb-6">Edit transaction</h2>
      <TransactionForm
        action={action}
        // description is always encrypted; notes is encrypted only for
        // bank-import rows — decrypt both for the form (safeDecrypt is
        // a no-op on plaintext) or the raw ciphertext renders in the field and
        // re-saves corrupt.
        transaction={{
          ...transaction,
          amount: Number(transaction.amount),
          description: safeDecrypt(transaction.description),
          notes: transaction.notes ? safeDecrypt(transaction.notes) : transaction.notes,
        }}
        accounts={accountOptions}
        families={families}
        funds={funds}
        paymentAccounts={paymentAccounts}
      />
    </div>
  )
}