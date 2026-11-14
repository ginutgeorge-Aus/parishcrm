import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { canEditSacraments } from "@/lib/roleGuard"
import { createSacramentRecord } from "@/lib/actions/sacrament"
import { parseRouteId } from "@/lib/validation"
import { SacramentType } from "@/lib/generated/prisma/enums"
import { SacramentForm } from "@/components/sacraments/SacramentForm"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/** Most people a search shows. */
const SEARCH_CAP = 20

type Props = { searchParams: Promise<{ personId?: string; q?: string; type?: string }> }

/**
 * New register entry. Step 1: pick the person (`?q=` name search, or arrive
 * with `?personId=` from the person page). Step 2: the entry form. ADMIN | PASTOR only.
 */
export default async function NewSacramentPage(props: Readonly<Props>) {
  const session = await auth()
  if (!canEditSacraments(session?.user?.role)) redirect("/sacraments")
  const sp = await props.searchParams
  const personId = parseRouteId(sp.personId)
  const person = personId
    ? await prisma.person.findUnique({
        where: { id: personId },
        select: { id: true, firstName: true, lastName: true, family: { select: { name: true } } },
      })
    : null
  const q = sp.q?.trim().slice(0, 80) ?? ""
  const matches =
    !person && q
      ? await prisma.person.findMany({
          where: {
            archivedAt: null,
            OR: q
              .split(/\s+/)
              .flatMap((w) => [
                { firstName: { contains: w, mode: "insensitive" as const } },
                { lastName: { contains: w, mode: "insensitive" as const } },
              ]),
          },
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
          take: SEARCH_CAP,
          select: { id: true, firstName: true, lastName: true, family: { select: { name: true } } },
        })
      : []
  const defaultType = Object.values(SacramentType).find((t) => t === sp.type)

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1 text-sm text-muted-foreground">
          <Link href="/sacraments" className="hover:underline">Sacramental register</Link>
          {" / New entry"}
        </p>
        <h2 className="text-2xl font-semibold text-foreground">New register entry</h2>
      </div>

      {person ? (
        <>
          <p className="text-sm">
            For{" "}
            <Link href={`/people/${person.id}`} className="font-medium hover:underline">
              {person.firstName} {person.lastName}
            </Link>
            <span className="text-muted-foreground"> · {person.family.name}</span>{" "}
            <Link href="/sacraments/new" className="text-sm text-muted-foreground underline hover:text-foreground">
              Change person
            </Link>
          </p>
          <SacramentForm personId={person.id} defaultType={defaultType} action={createSacramentRecord} />
        </>
      ) : (
        <div className="max-w-xl space-y-3">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="q">Find the person</Label>
              <Input id="q" name="q" defaultValue={q} placeholder="First or last name" maxLength={80} />
            </div>
            <Button type="submit" variant="outline">Search</Button>
          </form>
          {q && matches.length === 0 && <p className="text-sm text-muted-foreground">No people match &ldquo;{q}&rdquo;.</p>}
          {matches.length > 0 && (
            <ul className="divide-y text-sm">
              {matches.map((m) => (
                <li key={m.id}>
                  <Link
                    href={`/sacraments/new?personId=${m.id}`}
                    className="flex min-h-11 items-center justify-between gap-2 py-1 hover:underline"
                  >
                    <span>{m.firstName} {m.lastName}</span>
                    <span className="text-muted-foreground">{m.family.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {matches.length === SEARCH_CAP && (
            <p className="text-sm text-muted-foreground">Showing the first {SEARCH_CAP} matches. Narrow the search.</p>
          )}
        </div>
      )}
    </div>
  )
}
