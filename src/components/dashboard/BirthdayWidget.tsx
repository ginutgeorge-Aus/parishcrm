import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { APP_LOCALE } from "@/lib/appConfig"
import { FetchCapNotice } from "@/components/people/FetchCapNotice"

type BirthdayPerson = {
  id: number
  firstName: string
  lastName: string
  dateOfBirth: Date | null
  family: { name: string }
}

export function BirthdayWidget({ birthdays, truncated = false }: { birthdays: BirthdayPerson[]; truncated?: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">🎂 Birthdays this week</CardTitle>
      </CardHeader>
      <CardContent>
        {birthdays.length === 0 ? (
          <p className="text-sm text-muted-foreground">No birthdays in the next 7 days</p>
        ) : (
          <ul className="space-y-2">
            {birthdays.map((p) => (
              <li key={p.id} className="flex justify-between text-sm">
                <span>
                  {p.firstName} {p.lastName}
                </span>
                <span className="text-muted-foreground">
                  {p.dateOfBirth?.toLocaleDateString(APP_LOCALE, {
                    day: "2-digit",
                    month: "2-digit",
                    timeZone: "UTC",
                  })}
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
