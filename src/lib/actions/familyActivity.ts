import { prisma } from "@/lib/prisma"
import { safeDecrypt } from "@/lib/crypto"
import { maskEmail } from "@/lib/formatting"

const FAMILY_ACTIONS = [
  "FAMILY_CREATED", "FAMILY_UPDATED", "FAMILY_UPDATE_APPROVED",
  "FAMILY_ARCHIVED", "FAMILY_UNARCHIVED", "FAMILY_MERGED",
]
const PERSON_ACTIONS = ["PERSON_CREATED", "PERSON_UPDATED", "PERSON_DELETED"]

type LastUpdate = { at: Date; actorLabel: string; kind: "admin" | "self-update" | "unknown" }

// Most-recent change to a family OR any of its members, with a display-safe
// actor label. Read-only; callers gate on canEdit. Never throws on missing
// related rows — falls back to a generic label / Family.updatedAt.
export async function getFamilyLastUpdate(familyId: number): Promise<LastUpdate | null> {
  const row = await prisma.auditLog.findFirst({
    where: {
      OR: [
        { resourceType: "Family", resourceId: familyId, action: { in: FAMILY_ACTIONS } },
        { resourceType: "Person", action: { in: PERSON_ACTIONS }, metadata: { path: ["familyId"], equals: familyId } },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: { action: true, createdAt: true, metadata: true, user: { select: { name: true } } },
  })

  if (!row) {
    const fam = await prisma.family.findUnique({ where: { id: familyId }, select: { updatedAt: true } })
    if (!fam) return null
    return { at: fam.updatedAt, actorLabel: "—", kind: "unknown" }
  }

  if (row.action === "FAMILY_UPDATE_APPROVED") {
    const submissionId = (row.metadata as { submissionId?: number } | null)?.submissionId
    let label = "via self-update invite"
    if (typeof submissionId === "number") {
      const sub = await prisma.familyUpdateSubmission.findUnique({
        where: { id: submissionId },
        select: { invite: { select: { email: true } } },
      })
      if (sub?.invite?.email) label = `via self-update invite (${maskEmail(safeDecrypt(sub.invite.email))})`
    }
    return { at: row.createdAt, actorLabel: label, kind: "self-update" }
  }

  return { at: row.createdAt, actorLabel: row.user?.name ?? "an administrator", kind: "admin" }
}
