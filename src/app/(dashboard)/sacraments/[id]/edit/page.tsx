import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"
import { canEditSacraments } from "@/lib/roleGuard"
import { getSacramentRecord, updateSacramentRecord } from "@/lib/actions/sacrament"
import { parseRouteId } from "@/lib/validation"
import { SacramentForm } from "@/components/sacraments/SacramentForm"

/** Edit a register entry's details. ADMIN | PASTOR only; the rite and person are fixed. */
export default async function EditSacramentPage(props: Readonly<{ params: Promise<{ id: string }> }>) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (!canEditSacraments(session.user.role)) redirect("/sacraments")
  const id = parseRouteId((await props.params).id)
  if (id === null) notFound()
  const r = await getSacramentRecord(id)
  if (!r) notFound()

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1 text-sm text-muted-foreground">
          <Link href="/sacraments" className="hover:underline">Sacramental register</Link>
          {" / "}
          <Link href={`/sacraments/${r.id}`} className="hover:underline">{r.registerNo}</Link>
          {" / Edit"}
        </p>
        <h2 className="text-2xl font-semibold text-foreground">Edit {r.registerNo}</h2>
        <p className="text-sm text-muted-foreground">{r.person.firstName} {r.person.lastName}</p>
      </div>
      <SacramentForm record={r} action={updateSacramentRecord.bind(null, r.id)} />
    </div>
  )
}
