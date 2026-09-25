import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { safeDecrypt } from "@/lib/crypto"
import { safeDobDate } from "@/lib/formatting"
import { APP_LOCALE } from "@/lib/appConfig"
import { canEdit, canViewPeople } from "@/lib/roleGuard"
import { upcomingBirthdays, BIRTHDAY_WINDOWS, type BirthdayPerson } from "@/lib/birthdays"
import { BirthdaysClient } from "@/components/people/BirthdaysClient"
import { sydneyToday } from "@/lib/dates"
import { PERSON_FETCH_CAP } from "@/lib/constants"

export default async function BirthdaysPage(props: {
  searchParams: Promise<{ window?: string }>
}) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (!canViewPeople(session.user.role)) redirect("/")

  const searchParams = await props.searchParams
  const parsed = parseInt(searchParams.window ?? "", 10)
  const windowDays = (BIRTHDAY_WINDOWS as readonly number[]).includes(parsed) ? parsed : 7

  const rows = await prisma.person.findMany({
    where: { dateOfBirth: { not: null }, archivedAt: null },
    // Safety net: cap decryption cost. One past the cap detects
    // truncation; deterministic order so the kept set is stable.
    orderBy: { id: "asc" },
    take: PERSON_FETCH_CAP + 1,
    select: {
      id: true, firstName: true, lastName: true, dateOfBirth: true,
      email: true, emailConsent: true, family: { select: { name: true } },
    },
  })

  const truncated = rows.length > PERSON_FETCH_CAP
  const people: BirthdayPerson[] = rows
    .slice(0, PERSON_FETCH_CAP)
    .map((p) => {
      // safeDecrypt returns '[decryption error]' on a bad/rotated-away
      // ciphertext; new Date() of that is Invalid Date, which corrupts the
      // window calc and sort for the whole batch. Drop the record.
      const dateOfBirth = safeDobDate(safeDecrypt(p.dateOfBirth as string))
      if (dateOfBirth === null) return null
      return {
        id: p.id,
        firstName: p.firstName,
        lastName: p.lastName,
        dateOfBirth,
        email: p.email ? safeDecrypt(p.email) : null,
        emailConsent: p.emailConsent,
        family: p.family,
      }
    })
    .filter((p): p is BirthdayPerson => p !== null)

  const upcoming = upcomingBirthdays(people, windowDays, sydneyToday())

  const clientRows = upcoming.map((p) => ({
    id: p.id,
    name: `${p.firstName} ${p.lastName}`,
    family: p.family.name,
    dob: new Intl.DateTimeFormat(APP_LOCALE, {
      day: "2-digit",
      month: "2-digit",
      timeZone: "UTC",
    }).format(p.dateOfBirth),
    ageTurning: p.ageTurning,
    hasEmail: !!p.email,
    emailConsent: p.emailConsent,
  }))

  return (
    <BirthdaysClient
      rows={clientRows}
      windowDays={windowDays}
      canEdit={canEdit(session.user.role)}
      truncated={truncated}
    />
  )
}
