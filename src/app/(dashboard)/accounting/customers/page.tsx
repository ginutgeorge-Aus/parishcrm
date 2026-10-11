import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { canAccessAccounting, canViewAccounting } from "@/lib/roleGuard"
import { listCustomers } from "@/lib/actions/customer"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CustomerActiveToggle } from "./CustomerActiveToggle"

/** Saved outside customers that invoices can be addressed to. */
export default async function CustomersPage() {
  const session = await auth()
  if (!canViewAccounting(session?.user?.role)) redirect("/")
  const result = await listCustomers({ includeInactive: true })
  if ("error" in result) redirect("/")
  const canManage = canAccessAccounting(session?.user?.role)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold text-foreground">Customers</h2>
        <div className="flex gap-2">
          <Button asChild variant="outline"><Link href="/accounting/invoices">Invoices</Link></Button>
          {canManage && <Button asChild><Link href="/accounting/customers/new">New customer</Link></Button>}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Outside people or organisations you invoice (hall hire, venue fees). Church members are picked from People instead.
      </p>
      {result.length === 0 ? (
        <p className="text-sm text-muted-foreground">No customers yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Phone</th>
                <th className="px-3 py-2 font-medium">Status</th>
                {canManage && <th className="px-3 py-2"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {result.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="px-3 py-2">{c.name}</td>
                  <td className="px-3 py-2">{c.email ?? "—"}</td>
                  <td className="px-3 py-2">{c.phone ?? "—"}</td>
                  <td className="px-3 py-2">
                    <Badge variant={c.isActive ? "secondary" : "outline"}>{c.isActive ? "Active" : "Inactive"}</Badge>
                  </td>
                  {canManage && (
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Button asChild variant="ghost" size="sm"><Link href={`/accounting/customers/${c.id}/edit`}>Edit</Link></Button>
                      <CustomerActiveToggle id={c.id} isActive={c.isActive} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
