import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { prisma } from "@/lib/prisma"
import { isAdmin } from "@/lib/roleGuard"
import { safeDecrypt } from "@/lib/crypto"
import { resolveEmailHash } from "@/lib/personExport"
import { logAudit } from "@/lib/audit"
import { getClientIp } from "@/lib/clientIp"
import { rateLimit } from "@/lib/rateLimit"

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

  const id = parseInt(params.id, 10)
  if (isNaN(id) || id <= 0 || id > 2147483647) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 })
  }

  const person = await prisma.person.findFirst({
    // findFirst (not findUnique): exclude archived (soft-deleted) people, matching
    // every list/detail view — an archived member was still exportable by id
    // (AUDIT-048). findUnique rejects the non-unique archivedAt predicate.
    where: { id, archivedAt: null },
    include: {
      family: true,
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

  const data = {
    person: {
      ...person,
      email: personEmail,
      // safeDecrypt throughout: one corrupt field becomes a placeholder rather
      // than 500-ing the whole export.
      dateOfBirth: person.dateOfBirth ? safeDecrypt(person.dateOfBirth) : null,
      mobile: person.mobile ? safeDecrypt(person.mobile) : null,
      workPhone: person.workPhone ? safeDecrypt(person.workPhone) : null,
      homePhone: person.homePhone ? safeDecrypt(person.homePhone) : null,
      notes: person.notes ? safeDecrypt(person.notes) : null,
      pastoralNotes: person.pastoralNotes ? safeDecrypt(person.pastoralNotes) : null,
      emergencyContactName: person.emergencyContactName ? safeDecrypt(person.emergencyContactName) : null,
      emergencyContactPhone: person.emergencyContactPhone ? safeDecrypt(person.emergencyContactPhone) : null,
      family: person.family
        ? {
            ...person.family,
            address: person.family.address ? safeDecrypt(person.family.address) : null,
            suburb: person.family.suburb ? safeDecrypt(person.family.suburb) : null,
            state: person.family.state ? safeDecrypt(person.family.state) : null,
            postcode: person.family.postcode ? safeDecrypt(person.family.postcode) : null,
            homePhone: person.family.homePhone ? safeDecrypt(person.family.homePhone) : null,
            notes: person.family.notes ? safeDecrypt(person.family.notes) : null,
          }
        : null,
    },
    transactions: person.transactions.map((tx) => ({
      ...tx,
      amount: tx.amount.toString(),
      description: safeDecrypt(tx.description),
      receiptSends: tx.receiptSends.map((rs) => ({ ...rs, sentTo: safeDecrypt(rs.sentTo) })),
    })),
    registrations: registrations.map((r) => ({
      ...r,
      email: r.email ? safeDecrypt(r.email) : null,
      phone: r.phone ? safeDecrypt(r.phone) : null,
      // customAnswers is encrypted-whole as a JSON string scalar. Decrypt
      // + parse so a data-portability export returns the member's real answers,
      // not opaque ciphertext. Legacy plaintext-object rows pass through.
      customAnswers: r.customAnswers
        ? typeof r.customAnswers === "string"
          ? (() => {
              try {
                return JSON.parse(safeDecrypt(r.customAnswers as string))
              } catch {
                return null
              }
            })()
          : r.customAnswers
        : null,
    })),
    exportedAt: new Date().toISOString(),
  }

  const ip = getClientIp(req)
  await logAudit(
    actorId(session),
    "PERSON_EXPORTED",
    "Person",
    id,
    { exportedFields: ["dateOfBirth", "mobile", "workPhone", "homePhone", "pastoralNotes", "emergencyContactName", "emergencyContactPhone", "familyFields", "transactionDescriptions", "receiptSentTo", "registrationCustomAnswers"] },
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
