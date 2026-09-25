import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { canViewAccounting, isAdmin } from "@/lib/roleGuard"
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
import { DeleteAccountButton } from "@/components/accounting/DeleteAccountButton"

type AccountRow = {
  id: number
  code: string
  name: string
  type: string
  isActive: boolean
  _count: { transactions: number }
}

function AccountTableBody({ accounts, showAdmin }: { accounts: AccountRow[]; showAdmin: boolean }) {
  return (
    <>
      {accounts.map((a) => (
        <TableRow key={a.id}>
          <TableCell className="font-mono text-sm">{a.code}</TableCell>
          <TableCell className="font-medium">{a.name}</TableCell>
          <TableCell>
            <Badge variant={a.type === "INCOME" ? "default" : "secondary"}>{a.type}</Badge>
          </TableCell>
          <TableCell>
            {a.isActive
              ? <Badge variant="outline">Active</Badge>
              : <Badge variant="secondary">Inactive</Badge>}
          </TableCell>
          <TableCell>
            <Link
              href={`/accounting/reports/general-ledger?account=${a.id}`}
              className="text-primary hover:underline"
            >
              {a._count.transactions}
            </Link>
          </TableCell>
          {showAdmin && (
            <TableCell>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" asChild>
                  <Link href={`/accounting/accounts/${a.id}/edit`}>Edit</Link>
                </Button>
                <DeleteAccountButton accountId={a.id} accountName={a.name} />
              </div>
            </TableCell>
          )}
        </TableRow>
      ))}
    </>
  )
}

function AccountMobileList({ accounts, showAdmin }: { accounts: AccountRow[]; showAdmin: boolean }) {
  return (
    // Mobile: card per account (avoids sideways table scroll)
    <ul className="space-y-2 md:hidden">
      {accounts.length === 0 && (
        <li className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
          No accounts found
        </li>
      )}
      {accounts.map((a) => (
        <li key={a.id} className="rounded-lg border bg-card p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium">{a.name}</p>
              <p className="mt-0.5 font-mono text-xs text-muted-foreground">{a.code}</p>
            </div>
            <Badge variant={a.type === "INCOME" ? "default" : "secondary"}>{a.type}</Badge>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            {a.isActive
              ? <Badge variant="outline">Active</Badge>
              : <Badge variant="secondary">Inactive</Badge>}
            <Link
              href={`/accounting/reports/general-ledger?account=${a.id}`}
              className="tabular text-primary hover:underline"
            >
              {a._count.transactions} transaction{a._count.transactions !== 1 ? "s" : ""}
            </Link>
          </div>
          {showAdmin && (
            <div className="mt-2 flex gap-2 border-t pt-2">
              <Button variant="ghost" size="sm" asChild>
                <Link href={`/accounting/accounts/${a.id}/edit`}>Edit</Link>
              </Button>
              <DeleteAccountButton accountId={a.id} accountName={a.name} />
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

// A component (not a shared JSX-element reference) so each <Table> renders its
// own header subtree — sharing one element across tables is non-idiomatic.
function TableHeaders({ showAdmin }: { showAdmin: boolean }) {
  return (
    <TableHeader>
      <TableRow>
        <TableHead>Code</TableHead>
        <TableHead>Name</TableHead>
        <TableHead>Type</TableHead>
        <TableHead>Status</TableHead>
        <TableHead>Transactions</TableHead>
        {showAdmin && <TableHead className="w-36" />}
      </TableRow>
    </TableHeader>
  )
}

export default async function AccountsPage() {
  const session = await auth()
  if (!canViewAccounting(session?.user?.role)) redirect("/")

  const groups = await prisma.accountGroup.findMany({
    orderBy: [{ type: "asc" }, { sortOrder: "asc" }],
    include: {
      accounts: {
        orderBy: { code: "asc" },
        include: { _count: { select: { transactions: true } } },
      },
    },
  })

  const ungrouped = await prisma.account.findMany({
    where: { groupId: null },
    orderBy: { code: "asc" },
    include: { _count: { select: { transactions: true } } },
  })

  const userIsAdmin = isAdmin(session?.user?.role)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold text-foreground">Categories</h2>
        <div className="flex gap-3">
          {userIsAdmin && (
            <Button variant="outline" asChild>
              <Link href="/accounting/accounts/groups">Manage Groups</Link>
            </Button>
          )}
          {userIsAdmin && (
            <Button asChild>
              <Link href="/accounting/accounts/new">New category</Link>
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-8">
        {groups.map((group) => (
          <div key={group.id}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              {group.name}{" "}
              <span className="font-normal">({group.accounts.length})</span>
            </h3>
            <div className="hidden overflow-x-auto md:block">
              <Table>
                <TableHeaders showAdmin={userIsAdmin} />
                <TableBody>
                  <AccountTableBody accounts={group.accounts} showAdmin={userIsAdmin} />
                </TableBody>
              </Table>
            </div>
            <AccountMobileList accounts={group.accounts} showAdmin={userIsAdmin} />
          </div>
        ))}

        {ungrouped.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Ungrouped <span className="font-normal">({ungrouped.length})</span>
            </h3>
            <div className="hidden overflow-x-auto md:block">
              <Table>
                <TableHeaders showAdmin={userIsAdmin} />
                <TableBody>
                  <AccountTableBody accounts={ungrouped} showAdmin={userIsAdmin} />
                </TableBody>
              </Table>
            </div>
            <AccountMobileList accounts={ungrouped} showAdmin={userIsAdmin} />
          </div>
        )}
      </div>
    </div>
  )
}
