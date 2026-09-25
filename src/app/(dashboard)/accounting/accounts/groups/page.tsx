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
import { DeleteAccountGroupButton } from "@/components/accounting/DeleteAccountGroupButton"

export default async function AccountGroupsPage() {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) redirect("/accounting/accounts")

  const groups = await prisma.accountGroup.findMany({
    orderBy: [{ type: "asc" }, { sortOrder: "asc" }],
    include: { _count: { select: { accounts: true } } },
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Category Groups</h2>
          <p className="text-sm text-muted-foreground mt-1">
            <Link href="/accounting/accounts" className="underline">← Back to Categories</Link>
          </p>
        </div>
        <Button asChild>
          <Link href="/accounting/accounts/groups/new">New group</Link>
        </Button>
      </div>

      <div className="hidden overflow-x-auto md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Sort Order</TableHead>
              <TableHead>Accounts</TableHead>
              <TableHead className="w-36" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((g) => (
              <TableRow key={g.id}>
                <TableCell className="font-medium">{g.name}</TableCell>
                <TableCell>
                  <Badge variant={g.type === "INCOME" ? "default" : "secondary"}>{g.type}</Badge>
                </TableCell>
                <TableCell>{g.sortOrder}</TableCell>
                <TableCell>{g._count.accounts}</TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/accounting/accounts/groups/${g.id}/edit`}>Edit</Link>
                    </Button>
                    <DeleteAccountGroupButton groupId={g.id} groupName={g.name} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: card per group (avoids sideways table scroll) */}
      <ul className="space-y-2 md:hidden">
        {groups.length === 0 && (
          <li className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
            No groups found
          </li>
        )}
        {groups.map((g) => (
          <li key={g.id} className="rounded-lg border bg-card p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">{g.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Sort Order: {g.sortOrder} · {g._count.accounts} account{g._count.accounts !== 1 ? "s" : ""}
                </p>
              </div>
              <Badge variant={g.type === "INCOME" ? "default" : "secondary"} className="shrink-0">{g.type}</Badge>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 border-t pt-2">
              <Button variant="ghost" size="sm" asChild>
                <Link href={`/accounting/accounts/groups/${g.id}/edit`}>Edit</Link>
              </Button>
              <DeleteAccountGroupButton groupId={g.id} groupName={g.name} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
