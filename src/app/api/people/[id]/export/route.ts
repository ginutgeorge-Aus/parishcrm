import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { prisma } from "@/lib/prisma"
import { isAdmin } from "@/lib/roleGuard"
import { safeDecrypt } from "@/lib/crypto"
import { decryptOrNull } from "@/lib/nullableCrypto"
import {
  resolveEmailHash,
  decryptPersonScalars,
  decryptFamilyScalars,
  decryptTransactionForExport,
  decryptRegistrationForExport,
  decryptClearanceForExport,
} from "@/lib/personExport"
import { logAudit } from "@/lib/audit"
import { auditIpFromRequest } from "@/lib/clientIp"
import { rateLimit } from "@/lib/rateLimit"
import { parseRouteId } from "@/lib/validation"

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!isAdmin(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (!rateLimit(`export:person:${actorId(session)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const id = parseRouteId(params.id)
  if (id === null) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 })
  }

  const person = await prisma.person.findFirst({
    // findFirst (not findUnique): exclude archived (soft-deleted) people, matching
    // every list/detail view — an archived member was still exportable by id
    // (AUDIT-048). findUnique rejects the non-unique archivedAt predicate.
    where: { id, archivedAt: null },
    include: {
      family: true,
      // Explicit select: never pull the encrypted `document` blob into the export.
      clearances: {
        orderBy: { type: "asc" },
        select: {
          type: true,
          number: true,
          expiresAt: true,
          documentName: true,
          documentType: true,
          documentSize: true,
          verifiedAt: true,
          verifiedBy: { select: { name: true } },
          verificationNote: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      rosterAssignments: {
        orderBy: { createdAt: "desc" },
        select: {
          status: true,
          respondedAt: true,
          createdAt: true,
          slot: { select: { role: { select: { name: true } }, service: { select: { title: true, date: true } } } },
        },
      },
      unavailability: {
        orderBy: { startDate: "desc" },
        select: { startDate: true, endDate: true, createdAt: true },
      },
      transactions: {
        orderBy: { date: "desc" },
        include: {
          receiptSends: { orderBy: { sentAt: "desc" } },
        },
      },
    },
  })
  if (!person) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Registration.email is encrypted (random IV), so it can't be matched on the
  // ciphertext. Both tables carry a deterministic blind index (emailHash),
  // so the match is now an indexed `WHERE emailHash = person.emailHash` — no
  // full-table scan, no decrypt-and-compare, no `take` cap (the old approach
  // missed registrations beyond the 10k most-recent rows). Correct
  // regardless of whether the registration or the person record came first.
  const personEmail = person.email ? safeDecrypt(person.email) : null
  // gemini-nightly: emailHash is set on every write since, but a
  // record predating that change (or one the one-time backfill hasn't
  // reached yet) can have `email` set with `emailHash` still null — deriving
  // it on the fly here keeps this export complete for those legacy rows too.
  const effectiveEmailHash = resolveEmailHash(person.emailHash, personEmail)
  const registrations = effectiveEmailHash
    ? await prisma.registration.findMany({
        where: { emailHash: effectiveEmailHash },
        include: { items: { include: { ticketType: { select: { name: true } } } } },
        orderBy: { createdAt: "desc" },
      })
    : []

  // Sacramental register entries where this person is the subject or the CRM
  // spouse, with the encrypted spouseName/godparents/notes decrypted (the
  // person-export contract covers every PII field held about them).
  const sacramentRows = await prisma.sacramentRecord.findMany({
    where: { OR: [{ personId: id }, { spouseId: id }] },
    orderBy: [{ date: "asc" }, { id: "asc" }],
    select: {
      registerNo: true,
      type: true,
      date: true,
      place: true,
      ministerName: true,
      personId: true,
      spouseId: true,
      spouseName: true,
      godparents: true,
      notes: true,
      createdAt: true,
    },
  })
  const sacraments = sacramentRows.map((r) => ({
    ...r,
    spouseName: decryptOrNull(r.spouseName),
    godparents: decryptOrNull(r.godparents),
    notes: decryptOrNull(r.notes),
  }))

  // `clearances` and `transactions` are exported via their own decrypted
  // sections; keep the raw (encrypted) rows out of the spread person object.
  const { clearances, transactions, rosterAssignments, unavailability, ...personRest } = person
  const data = {
    person: {
      ...decryptPersonScalars(personRest),
      email: personEmail,
      family: person.family ? decryptFamilyScalars(person.family) : null,
    },
    transactions: transactions.map(decryptTransactionForExport),
    registrations: registrations.map(decryptRegistrationForExport),
    clearances: clearances.map(decryptClearanceForExport),
    rosterAssignments,
    unavailability,
    sacraments,
    exportedAt: new Date().toISOString(),
  }

  const ip = auditIpFromRequest(req)
  await logAudit(
    actorId(session),
    "PERSON_EXPORTED",
    "Person",
    id,
    { exportedFields: ["dateOfBirth", "mobile", "workPhone", "homePhone", "pastoralNotes", "emergencyContactName", "emergencyContactPhone", "familyFields", "transactionDescriptions", "transactionNotes", "receiptSentTo", "registrationCustomAnswers", "clearances", "rosterAssignments", "unavailability", "sacraments", "sacramentSpouseName", "sacramentGodparents", "sacramentNotes"] },
    ip
  )

  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="member-${id}.json"`,
      "cache-control": "no-store",
    },
  })
}
