import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"
import { canEditSacraments, canViewSacraments } from "@/lib/roleGuard"
import { getSacramentRecord } from "@/lib/actions/sacrament"
import { SACRAMENT_LABEL, formatLongYmd } from "@/lib/sacraments"
import { parseRouteId } from "@/lib/validation"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { DeleteSacramentButton } from "@/components/sacraments/DeleteSacramentButton"

/** One labelled value; renders a dash when empty. */
function field(label: string, value: React.ReactNode) {
  return (
    <div>
      <span className="text-sm text-muted-foreground">{label}</span>
      <p className="mt-0.5 whitespace-pre-line">{value || "—"}</p>
    </div>
  )
}

/** Register entry detail with certificate download. ADMIN | PASTOR | OFFICE_ADMIN view; ADMIN | PASTOR edit and delete. */
export default async function SacramentPage(props: Readonly<{ params: Promise<{ id: string }> }>) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (!canViewSacraments(session.user.role)) redirect("/")
  const id = parseRouteId((await props.params).id)
  if (id === null) notFound()
  const r = await getSacramentRecord(id)
  if (!r) notFound()
  const editor = canEditSacraments(session.user.role)
  const personName = `${r.person.firstName} ${r.person.lastName}`

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="mb-1 text-sm text-muted-foreground">
            <Link href="/sacraments" className="hover:underline">Sacramental register</Link>
            {` / ${r.registerNo}`}
          </p>
          <h2 className="text-2xl font-semibold text-foreground">
            {SACRAMENT_LABEL[r.type]} · {r.registerNo}
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href={`/sacraments/${r.id}/certificate`} target="_blank" rel="noreferrer">Certificate (PDF)</a>
          </Button>
          {editor && (
            <>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/sacraments/${r.id}/edit`}>Edit</Link>
              </Button>
              <DeleteSacramentButton id={r.id} registerNo={r.registerNo} />
            </>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="grid grid-cols-1 gap-4 pt-6 text-sm sm:grid-cols-2">
          {field("Person", <Link href={`/people/${r.person.id}`} className="hover:underline">{personName}</Link>)}
          {r.type === "MARRIAGE" &&
            field(
              "Spouse",
              r.spouse ? (
                <Link href={`/people/${r.spouse.id}`} className="hover:underline">
                  {r.spouse.firstName} {r.spouse.lastName}
                </Link>
              ) : (
                r.spouseName
              ),
            )}
          {field("Date", formatLongYmd(r.date))}
          {field("Place", r.place)}
          {field("Minister", r.ministerName)}
          {field(r.type === "BAPTISM" ? "Godparents" : "Sponsors / witnesses", r.godparents)}
          <div className="sm:col-span-2">{field("Notes", r.notes)}</div>
        </CardContent>
      </Card>
    </div>
  )
}
