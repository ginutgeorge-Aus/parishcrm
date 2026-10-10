import "server-only"
import { prisma } from "@/lib/prisma"
import { ymdToDbDate, type RollRow } from "@/lib/sundaySchoolRollView"

type Named = { id: number; firstName: string; lastName: string }

/**
 * Load one class's roll for a date: currently enrolled (non-archived) children
 * plus anyone already marked in that session, names only, sorted by last name.
 * Returns null when the class does not exist. Callers gate access first.
 */
export async function loadRoll(classId: number, ymd: string) {
  const date = ymdToDbDate(ymd)
  const named = { select: { id: true, firstName: true, lastName: true } } as const
  const cls = await prisma.sundaySchoolClass.findUnique({
    where: { id: classId },
    select: {
      id: true, name: true, year: true, location: true, archivedAt: true,
      enrolments: { where: { person: { archivedAt: null } }, select: { person: named } },
      sessions: { where: { date }, select: { attendance: { select: { status: true, person: named } } } },
    },
  })
  if (!cls) return null

  const byId = new Map<number, RollRow & { person: Named }>()
  for (const { person } of cls.enrolments) {
    byId.set(person.id, { personId: person.id, name: fullName(person), status: null, enrolled: true, person })
  }
  for (const { status, person } of cls.sessions[0]?.attendance ?? []) {
    const row = byId.get(person.id)
    if (row) row.status = status
    else byId.set(person.id, { personId: person.id, name: fullName(person), status, enrolled: false, person })
  }
  const rows: RollRow[] = [...byId.values()]
    .sort((a, b) => a.person.lastName.localeCompare(b.person.lastName) || a.person.firstName.localeCompare(b.person.firstName))
    .map(({ personId, name, status, enrolled }) => ({ personId, name, status, enrolled }))

  return {
    cls: { id: cls.id, name: cls.name, year: cls.year, location: cls.location, archived: cls.archivedAt !== null },
    rows,
  }
}

/** "First Last". */
function fullName(p: Named): string {
  return `${p.firstName} ${p.lastName}`.trim()
}
