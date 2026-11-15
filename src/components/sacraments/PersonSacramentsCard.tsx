import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SACRAMENT_LABEL, formatLongYmd } from "@/lib/sacraments"
import type { SacramentType } from "@/lib/generated/prisma/enums"

/** One register entry as listed on a person page. */
export type PersonSacrament = {
  id: number
  type: SacramentType
  registerNo: string
  /** `YYYY-MM-DD` */
  date: string
  place: string
}

/**
 * Sacraments card on the person page: that person's register entries (as the
 * recipient or the CRM spouse), each linking to its detail page, plus an add
 * link for editors. Callers gate by role (canViewSacraments) before rendering.
 */
export function PersonSacramentsCard({
  personId,
  records,
  canEdit,
}: Readonly<{ personId: number; records: PersonSacrament[]; canEdit: boolean }>) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Sacraments</CardTitle>
        {canEdit && (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/sacraments/new?personId=${personId}`}>Add</Link>
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {records.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sacraments recorded for this person.</p>
        ) : (
          <ul className="divide-y text-sm">
            {records.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
                <Link href={`/sacraments/${r.id}`} className="font-medium hover:underline">
                  {SACRAMENT_LABEL[r.type]}
                </Link>
                <span className="text-muted-foreground">
                  {formatLongYmd(r.date)} · {r.place} · {r.registerNo}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
