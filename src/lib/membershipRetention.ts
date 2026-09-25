// MembershipApplication PII retention. submitMembershipApplication
// persists the full applicant form (address, DOB, phone/email, spouse/
// children/dependents/relatives) as an encrypted payload plus a raw signature
// image. Registration PII has a dedicated purge (registrationRetention.ts +
// purge-registration-pii.ts); MembershipApplication had no counterpart
// at all — reviewed (APPROVED/REJECTED) applications kept full decryptable
// PII, including the signature, forever. This module holds the pure retention
// policy — cutoff calc and redaction payload — so
// scripts/purge-membership-application-pii.ts and its tests share one source
// of truth, matching the registrationRetention.ts pattern.

// Anonymise a reviewed application this many months after the decision was
// made. Longer than the 6-month event-registration window: a
// membership application is a formal record, not a casual event signup, and
// APPROVED applicants already have their data live in Person/Family via the
// merge flow — the application row itself is a decision audit trail, not an
// ongoing contact record.
export const MEMBERSHIP_RETENTION_MONTHS = 24

export const REDACTED_APPLICANT_NAME = "Redacted"

// Cutoff instant: a decision made strictly before this is past retention.
// Same month-subtraction logic as registrationRetention.retentionCutoff
// (kept local — these modules are deliberately independent,/ have
// different windows and no shared caller).
export function membershipRetentionCutoff(now: Date, months: number = MEMBERSHIP_RETENTION_MONTHS): Date {
  const cutoff = new Date(now)
  const day = cutoff.getDate()
  cutoff.setDate(1)
  cutoff.setMonth(cutoff.getMonth() - months)
  const lastDayOfTargetMonth = new Date(cutoff.getFullYear(), cutoff.getMonth() + 1, 0).getDate()
  cutoff.setDate(Math.min(day, lastDayOfTargetMonth))
  return cutoff
}

// Only a DECIDED application (APPROVED or REJECTED) with a reviewedAt anchor
// older than the cutoff is past retention. PENDING applications are never
// purged — they have no decision anchor and may still be actionable.
export function isApplicationPastRetention(
  status: "PENDING" | "APPROVED" | "REJECTED",
  reviewedAt: Date | null,
  now: Date,
  months: number = MEMBERSHIP_RETENTION_MONTHS,
): boolean {
  if (status === "PENDING" || !reviewedAt) return false
  return reviewedAt < membershipRetentionCutoff(now, months)
}

// Field payload that scrubs a MembershipApplication's PII while preserving
// status/review metadata (status, reviewedById, reviewedAt, reviewNote,
// linkedFamilyId, monthlyDues) so the decision audit trail survives.
// `payload` is a NOT NULL Json column storing an encrypted string scalar (not
// a nested object), so the caller clears it to the empty-string JSON scalar
// (`payload: ""`) — NOT Prisma.DbNull, which is SQL NULL and would violate the
// NOT NULL constraint at runtime. (Contrast Registration.customAnswers, a
// nullable Json column that purge-registration-pii.ts clears with DbNull.)
export function anonymisedMembershipApplicationData(now: Date) {
  return {
    applicantName: REDACTED_APPLICANT_NAME,
    signature: "",
    email: "",
    emailHash: null,
    mobile: null,
    mobileHash: null,
    anonymizedAt: now,
  }
}
