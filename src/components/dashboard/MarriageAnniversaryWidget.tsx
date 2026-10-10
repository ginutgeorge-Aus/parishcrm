import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { APP_LOCALE } from "@/lib/appConfig"
import { sydneyParts } from "@/lib/dates"

type MarriageFamily = {
  id: number
  name: string
  marriageDate: Date | null
}

/**
 * Completed years since the marriage date — counts elapsed years, not the
 * calendar-year difference, so a couple shows "Ny" only once that anniversary
 * has actually arrived on the Sydney calendar (mirrors the member-anniversary
 * rule). `marriageDate` is stored UTC-midnight, so it is read via UTC getters;
 * "today" is the Sydney wall-clock date of `at`, not the server's UTC clock.
 *
 * @param marriageDate - UTC-midnight marriage date.
 * @param at - Instant to measure from (defaults to now).
 * @returns Whole years elapsed as of the Sydney date of `at`.
 */
export function elapsedYears(marriageDate: Date, at: Date = new Date()): number {
  const { year, month, day } = sydneyParts(at)
  const anniMonth = marriageDate.getUTCMonth() + 1
  // 29 Feb is observed on 28 Feb in non-leap years (same rule as calendarDateInYear).
  const anniDay = Math.min(marriageDate.getUTCDate(), new Date(Date.UTC(year, anniMonth, 0)).getUTCDate())
  const beforeAnniversary = month < anniMonth || (month === anniMonth && day < anniDay)
  return year - marriageDate.getUTCFullYear() - (beforeAnniversary ? 1 : 0)
}

export function MarriageAnniversaryWidget({ families }: Readonly<{ families: MarriageFamily[] }>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h4" className="text-base"><span aria-hidden="true">💍</span> Wedding anniversaries this month</CardTitle>
      </CardHeader>
      <CardContent>
        {families.length === 0 ? (
          <p className="text-sm text-muted-foreground">No wedding anniversaries this month</p>
        ) : (
          <ul className="space-y-2">
            {families.map((f) => (
              <li key={f.id} className="flex justify-between text-sm">
                <Link href={`/families/${f.id}`} className="hover:underline">
                  {f.name}
                </Link>
                <span className="text-muted-foreground">
                  {f.marriageDate?.toLocaleDateString(APP_LOCALE, {
                    day: "2-digit",
                    month: "2-digit",
                    timeZone: "UTC",
                  })}
                  {f.marriageDate && (
                    <span className="ml-1 text-muted-foreground/70 text-xs">
                      ({elapsedYears(f.marriageDate)}y)
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
