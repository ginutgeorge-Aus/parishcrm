import { calendarDateInYear } from "@/lib/observedDate"
import type { Gender } from "@/lib/pronouns"

export const BIRTHDAY_WINDOWS = [7, 14, 30] as const

export type BirthdayPerson = {
  id: number
  firstName: string
  lastName: string
  dateOfBirth: Date
  email: string | null
  emailConsent: boolean
  gender?: Gender | null
  family: { name: string }
}

export type UpcomingBirthday = BirthdayPerson & {
  ageTurning: number
  daysUntil: number
}

// Returns people whose birthday (month/day) falls within [today, today+windowDays]
// inclusive, handling year-end wrap. ageTurning = age on that next birthday.
// daysUntil = whole days from today (0 = today). Sorted by daysUntil ascending.
export function upcomingBirthdays(
  people: BirthdayPerson[],
  windowDays: number,
  today: Date,
): UpcomingBirthday[] {
  // `today` (from callers like sydneyToday()) is a UTC-midnight instant encoding
  // a calendar date — read it via UTC getters, same as `dob` below, so the
  // window doesn't shift a day on a host whose local timezone isn't UTC.
  const start = new Date(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  const result: UpcomingBirthday[] = []

  for (const p of people) {
    const dob = p.dateOfBirth
    if (Number.isNaN(dob.getTime())) continue

    // DOB is stored UTC-midnight; read month/day/year via UTC getters so the
    // calendar day never shifts by the server's local offset. `start`
    // stays in the local frame `next` is built in — the comparison is consistent.
    const month = dob.getUTCMonth()
    const day = dob.getUTCDate()
    let next = calendarDateInYear(start.getFullYear(), month, day)
    if (next < start) next = calendarDateInYear(start.getFullYear() + 1, month, day)

    const daysUntil = Math.round((next.getTime() - start.getTime()) / 86_400_000)
    if (daysUntil < 0 || daysUntil > windowDays) continue

    result.push({
      ...p,
      daysUntil,
      ageTurning: next.getFullYear() - dob.getUTCFullYear(),
    })
  }

  return result.sort((a, b) => a.daysUntil - b.daysUntil)
}
