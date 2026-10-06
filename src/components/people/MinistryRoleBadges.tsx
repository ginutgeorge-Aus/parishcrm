import { Badge } from "@/components/ui/badge"
import type { MinistryRole } from "@/lib/generated/prisma/enums"
import { MINISTRY_ROLE_LABELS } from "@/lib/ministryRoles"

/**
 * Read-only badges for a person's ministry roles. Renders nothing for an
 * empty list (callers that add their own label still gate on length).
 */
export function MinistryRoleBadges({ roles }: Readonly<{ roles: MinistryRole[] }>) {
  if (roles.length === 0) return null
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Ministry roles">
      {roles.map((r) => (
        <li key={r}>
          <Badge variant="outline">{MINISTRY_ROLE_LABELS[r]}</Badge>
        </li>
      ))}
    </ul>
  )
}
