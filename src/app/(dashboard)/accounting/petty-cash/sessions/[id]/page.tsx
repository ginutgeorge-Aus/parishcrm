import { notFound, redirect } from "next/navigation"
import { PageHeader } from "@/components/shared/PageHeader"
import Link from "next/link"
import { auth } from "@/auth"
import { canAccessAccounting, isAdmin, canViewAccounting } from "@/lib/roleGuard"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { SessionCustodianEditor } from "@/components/petty-cash/SessionCustodianEditor"
import { SessionReceiptsTable } from "@/components/petty-cash/SessionReceiptsTable"
import { SessionExpensesTable } from "@/components/petty-cash/SessionExpensesTable"
import { SessionTransfersTable } from "@/components/petty-cash/SessionTransfersTable"
import { fmtAUD as fmt } from "@/lib/formatting"
import { varianceLabel } from "@/lib/pettyCashLedger"
import { getSessionDetailData } from "./page.data"
import { APP_LOCALE, APP_TIMEZONE } from "@/lib/appConfig"
import { parseRouteId } from "@/lib/validation"
// Close notes are encrypted since AUD-3-04; older plaintext rows pass through unchanged.
import { safeDecrypt } from "@/lib/crypto"

export default async function SessionDetailPage(
  props: Readonly<{
    params: Promise<{ id: string }>
  }>
) {
  const params = await props.params;
  const session = await auth()
  if (!canViewAccounting(session?.user?.role)) redirect("/")

  const sessionId = parseRouteId(params.id)
  if (sessionId === null) notFound()

  const userCanEdit = canAccessAccounting(session?.user?.role)
  const userIsAdmin = isAdmin(session?.user?.role)

  const data = await getSessionDetailData(sessionId, userCanEdit)
  if (!data) notFound()
  const { pcSession, people, balance, totalReceipts, totalExpenses, totalTransfers, lockDate } = data
  const isOpen = pcSession.status === "OPEN"

  return (
    <div className="space-y-6">
      <PageHeader
        title={pcSession.title}
        badge={<Badge variant={isOpen ? "default" : "outline"}>{pcSession.status}</Badge>}
        align="start"
        meta={
          <div className="mt-1">
            <div className="text-sm text-muted-foreground mt-1">
              {userCanEdit ? (
                <SessionCustodianEditor
                  sessionId={pcSession.id}
                  people={people}
                  currentId={pcSession.custodianId}
                  currentName={`${pcSession.custodian.firstName} ${pcSession.custodian.lastName}`}
                />
              ) : (
                <>Custodian: {pcSession.custodian.firstName} {pcSession.custodian.lastName}</>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Opened: {pcSession.openedAt.toLocaleDateString(APP_LOCALE, { timeZone: APP_TIMEZONE })}
              {pcSession.closedAt &&
                ` · Closed: ${pcSession.closedAt.toLocaleDateString(APP_LOCALE, { timeZone: APP_TIMEZONE })}`}
            </p>
            {pcSession.notes && (
              <p className="text-sm text-muted-foreground mt-1">Note: {safeDecrypt(pcSession.notes)}</p>
            )}
            {!isOpen && pcSession.countedCash !== null && (
              <p className="text-sm mt-1">
                Counted: {fmt(Number(pcSession.countedCash))}
                {" · "}
                <span
                  className={
                    Number(pcSession.closingVariance) === 0
                      ? "text-muted-foreground"
                      : "text-destructive font-medium"
                  }
                >
                  Variance: {varianceLabel(Number(pcSession.closingVariance))}
                </span>
              </p>
            )}
          </div>
        }
        actions={
          <>
            {!isOpen && (
              <Button asChild size="sm" variant="outline">
                <Link href={`/accounting/petty-cash/sessions/${pcSession.id}/print`} target="_blank">
                  Print summary
                </Link>
              </Button>
            )}
            {userCanEdit && isOpen && (
              <>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/accounting/petty-cash/sessions/${pcSession.id}/receipts/new`}>
                    Add receipt
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/accounting/petty-cash/sessions/${pcSession.id}/expenses/new`}>
                    Add expense
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/accounting/petty-cash/sessions/${pcSession.id}/transfer/new`}>
                    Record transfer
                  </Link>
                </Button>
                <Button asChild size="sm" variant="destructive">
                  <Link href={`/accounting/petty-cash/sessions/${pcSession.id}/close`}>
                    Close session
                  </Link>
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground">Opening balance</p>
          <p className="text-lg font-semibold tabular">{fmt(Number(pcSession.openingBalance))}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground">Total receipts</p>
          <p className="text-lg font-semibold text-income tabular">+{fmt(totalReceipts)}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground">Total expenses</p>
          <p className="text-lg font-semibold text-expense tabular">-{fmt(totalExpenses)}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground">Cash in hand</p>
          <p className="text-lg font-semibold tabular">{fmt(balance)}</p>
        </div>
      </div>

      <SessionReceiptsTable
        sessionId={pcSession.id}
        receipts={pcSession.receipts}
        totalReceipts={totalReceipts}
        userCanEdit={userCanEdit}
        userIsAdmin={userIsAdmin}
        isOpen={isOpen}
        lockDate={lockDate}
      />

      <SessionExpensesTable
        sessionId={pcSession.id}
        expenses={pcSession.expenses}
        totalExpenses={totalExpenses}
        userCanEdit={userCanEdit}
        userIsAdmin={userIsAdmin}
        isOpen={isOpen}
        lockDate={lockDate}
      />

      <SessionTransfersTable
        sessionId={pcSession.id}
        transfers={pcSession.transfers}
        totalTransfers={totalTransfers}
        userCanEdit={userCanEdit}
        userIsAdmin={userIsAdmin}
        isOpen={isOpen}
        lockDate={lockDate}
      />

      <Button variant="outline" asChild>
        <Link href="/accounting/petty-cash">Back to overview</Link>
      </Button>
    </div>
  )
}
