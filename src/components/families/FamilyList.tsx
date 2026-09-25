import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { FamilyStatus } from "@/lib/generated/prisma/enums"
import { FAMILY_STATUS_LABELS } from "@/lib/familyLabels"

type Family = {
  id: number
  name: string
  memberNo: string | null
  suburb: string | null
  status: FamilyStatus
  _count: { people: number }
}

const statusVariant: Record<FamilyStatus, "default" | "secondary" | "outline"> = {
  ACTIVE: "default",
  INACTIVE: "secondary",
  VISITOR: "outline",
}

export function FamilyList({
  families,
  canEdit,
}: {
  families: Family[]
  canEdit: boolean
}) {
  return (
    <>
      {/* Mobile: stacked cards */}
      <ul className="space-y-3 md:hidden">
        {families.length === 0 && (
          <li className="rounded-lg border bg-card py-12 text-center">
            <p className="font-medium">No families found</p>
            <p className="mt-1 text-sm text-muted-foreground">Try adjusting your search, or add a new family.</p>
          </li>
        )}
        {families.map((f) => (
          <li key={f.id}>
            <Link
              href={`/families/${f.id}`}
              className="block rounded-lg border bg-card p-4 active:bg-muted"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium">{f.name}</span>
                <Badge variant={statusVariant[f.status]}>{FAMILY_STATUS_LABELS[f.status]}</Badge>
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {f.memberNo ?? "—"}
                {f.suburb ? ` · ${f.suburb}` : ""} · {f._count.people}{" "}
                {f._count.people === 1 ? "member" : "members"}
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {/* Desktop: table */}
      <div className="hidden overflow-x-auto md:block">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Member No</TableHead>
            <TableHead>Suburb</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Members</TableHead>
            <TableHead className="w-24 print:hidden"><span className="sr-only">Actions</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {families.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="py-12 text-center">
                <p className="font-medium">No families found</p>
                <p className="mt-1 text-sm text-muted-foreground">Try adjusting your search, or add a new family.</p>
              </TableCell>
            </TableRow>
          )}
          {families.map((f) => (
            <TableRow key={f.id}>
              <TableCell className="font-medium">{f.name}</TableCell>
              <TableCell>{f.memberNo ?? "—"}</TableCell>
              <TableCell>{f.suburb ?? "—"}</TableCell>
              <TableCell>
                <Badge variant={statusVariant[f.status]}>{FAMILY_STATUS_LABELS[f.status]}</Badge>
              </TableCell>
              <TableCell>{f._count.people}</TableCell>
              <TableCell className="print:hidden">
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/families/${f.id}`}>View</Link>
                  </Button>
                  {canEdit && (
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/families/${f.id}/edit`}>Edit</Link>
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </div>
    </>
  )
}
