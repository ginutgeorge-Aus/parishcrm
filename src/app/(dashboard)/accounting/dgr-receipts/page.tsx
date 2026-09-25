import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { canViewAccounting, canAccessAccounting } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { fmtAUD } from "@/lib/formatting"
import { fyLabel, currentFyEndYear } from "@/lib/dgr"
import { listDgrReceipts } from "@/lib/actions/dgrReceipt"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { APP_LOCALE, APP_TIMEZONE } from "@/lib/appConfig"
import { DgrReceiptRowActions } from "@/components/accounting/DgrReceiptRowActions"

type Props = { searchParams: Promise<{ fy?: string }> }

export default async function DgrReceiptsPage(props: Props) {
  const searchParams = await props.searchParams
  const session = await auth()
  if (!canViewAccounting(session?.user?.role)) redirect("/")

  void logAudit(actorId(session), "VIEW_FINANCIAL_REPORT", "DgrReceipt", undefined, {
    report: "dgr-receipts",
  })

  const fyEndNow = currentFyEndYear()
  const parsedFy = parseInt(searchParams.fy ?? "", 10)
  const fyEndYear =
    Number.isInteger(parsedFy) && parsedFy >= 2000 && parsedFy <= 2100 ? parsedFy : undefined

  const result = await listDgrReceipts(fyEndYear)
  if ("error" in result) redirect("/")
  const rows = result

  const canManage = canAccessAccounting(session?.user?.role)
  const fyOptions = Array.from({ length: 6 }, (_, i) => fyEndNow - i)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold text-foreground">DGR Receipts</h2>
        {canManage && (
          <Button asChild>
            <Link href="/accounting/dgr-receipts/new">New DGR Receipt</Link>
          </Button>
        )}
      </div>

      <form method="GET" className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="fy" className="text-xs text-muted-foreground block mb-1">
            Financial year
          </Label>
          <Select name="fy" defaultValue={fyEndYear ? String(fyEndYear) : "ALL"}>
            <SelectTrigger id="fy" className="h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All years</SelectItem>
              {fyOptions.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {fyLabel(y)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" className="h-11">
          Filter
        </Button>
      </form>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No receipts found.</p>
      ) : (
        <>
          <div className="hidden md:block bg-card border border-border rounded-lg overflow-x-auto">
            <table className="w-full min-w-table-wide text-sm">
              <thead className="bg-muted border-b border-border">
                <tr>
                  {["Receipt No", "FY", "Donor", "Amount", "Status", "Sent", "Actions"].map((h) => (
                    <th
                      key={h}
                      className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2 font-medium whitespace-nowrap">{r.receiptNo}</td>
                    <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">{r.fyLabel}</td>
                    <td className="px-4 py-2">{r.donorName}</td>
                    <td className="px-4 py-2 font-medium whitespace-nowrap">{fmtAUD(r.total)}</td>
                    <td className="px-4 py-2">
                      <Badge
                        variant={
                          r.status === "SENT"
                            ? "default"
                            : r.status === "FAILED"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {r.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">
                      {r.sentAt ? r.sentAt.toLocaleDateString(APP_LOCALE, { timeZone: APP_TIMEZONE }) : "—"}
                    </td>
                    <td className="px-4 py-2">
                      <DgrReceiptRowActions
                        id={r.id}
                        receiptNo={r.receiptNo}
                        status={r.status}
                        canManage={canManage}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="space-y-2 md:hidden">
            {rows.map((r) => (
              <li key={r.id} className="rounded-lg border bg-card p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{r.receiptNo}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {r.fyLabel} · {r.donorName}
                    </p>
                  </div>
                  <span className="shrink-0 tabular font-medium whitespace-nowrap">
                    {fmtAUD(r.total)}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <Badge
                    variant={
                      r.status === "SENT"
                        ? "default"
                        : r.status === "FAILED"
                          ? "destructive"
                          : "secondary"
                    }
                  >
                    {r.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {r.sentAt ? r.sentAt.toLocaleDateString(APP_LOCALE, { timeZone: APP_TIMEZONE }) : "—"}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 border-t pt-2">
                  <DgrReceiptRowActions
                    id={r.id}
                    receiptNo={r.receiptNo}
                    status={r.status}
                    canManage={canManage}
                  />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
