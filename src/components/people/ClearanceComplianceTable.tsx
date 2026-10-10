import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { MINISTRY_ROLE_LABELS } from "@/lib/ministryRoles"
import { CLEARANCE_STATUS_LABELS, CLEARANCE_STATUS_VARIANT, dmy } from "@/lib/clearanceComplianceView"
import type { ComplianceCell, ComplianceRow } from "@/lib/clearanceCompliance"

/** Status badge plus expiry date for one clearance type; a dash when not required and none on file. */
function StatusCell({ cell }: Readonly<{ cell: ComplianceCell }>) {
  if (!cell.status) return <span className="text-muted-foreground">—</span>
  return (
    <div className="flex flex-col gap-0.5">
      <Badge variant={CLEARANCE_STATUS_VARIANT[cell.status]}>{CLEARANCE_STATUS_LABELS[cell.status]}</Badge>
      {cell.expiresAt && <span className="text-xs text-muted-foreground">Expires {dmy(cell.expiresAt)}</span>}
    </div>
  )
}

/**
 * Read-only compliance table: one row per person with their WWCC and Safe
 * Ministry status. Names link to the profile where staff upload and verify.
 * Carries no WWC numbers or dates of birth. `filtered` only picks the
 * empty-state wording.
 */
export function ClearanceComplianceTable({ rows, filtered = false }: Readonly<{ rows: ComplianceRow[]; filtered?: boolean }>) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Person</TableHead>
          <TableHead>Family</TableHead>
          <TableHead>Ministry roles</TableHead>
          <TableHead>WWCC</TableHead>
          <TableHead>Safe Ministry</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={5} className="text-center text-muted-foreground">
              {filtered
                ? "Nobody matches this filter."
                : "Nobody to list. Tag people with a ministry role on their profile to track their clearances."}
            </TableCell>
          </TableRow>
        )}
        {rows.map((r) => (
          <TableRow key={r.personId}>
            <TableCell>
              <Link className="font-medium hover:underline" href={`/people/${r.personId}`}>
                {r.lastName}, {r.firstName}
              </Link>
            </TableCell>
            <TableCell>{r.familyName}</TableCell>
            <TableCell>{r.ministryRoles.map((m) => MINISTRY_ROLE_LABELS[m]).join(", ") || "—"}</TableCell>
            <TableCell><StatusCell cell={r.wwcc} /></TableCell>
            <TableCell><StatusCell cell={r.safeMinistry} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
