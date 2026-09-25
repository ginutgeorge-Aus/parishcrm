import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { isAdmin } from "@/lib/roleGuard"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { DeleteFundButton } from "@/components/accounting/DeleteFundButton"

export default async function FundsPage() {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) redirect("/accounting/settings")

  const funds = await prisma.fund.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      _count: { select: { transactions: true, pettyCashReceipts: true, pettyCashExpenses: true } },
    },
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Funds</h2>
          <p className="text-sm text-muted-foreground mt-1">
            <Link href="/accounting/settings" className="underline">← Back to Settings</Link>
          </p>
        </div>
        <Button asChild>
          <Link href="/accounting/settings/funds/new">New fund</Link>
        </Button>
      </div>

      <ul className="space-y-2 md:hidden">
        {funds.length === 0 && (
          <li className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
            No funds found
          </li>
        )}
        {funds.map((f) => {
          const entries = f._count.transactions + f._count.pettyCashReceipts + f._count.pettyCashExpenses
          return (
            <li key={f.id} className="rounded-lg border bg-card p-3">
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium">{f.name}</p>
                <Badge variant={f.isActive ? "default" : "secondary"}>
                  {f.isActive ? "Active" : "Inactive"}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Sort order {f.sortOrder} · {entries} {entries === 1 ? "entry" : "entries"}
              </p>
              <div className="mt-2 flex flex-wrap gap-2 border-t pt-2">
                <Button variant="ghost" size="sm" asChild>
                  <Link href={`/accounting/settings/funds/${f.id}/edit`}>Edit</Link>
                </Button>
                {f.name !== "General" && <DeleteFundButton fundId={f.id} fundName={f.name} />}
              </div>
            </li>
          )
        })}
      </ul>

      <div className="hidden overflow-x-auto md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Sort Order</TableHead>
              <TableHead>Entries</TableHead>
              <TableHead className="w-36" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {funds.map((f) => {
              const entries = f._count.transactions + f._count.pettyCashReceipts + f._count.pettyCashExpenses
              return (
                <TableRow key={f.id}>
                  <TableCell className="font-medium">{f.name}</TableCell>
                  <TableCell>
                    <Badge variant={f.isActive ? "default" : "secondary"}>
                      {f.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell>{f.sortOrder}</TableCell>
                  <TableCell>{entries}</TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/accounting/settings/funds/${f.id}/edit`}>Edit</Link>
                      </Button>
                      {f.name !== "General" && <DeleteFundButton fundId={f.id} fundName={f.name} />}
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
