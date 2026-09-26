import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { prisma } from "@/lib/prisma"
import { canAccessAccounting, canViewAccounting } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { safeDecrypt } from "@/lib/crypto"
import { fmtAUD } from "@/lib/formatting"
import { format } from "date-fns"
import { formatSydneyDateTime } from "@/lib/dates"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SendReceiptDialog } from "@/components/accounting/SendReceiptDialog"
import { RiskFlagBadges } from "@/components/accounting/RiskFlagBadges"
import { TransactionAttachments } from "@/components/accounting/TransactionAttachments"

type Props = { params: Promise<{ id: string }> }

async function lookupDefaultEmail(personId: number | undefined, familyId: number | null): Promise<string | null> {
  const rawDefaultEmail =
    (personId === undefined
      ? null
      : (await prisma.person.findUnique({
          where: { id: personId },
          select: { email: true },
        }))?.email) ??
    (await prisma.person.findFirst({
      where: { familyId: familyId ?? -1, email: { not: null } },
      select: { email: true },
    }))?.email ??
    null
  return rawDefaultEmail ? safeDecrypt(rawDefaultEmail) : null
}

export default async function TransactionDetailPage(props: Props) {
  const params = await props.params
  const session = await auth()
  if (!canViewAccounting(session?.user?.role)) redirect("/")

  const id = Number.parseInt(params.id, 10)
  if (Number.isNaN(id) || id <= 0 || id > 2147483647) notFound()

  const tx = await prisma.transaction.findUnique({
    where: { id },
    include: {
      account: true,
      family: { select: { id: true, name: true } },
      person: { select: { id: true, firstName: true, lastName: true } },
      paymentAccountRel: { select: { name: true } },
      receiptSends: {
        orderBy: { sentAt: "desc" },
        include: { sentBy: { select: { name: true } } },
      },
      // Attachment metadata only — the blob bytes are streamed by the download
      // route, never loaded into the page.
      attachments: {
        orderBy: { uploadedAt: "desc" },
        select: { id: true, filename: true, contentType: true, size: true },
      },
    },
  })
  if (!tx) notFound()

  const userCanEdit = canAccessAccounting(session?.user?.role)

  // Log VIEW_TRANSACTION for every accounting role, not just AUDITOR — financial
  // accountability requires a trail for ADMIN/PASTOR reads too (matching
  // the all-roles receipt-audit logging from).
  void logAudit(actorId(session), "VIEW_TRANSACTION", "Transaction", id)

  // notes is unencrypted for manually-keyed rows but encrypted for bank-import
  // rows — safeDecrypt is a no-op on plaintext, so this handles both.
  const displayTx = {
    ...tx,
    description: safeDecrypt(tx.description),
    notes: tx.notes ? safeDecrypt(tx.notes) : tx.notes,
  }
  const receiptSends = tx.receiptSends.map((rs) => ({ ...rs, sentTo: safeDecrypt(rs.sentTo) }))
  // Attachment filenames are encrypted at rest — decrypt for display.
  const attachments = tx.attachments.map((a) => ({ ...a, filename: safeDecrypt(a.filename) }))

  // Data minimisation: only editors can send a receipt, so the party's
  // encrypted email is fetched (and decrypted) solely on the editor path —
  // AUDITORs never have it loaded server-side at all. Person's own email takes
  // priority, then any family member's.
  const defaultEmail = userCanEdit ? await lookupDefaultEmail(tx.person?.id, tx.familyId) : null

  const fields = [
    { label: "Date", value: format(tx.date, "dd/MM/yyyy") },
    { label: "Description", value: displayTx.description },
    { label: "Account", value: `${tx.account.code} — ${tx.account.name}` },
    { label: "Type", value: tx.type },
    {
      label: "Amount",
      value: (
        <span className={tx.type === "INCOME" ? "text-income" : "text-expense"}>
          {tx.type === "INCOME" ? "+" : "-"}
          {fmtAUD(Number(tx.amount))}
        </span>
      ),
    },
    ...(tx.paymentAccountRel ? [{ label: "Payment Account", value: tx.paymentAccountRel.name }] : []),
    ...(tx.reference ? [{ label: "Reference", value: tx.reference }] : []),
    ...(tx.family ? [{ label: "Family", value: tx.family.name }] : []),
    ...(tx.person ? [{ label: "Person", value: `${tx.person.firstName} ${tx.person.lastName}` }] : []),
    ...(displayTx.notes ? [{ label: "Notes", value: displayTx.notes }] : []),
  ]

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/accounting/transactions"
            className="text-xs text-muted-foreground/70 hover:text-muted-foreground mb-1 inline-block"
          >
            ← Transactions
          </Link>
          <h1 className="text-2xl font-semibold text-foreground">Transaction #{tx.id}</h1>
          <RiskFlagBadges tx={tx} className="mt-1" />
        </div>
        {userCanEdit && (
          <div className="flex gap-2">
            <SendReceiptDialog transactionId={tx.id} defaultEmail={defaultEmail} />
            <Button variant="outline" size="sm" asChild>
              <Link href={`/accounting/transactions/${tx.id}/edit`}>Edit</Link>
            </Button>
          </div>
        )}
      </div>

      <div className="bg-card border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            {fields.map(({ label, value }) => (
              <tr key={label} className="border-b border-border last:border-0">
                <th scope="row" className="px-4 py-3 text-left font-normal text-muted-foreground w-40">{label}</th>
                <td className="px-4 py-3 font-medium">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <TransactionAttachments
        transactionId={tx.id}
        attachments={attachments}
        canEdit={userCanEdit}
      />

      <div>
        <h2 className="text-lg font-semibold mb-3">Receipt History</h2>
        {receiptSends.length === 0 ? (
          <p className="text-sm text-muted-foreground">No receipts sent yet.</p>
        ) : (
          <div className="bg-card border border-border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted border-b border-border">
                <tr>
                  {["Sent To", "Sent At", "Sent By", "Status", "Error"].map((h) => (
                    <th key={h} className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {receiptSends.map((rs) => (
                  <tr key={rs.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2">{rs.sentTo}</td>
                    <td className="px-4 py-2 text-muted-foreground text-xs">
                      {formatSydneyDateTime(rs.sentAt)}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{rs.sentBy.name}</td>
                    <td className="px-4 py-2">
                      <Badge variant={rs.status === "SUCCESS" ? "default" : "destructive"}>
                        {rs.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-destructive text-xs">{rs.errorMessage ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
