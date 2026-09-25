import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { APP_LOCALE } from "@/lib/appConfig"

type MarriageFamily = {
  id: number
  name: string
  marriageDate: Date | null
}

// Completed years since the marriage date — counts elapsed years, not the
// calendar-year difference, so a couple shows "Ny" only once that anniversary
// has actually passed this year (mirrors the member-anniversary rule).
function elapsedYears(marriageDate: Date): number {
  // marriageDate is stored UTC-midnight; read via UTC getters so month/day/year
  // never shift by the server's local offset. `today` and `anni` share
  // the local frame, so the elapsed-year comparison stays consistent.
  const today = new Date()
  const anni = new Date(today.getFullYear(), marriageDate.getUTCMonth(), marriageDate.getUTCDate())
  return today.getFullYear() - marriageDate.getUTCFullYear() - (today < anni ? 1 : 0)
}

export function MarriageAnniversaryWidget({ families }: { families: MarriageFamily[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">💍 Wedding anniversaries this month</CardTitle>
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
