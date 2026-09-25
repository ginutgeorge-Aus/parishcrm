import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { isAdmin } from "@/lib/roleGuard"
import { Badge } from "@/components/ui/badge"
import { ServiceTypeForm } from "@/components/petty-cash/ServiceTypeForm"
import { ToggleServiceTypeButton } from "@/components/petty-cash/ToggleServiceTypeButton"
import { DeleteServiceTypeButton } from "@/components/petty-cash/DeleteServiceTypeButton"
import { createServiceType } from "@/lib/actions/serviceType"

export default async function ServiceTypesPage() {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) redirect("/accounting/petty-cash")

  const serviceTypes = await prisma.serviceType.findMany({ orderBy: { name: "asc" } })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-foreground">Service types</h2>
      </div>

      <ServiceTypeForm action={createServiceType} />

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th scope="col" className="pb-2 font-medium">Name</th>
              <th scope="col" className="pb-2 font-medium">Status</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody>
            {serviceTypes.length === 0 && (
              <tr>
                <td colSpan={3} className="py-8 text-center text-muted-foreground">
                  No service types yet. Add one above.
                </td>
              </tr>
            )}
            {serviceTypes.map((st) => (
              <tr key={st.id} className="border-b last:border-0 hover:bg-muted/30">
                <td className="py-2 pr-4">{st.name}</td>
                <td className="py-2 pr-4">
                  <Badge variant={st.isActive ? "default" : "outline"}>
                    {st.isActive ? "Active" : "Inactive"}
                  </Badge>
                </td>
                <td className="py-2">
                  <div className="flex gap-2">
                    <ToggleServiceTypeButton id={st.id} isActive={st.isActive} />
                    <DeleteServiceTypeButton id={st.id} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
