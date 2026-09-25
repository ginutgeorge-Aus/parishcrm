import { calendarDateInYear } from "@/lib/observedDate"

// Lives here (pure module), NOT in the "use server" action file — a "use server"
// module may only export async functions, so a plain const export there breaks the build.
export const ANNIVERSARY_WINDOWS = [7, 14, 30] as const

export type FamilyRoleLite = "HEAD" | "SPOUSE" | "CHILD" | "OTHER"
type AnniversaryPerson = { id: number; firstName: string; role: FamilyRoleLite; email: string | null; emailConsent: boolean }
export type AnniversaryFamily = { id: number; name: string; marriageDate: Date; people: AnniversaryPerson[] }
export type DueAnniversary = { familyId: number; familyName: string; yearsMarried: number; daysUntil: number; dateLabel: string; coupleNames: string; recipients: AnniversaryPerson[] }

function coupleOf(people: AnniversaryPerson[]): AnniversaryPerson[] {
  const couple = people.filter((p) => p.role === "HEAD" || p.role === "SPOUSE")
  return [...couple].sort((a, b) => (a.role === "HEAD" ? -1 : 1) - (b.role === "HEAD" ? -1 : 1))
}

// Whole years at the upcoming (this-year-or-next) occurrence of the anniversary.
export function anniversaryYears(marriageDate: Date, today: Date): number {
  const start = new Date(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  const occ = calendarDateInYear(start.getFullYear(), marriageDate.getUTCMonth(), marriageDate.getUTCDate())
  const occYear = occ < start ? start.getFullYear() + 1 : start.getFullYear()
  return occYear - marriageDate.getUTCFullYear()
}

// Families whose next anniversary falls within [today, today+windowDays], 1st anniversary onward.
export function upcomingAnniversaries(families: AnniversaryFamily[], windowDays: number, today: Date): DueAnniversary[] {
  const start = new Date(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  const out: DueAnniversary[] = []
  for (const f of families) {
    const m = f.marriageDate
    if (Number.isNaN(m.getTime())) continue
    let occ = calendarDateInYear(start.getFullYear(), m.getUTCMonth(), m.getUTCDate())
    if (occ < start) occ = calendarDateInYear(start.getFullYear() + 1, m.getUTCMonth(), m.getUTCDate())
    const daysUntil = Math.round((occ.getTime() - start.getTime()) / 86_400_000)
    if (daysUntil < 0 || daysUntil > windowDays) continue
    const yearsMarried = occ.getFullYear() - m.getUTCFullYear()
    if (yearsMarried < 1) continue // skip the wedding year itself
    const couple = coupleOf(f.people)
    if (couple.length === 0) continue
    const dateLabel = `${String(m.getUTCDate()).padStart(2, "0")}/${String(m.getUTCMonth() + 1).padStart(2, "0")}`
    out.push({ familyId: f.id, familyName: f.name, yearsMarried, daysUntil, dateLabel, coupleNames: couple.map((p) => p.firstName).join(" and "), recipients: couple })
  }
  return out.sort((a, b) => a.daysUntil - b.daysUntil)
}
