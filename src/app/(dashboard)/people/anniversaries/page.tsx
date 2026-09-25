import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { safeDecrypt } from "@/lib/crypto"
import { canEdit, canViewPeople } from "@/lib/roleGuard"
import { upcomingAnniversaries, ANNIVERSARY_WINDOWS, type AnniversaryFamily, type FamilyRoleLite } from "@/lib/anniversaries"
import { AnniversariesClient } from "@/components/people/AnniversariesClient"
import { sydneyToday } from "@/lib/dates"
import { PERSON_FETCH_CAP } from "@/lib/constants"

export default async function AnniversariesPage(props: { searchParams: Promise<{ window?: string }> }) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (!canViewPeople(session.user.role)) redirect("/")

  const searchParams = await props.searchParams
  const parsed = parseInt(searchParams.window ?? "", 10)
  const windowDays = (ANNIVERSARY_WINDOWS as readonly number[]).includes(parsed) ? parsed : 7

  const rows = await prisma.family.findMany({
    where: { marriageDate: { not: null }, archivedAt: null },
    // One past the cap detects truncation; deterministic order.
    orderBy: { id: "asc" },
    take: PERSON_FETCH_CAP + 1,
    select: {
      id: true, name: true, marriageDate: true,
      people: { where: { archivedAt: null, role: { in: ["HEAD", "SPOUSE"] } }, select: { id: true, firstName: true, role: true, email: true, emailConsent: true } },
    },
  })

  const truncated = rows.length > PERSON_FETCH_CAP
  const families: AnniversaryFamily[] = rows.slice(0, PERSON_FETCH_CAP).map((f) => ({
    id: f.id, name: f.name, marriageDate: f.marriageDate as Date,
    people: f.people.map((p) => ({ id: p.id, firstName: p.firstName, role: p.role as FamilyRoleLite, email: p.email ? safeDecrypt(p.email) : null, emailConsent: p.emailConsent })),
  }))

  const upcoming = upcomingAnniversaries(families, windowDays, sydneyToday())
  const clientRows = upcoming.map((d) => {
    const hasEmail = d.recipients.some((r) => r.email && r.email !== "[decryption error]")
    const emailConsent = d.recipients.some((r) => r.emailConsent && r.email && r.email !== "[decryption error]")
    return { familyId: d.familyId, names: d.coupleNames, family: d.familyName, date: d.dateLabel, years: d.yearsMarried, hasEmail, emailConsent }
  })

  return <AnniversariesClient rows={clientRows} windowDays={windowDays} canEdit={canEdit(session.user.role)} truncated={truncated} />
}
