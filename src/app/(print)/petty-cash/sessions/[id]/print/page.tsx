import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { redirect, notFound } from "next/navigation"
import { headers } from "next/headers"
import { canViewAccounting } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { auditIpFromHeaders } from "@/lib/clientIp"
import { calcRunningBalance, varianceLabel } from "@/lib/pettyCashLedger"
import { sumCents, centsToNumber, fmtAUD as fmt } from "@/lib/formatting"
import { safeDecrypt } from "@/lib/crypto"
import { PrintButton } from "@/components/ui/PrintButton"
import { APP_LOCALE, APP_TIMEZONE } from "@/lib/appConfig"

type Props = { params: Promise<{ id: string }> }

export default async function PettyCashPrintPage(props: Props) {
  const params = await props.params
  const session = await auth()
  if (!session) redirect("/login")
  if (!canViewAccounting(session?.user?.role)) redirect("/")

  // Production CSP nonces style-src; the print <style> needs the nonce.
  const nonce = (await headers()).get("x-nonce") ?? undefined

  const id = Number.parseInt(params.id, 10)
  if (Number.isNaN(id) || id <= 0 || id > 2147483647) notFound()

  const pcSession = await prisma.pettyCashSession.findUnique({
    where: { id },
    include: {
      custodian: { select: { firstName: true, lastName: true } },
      receipts: {
        include: {
          account: { select: { code: true, name: true } },
          serviceType: { select: { name: true } },
          person: { select: { firstName: true, lastName: true } },
        },
        orderBy: { date: "asc" },
      },
      expenses: {
        include: { account: { select: { code: true, name: true } } },
        orderBy: { date: "asc" },
      },
      transfers: { orderBy: { date: "asc" } },
    },
  })
  if (!pcSession) notFound()

  // Decrypts + prints payee/donor names + descriptions — audit on access,
  // matching the P&L and directory print pages.
  const ip = auditIpFromHeaders(await headers())
  await logAudit(actorId(session), "EXPORT_PETTY_CASH_SESSION", "PettyCashSession", id, { title: pcSession.title }, ip)

  const totalReceipts = centsToNumber(sumCents(pcSession.receipts.map((r) => r.amount)))
  const totalExpenses = centsToNumber(sumCents(pcSession.expenses.map((e) => e.amount)))
  const totalTransfers = centsToNumber(sumCents(pcSession.transfers.map((t) => t.amount)))
  const closingBalance = calcRunningBalance(
    pcSession.openingBalance,
    pcSession.receipts,
    pcSession.expenses,
    pcSession.transfers
  )

  const custodianName = `${pcSession.custodian.firstName} ${pcSession.custodian.lastName}`
  const openedDate = pcSession.openedAt.toLocaleDateString(APP_LOCALE, { timeZone: APP_TIMEZONE })
  const closedDate = pcSession.closedAt?.toLocaleDateString(APP_LOCALE, { timeZone: APP_TIMEZONE }) ?? "—"

  return (
    <>
      <div className="print:hidden">
        <PrintButton />
      </div>
      <style nonce={nonce}>{`
        /* Print-scoped palette — CSS vars defined here apply reliably in @media print (unlike app :root tokens). */
        :root { --c-meta: #555; --c-muted: #666; --c-border: #e2e8f0; --c-th-bg: #f1f5f9; --c-row-bg: #f8fafc; --c-pos: #16a34a; --c-neg: #dc2626; }
        body { font-family: sans-serif; font-size: 12px; margin: 24px; }
        h1 { font-size: 18px; margin-bottom: 4px; }
        h2 { font-size: 14px; margin: 20px 0 6px; border-bottom: 1px solid var(--c-border); padding-bottom: 4px; }
        .meta { color: var(--c-meta); margin-bottom: 16px; font-size: 11px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
        th { background: var(--c-th-bg); border: 1px solid var(--c-border); padding: 5px 8px; text-align: left; font-size: 10px; text-transform: uppercase; }
        td { border: 1px solid var(--c-border); padding: 5px 8px; vertical-align: top; }
        .text-right { text-align: right; }
        .muted { color: var(--c-muted); }
        .positive { color: var(--c-pos); }
        .negative { color: var(--c-neg); }
        .total-row td { font-weight: 600; background: var(--c-row-bg); }
        .summary { margin-top: 20px; border: 1px solid var(--c-border); border-radius: 4px; width: 260px; margin-left: auto; }
        .summary table { margin: 0; }
        .summary td { border: none; border-bottom: 1px solid var(--c-th-bg); padding: 5px 10px; }
        .summary tr:last-child td { border-bottom: none; font-weight: 700; }
        @media print { body { margin: 0; } }
      `}</style>

      <h1>Petty Cash Session — {pcSession.title}</h1>
      <p className="meta">
        Custodian: {custodianName} · Opened: {openedDate} · Closed: {closedDate} ·
        Opening balance: {fmt(Number(pcSession.openingBalance))} · Status: {pcSession.status}
      </p>

      <h2>Receipts ({pcSession.receipts.length})</h2>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Category</th>
            <th>Service type</th>
            <th>Donor</th>
            <th className="text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {pcSession.receipts.length === 0 ? (
            <tr>
              <td colSpan={5} className="muted">No receipts</td>
            </tr>
          ) : (
            <>
              {pcSession.receipts.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{r.date.toLocaleDateString(APP_LOCALE, { timeZone: "UTC" })}</td>
                  <td>{r.account.code} — {r.account.name}</td>
                  <td className="muted">{r.serviceType?.name ?? "—"}</td>
                  <td className="muted">
                    {r.person ? `${r.person.firstName} ${r.person.lastName}` : "—"}
                  </td>
                  <td className="text-right positive">+{fmt(Number(r.amount))}</td>
                </tr>
              ))}
              <tr className="total-row">
                <td colSpan={4}>Total receipts</td>
                <td className="text-right positive">+{fmt(totalReceipts)}</td>
              </tr>
            </>
          )}
        </tbody>
      </table>

      <h2>Expenses ({pcSession.expenses.length})</h2>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Payee</th>
            <th>Category</th>
            <th>Description</th>
            <th>Receipt ref</th>
            <th className="text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {pcSession.expenses.length === 0 ? (
            <tr>
              <td colSpan={6} className="muted">No expenses</td>
            </tr>
          ) : (
            <>
              {pcSession.expenses.map((e) => (
                <tr key={e.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{e.date.toLocaleDateString(APP_LOCALE, { timeZone: "UTC" })}</td>
                  <td>{safeDecrypt(e.payee)}</td>
                  <td>{e.account.code} — {e.account.name}</td>
                  <td>{safeDecrypt(e.description)}</td>
                  <td className="muted">{e.receiptRef ?? "—"}</td>
                  <td className="text-right negative">-{fmt(Number(e.amount))}</td>
                </tr>
              ))}
              <tr className="total-row">
                <td colSpan={5}>Total expenses</td>
                <td className="text-right negative">-{fmt(totalExpenses)}</td>
              </tr>
            </>
          )}
        </tbody>
      </table>

      <h2>Bank transfers ({pcSession.transfers.length})</h2>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Deposited by</th>
            <th>Deposit slip</th>
            <th>Retained float</th>
            <th className="text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {pcSession.transfers.length === 0 ? (
            <tr>
              <td colSpan={5} className="muted">No transfers</td>
            </tr>
          ) : (
            <>
              {pcSession.transfers.map((t) => (
                <tr key={t.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{t.date.toLocaleDateString(APP_LOCALE, { timeZone: "UTC" })}</td>
                  <td>{safeDecrypt(t.depositedByName)}</td>
                  <td className="muted">{t.depositSlipRef ?? "—"}</td>
                  <td className="muted">
                    {Number(t.retainedFloat) > 0 ? fmt(Number(t.retainedFloat)) : "—"}
                  </td>
                  <td className="text-right">{fmt(Number(t.amount))}</td>
                </tr>
              ))}
              <tr className="total-row">
                <td colSpan={4}>Total transferred</td>
                <td className="text-right">{fmt(totalTransfers)}</td>
              </tr>
            </>
          )}
        </tbody>
      </table>

      <div className="summary">
        <table>
          <tbody>
            <tr>
              <td>Opening balance</td>
              <td className="text-right">{fmt(Number(pcSession.openingBalance))}</td>
            </tr>
            <tr>
              <td className="positive">Total receipts (+)</td>
              <td className="text-right positive">+{fmt(totalReceipts)}</td>
            </tr>
            <tr>
              <td className="negative">Total expenses (−)</td>
              <td className="text-right negative">-{fmt(totalExpenses)}</td>
            </tr>
            <tr>
              <td>Total transfers (−)</td>
              <td className="text-right">-{fmt(totalTransfers)}</td>
            </tr>
            <tr>
              <td>Closing balance</td>
              <td className="text-right">{fmt(closingBalance)}</td>
            </tr>
            {pcSession.countedCash !== null && (
              <>
                <tr>
                  <td>Counted cash</td>
                  <td className="text-right">{fmt(Number(pcSession.countedCash))}</td>
                </tr>
                <tr>
                  <td>Variance</td>
                  <td className="text-right">
                    {varianceLabel(Number(pcSession.closingVariance))}
                  </td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
