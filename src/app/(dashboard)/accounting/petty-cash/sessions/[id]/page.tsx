import { notFound, redirect } from "next/navigation"
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

export default async function SessionDetailPage(
  props: {
    params: Promise<{ id: string }>
  }
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
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-semibold text-foreground">{pcSession.title}</h2>
            <Badge variant={isOpen ? "default" : "outline"}>{pcSession.status}</Badge>
          </div>
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
            <p className="text-sm text-muted-foreground mt-1">Note: {pcSession.notes}</p>
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
        <div className="flex flex-wrap gap-2">
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
              <Button asChild size="sm" variant="destructive" className="sm:ml-auto">
                <Link href={`/accounting/petty-cash/sessions/${pcSession.id}/close`}>
                  Close session
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>

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
        transfers={pcSession.transfers}
        totalTransfers={totalTransfers}
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
