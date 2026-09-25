import type { FamilyUpdatePayload, FamilyUpdateMember } from "./familyUpdatePayload"

type FieldDiff = { field: string; from: string | null; to: string | null; changed: boolean }
type MemberDiff = { personId?: number; isNew: boolean; label: string; fields: FieldDiff[] }
export type SubmissionDiff = { family: FieldDiff[]; members: MemberDiff[] }

const FAMILY_FIELDS = ["address", "suburb", "state", "postcode", "homePhone", "marriageDate"] as const
const MEMBER_FIELDS = [
  "title", "firstName", "middleName", "lastName", "suffix",
  "gender", "dateOfBirth", "email", "mobile", "workPhone", "homePhone",
] as const

function norm(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null
  return String(v)
}

function fieldDiff(field: string, from: unknown, to: unknown): FieldDiff {
  const f = norm(from)
  const t = norm(to)
  return { field, from: f, to: t, changed: f !== t }
}

export function diffFamilyUpdate(current: FamilyUpdatePayload, proposed: FamilyUpdatePayload): SubmissionDiff {
  const family = FAMILY_FIELDS.map((f) =>
    fieldDiff(f, (current.family as Record<string, unknown>)[f], (proposed.family as Record<string, unknown>)[f])
  )
  const currentById = new Map<number, FamilyUpdateMember>()
  for (const m of current.members) if (m.personId) currentById.set(m.personId, m)
  const members: MemberDiff[] = proposed.members.map((p) => {
    const existing = p.personId ? currentById.get(p.personId) : undefined
    const fields = MEMBER_FIELDS.map((f) =>
      fieldDiff(f, existing ? (existing as Record<string, unknown>)[f] : undefined, (p as Record<string, unknown>)[f])
    )
    return { personId: p.personId, isNew: !existing, label: `${p.firstName} ${p.lastName}`.trim(), fields }
  })
  return { family, members }
}
