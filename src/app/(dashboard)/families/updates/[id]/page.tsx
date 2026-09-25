import { auth } from "@/auth"
import { redirect, notFound } from "next/navigation"
import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { canEdit } from "@/lib/roleGuard"
import { isValidPgId } from "@/lib/validation"
import { safeDecrypt } from "@/lib/crypto"
import { diffFamilyUpdate } from "@/lib/familyUpdateDiff"
import { FamilyUpdatePayloadSchema, type FamilyUpdatePayload } from "@/lib/familyUpdatePayload"
import { SubmissionReview } from "@/components/family-update/SubmissionReview"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type Props = { params: Promise<{ id: string }> }

export default async function SubmissionDetail(props: Props) {
  const session = await auth()
  if (!session) redirect("/login")
  if (!canEdit(session.user.role)) redirect("/families")

  const id = Number((await props.params).id)
  // Upper-bound too: an id past int4 max reaches Postgres as a raw range error
  // (500) instead of a clean not-found (security.md route-param check).
  if (!isValidPgId(id)) notFound()

  const sub = await prisma.familyUpdateSubmission.findUnique({
    where: { id },
    include: {
      family: {
        include: {
          // select only the columns the current-values diff reads — never the
          // encrypted pastoralNotes/emergencyContact/notes/hash columns.
          people: {
            where: { archivedAt: null },
            orderBy: { id: "asc" },
            select: {
              id: true, title: true, firstName: true, middleName: true,
              lastName: true, suffix: true, gender: true, dateOfBirth: true,
              email: true, mobile: true, workPhone: true, homePhone: true,
            },
          },
        },
      },
    },
  })
  if (!sub || sub.family.archivedAt) notFound()

  // Payload is encrypted at rest; decode before validating. Legacy rows
  // stored a plaintext JSON object — use it directly when not an enc string.
  let rawPayload: unknown = sub.payload
  if (typeof rawPayload === "string") {
    try {
      rawPayload = JSON.parse(safeDecrypt(rawPayload))
    } catch {
      return <p className="text-destructive">This submission is malformed.</p>
    }
  }
  const parsed = FamilyUpdatePayloadSchema.safeParse(rawPayload)
  if (!parsed.success) return <p className="text-destructive">This submission is malformed.</p>

  const dec = (v: string | null) => (v ? safeDecrypt(v) || null : null)
  const f = sub.family
  // Typed as the diff input so a missing field or signature change is caught at
  // build time. Only `gender` needs a cast: the Prisma `Gender` enum is
  // nominally distinct from the payload's "MALE"|"FEMALE"|"OTHER" string union
  // even though the values are identical.
  const current: FamilyUpdatePayload = {
    family: {
      address: dec(f.address),
      suburb: dec(f.suburb),
      state: dec(f.state),
      postcode: dec(f.postcode),
      homePhone: dec(f.homePhone),
      marriageDate: f.marriageDate ? f.marriageDate.toISOString().slice(0, 10) : null,
    },
    members: f.people.map((p) => ({
      personId: p.id,
      title: p.title,
      firstName: p.firstName,
      middleName: p.middleName,
      lastName: p.lastName,
      suffix: p.suffix,
      gender: p.gender as FamilyUpdatePayload["members"][number]["gender"],
      dateOfBirth: dec(p.dateOfBirth),
      email: dec(p.email),
      mobile: dec(p.mobile),
      workPhone: dec(p.workPhone),
      homePhone: dec(p.homePhone),
    })),
  }
  const diff = diffFamilyUpdate(current, parsed.data)

  return (
    <div className="max-w-3xl space-y-6">
      <p className="text-sm text-muted-foreground mb-1">
        <Link href="/families/updates" className="hover:underline">Family update requests</Link>
        {" / "}
        <Link href={`/families/${f.id}`} className="hover:underline">{f.name}</Link>
      </p>
      <h2 className="text-2xl font-semibold">{f.name} — proposed updates</h2>
      {sub.status !== "PENDING" && <p className="text-warning">Already {sub.status.toLowerCase()}.</p>}

      <section>
        <h3 className="font-medium mb-2">Family contact</h3>
        <DiffTable rows={diff.family} />
      </section>
      {diff.members.map((m, i) => (
        <section key={i}>
          <h3 className="font-medium mb-2">
            {m.label}{" "}
            {m.isNew && <span className="text-xs bg-income/10 text-income px-2 py-0.5 rounded">NEW</span>}
          </h3>
          <DiffTable rows={m.fields} />
        </section>
      ))}

      {sub.status === "PENDING" && <SubmissionReview submissionId={sub.id} />}
    </div>
  )
}

function DiffTable({ rows }: { rows: { field: string; from: string | null; to: string | null; changed: boolean }[] }) {
  const shown = rows.filter((r) => r.changed)
  if (shown.length === 0) return <p className="text-sm text-muted-foreground">No changes.</p>
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-table-narrow border rounded-md">
        <TableHeader>
          <TableRow>
            <TableHead>Field</TableHead>
            <TableHead>Current</TableHead>
            <TableHead>Proposed</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((r) => (
            <TableRow key={r.field}>
              <TableCell className="font-medium">{r.field}</TableCell>
              <TableCell className="text-muted-foreground">{r.from ?? "—"}</TableCell>
              <TableCell className="text-success">{r.to ?? "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
