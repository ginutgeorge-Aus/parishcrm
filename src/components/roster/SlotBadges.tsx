import { Badge } from "@/components/ui/badge"
import { openPlaces } from "@/lib/roster"
import type { RosterAssignmentStatus } from "@/lib/generated/prisma/enums"

type SlotBadgeSlot = {
  id: number
  needed: number
  role: { name: string }
  assignments: { status: RosterAssignmentStatus }[]
}

/**
 * Filled/needed badge per role on a service list card. Shared by the staff
 * roster list and the organiser portal list.
 */
export function SlotBadges({ slots }: Readonly<{ slots: SlotBadgeSlot[] }>) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {slots.map((sl) => {
        const open = openPlaces(sl.needed, sl.assignments.map((a) => a.status))
        return (
          <li key={sl.id}>
            <Badge variant={open === 0 ? "secondary" : "outline"}>
              {sl.role.name}: {sl.needed - open}/{sl.needed}
            </Badge>
          </li>
        )
      })}
    </ul>
  )
}
