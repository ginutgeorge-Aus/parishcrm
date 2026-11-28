import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SlotCell } from "@/components/roster/SlotCell"
import { openPlaces } from "@/lib/roster"
import type { RosterAssignmentStatus } from "@/lib/generated/prisma/enums"

type SlotCardSlot = {
  id: number
  needed: number
  role: { name: string }
  assignments: { id: number; status: RosterAssignmentStatus; person: { firstName: string; lastName: string } }[]
}

/**
 * One role's card on a service page: title with filled/needed count and the
 * assign/remove cell. Shared by the staff roster and the organiser portal.
 * @param canRemoveDeclined false hides Remove on DECLINED rows (organisers cannot clear a decline)
 */
export function SlotCard({ slot, canRemoveDeclined = true }: Readonly<{ slot: SlotCardSlot; canRemoveDeclined?: boolean }>) {
  const open = openPlaces(slot.needed, slot.assignments.map((a) => a.status))
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {slot.role.name} <span className="font-normal text-muted-foreground">({slot.needed - open}/{slot.needed})</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <SlotCell
          slotId={slot.id}
          open={open}
          canRemoveDeclined={canRemoveDeclined}
          assignments={slot.assignments.map((a) => ({ id: a.id, name: `${a.person.firstName} ${a.person.lastName}`, status: a.status }))}
        />
      </CardContent>
    </Card>
  )
}
