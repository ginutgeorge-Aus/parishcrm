import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { GROUP_CATEGORY_LABELS } from "@/lib/groups"
import type { GroupCategory, GroupMemberRole } from "@/lib/generated/prisma/enums"

export type PersonGroup = { id: number; name: string; category: GroupCategory; role: GroupMemberRole; title: string }

/** Person page "Groups" card: the live groups this person belongs to, with role and title. */
export function PersonGroupsCard({ groups }: Readonly<{ groups: PersonGroup[] }>) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Groups</CardTitle></CardHeader>
      <CardContent className="text-sm">
        {groups.length === 0 ? (
          <p className="text-muted-foreground">Not in any group.</p>
        ) : (
          <ul className="divide-y divide-border">
            {groups.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2">
                <Link href={`/groups/${g.id}`} className="font-medium hover:underline">{g.name}</Link>
                <span className="text-muted-foreground">{GROUP_CATEGORY_LABELS[g.category]}</span>
                {g.role === "LEADER" && <Badge variant="secondary">Leader</Badge>}
                {g.title && <span className="text-muted-foreground">· {g.title}</span>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
