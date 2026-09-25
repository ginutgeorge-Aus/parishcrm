import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { DueAnniversary } from "@/lib/anniversaries"
import { FetchCapNotice } from "@/components/people/FetchCapNotice"

export function AnniversaryWidget({ anniversaries, truncated = false }: { anniversaries: DueAnniversary[]; truncated?: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">💍 Anniversaries this week</CardTitle>
      </CardHeader>
      <CardContent>
        {anniversaries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No anniversaries in the next 7 days</p>
        ) : (
          <ul className="space-y-2">
            {anniversaries.map((a) => (
              <li key={a.familyId} className="flex justify-between text-sm">
                <span>{a.coupleNames}</span>
                <span className="text-muted-foreground">
                  {a.dateLabel}
                  <span className="ml-1 text-muted-foreground/70 text-xs">({a.yearsMarried}y)</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {truncated && <FetchCapNotice className="mt-2" />}
      </CardContent>
    </Card>
  )
}
