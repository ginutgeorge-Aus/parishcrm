// Registration PII retention. The Australian Privacy Act expects data
// minimisation: event registrations carry PII (encrypted email/phone, names,
// custom answers) that must not be kept once an event is well past. This module
// holds the pure retention policy — the cutoff calc and the redaction payloads —
// so the purge script (`scripts/purge-registration-pii.ts`) and its tests share
// one source of truth. Financial aggregates (RegistrationItem quantity/price,
// Registration.totalAmount/paymentStatus) are deliberately left intact.

// Anonymise a registration this many months after its event is over. Kept short
// (church policy): repeat annual events do not need prior-year contacts.
export const RETENTION_MONTHS = 6

// Sentinel values written over PII. `email` is a non-null column, so it becomes
// an empty string rather than null; `emailHash` is cleared so the row can no
// longer be matched back to a member.
export const REDACTED_NAME = "Redacted"

// Cutoff instant: an event whose end is strictly before this is past retention.
export function retentionCutoff(now: Date, months: number = RETENTION_MONTHS): Date {
  const cutoff = new Date(now)
  // Subtract months without JS's month-end rollover: e.g. Aug 31 − 6mo naively
  // lands on "Feb 31" → Mar 2/3, shifting the cutoff days too far back.
  // Pin to day 1 before shifting the month, then clamp to the target month's
  // last valid day. Time-of-day is preserved.
  const day = cutoff.getDate()
  cutoff.setDate(1)
  cutoff.setMonth(cutoff.getMonth() - months)
  const lastDayOfTargetMonth = new Date(cutoff.getFullYear(), cutoff.getMonth() + 1, 0).getDate()
  cutoff.setDate(Math.min(day, lastDayOfTargetMonth))
  return cutoff
}

// An event is past retention once its close instant (endDate wins for
// multi-day/recurring, else the one-off date) is strictly before the cutoff.
// Events with neither date set are never purged — no anchor to measure from.
export function isEventPastRetention(
  date: Date | null,
  endDate: Date | null,
  now: Date,
  months: number = RETENTION_MONTHS,
): boolean {
  const closesAt = endDate ?? date
  if (!closesAt) return false
  return closesAt < retentionCutoff(now, months)
}

// Field payload that scrubs a Registration's PII while preserving the columns
// accounting reports read. `anonymizedAt` doubles as the idempotency marker —
// a row that already has it set is skipped by the purge query.
export function anonymisedRegistrationData(now: Date) {
  return {
    firstName: REDACTED_NAME,
    lastName: REDACTED_NAME,
    email: "",
    emailHash: null,
    phone: null,
    customAnswers: null,
    anonymizedAt: now,
  }
}

// Field payload that scrubs a single attendee's PII (name + encrypted answers).
export function anonymisedAttendeeData() {
  return {
    name: REDACTED_NAME,
    answers: null,
  }
}

// Waitlist rows carry the same PII class as Registration (name +
// encrypted email) for the same events, but were never covered by the purge —
// a member who joined a waitlist years ago kept name+email indefinitely while
// the sibling Registration row for the same event anonymised on schedule.
// Same sentinel/idempotency-marker shape as anonymisedRegistrationData.
export function anonymisedWaitlistData(now: Date) {
  return {
    name: REDACTED_NAME,
    email: "",
    emailHash: null,
    anonymizedAt: now,
  }
}

// every card checkout stages CheckoutSession.payload = an encrypted
// PricedRegistration JSON blob (firstName/lastName/email/phone/customAnswers).
// It's cleared to "" on EXPIRED/async-payment-failed, but the COMPLETED and
// UNFULFILLED paths deliberately retain it ("Payload retained for ops") and
// nothing ever clears it afterward — a full encrypted PII copy survives
// Registration/Attendee anonymisation indefinitely. Scrub it on the same
// event-retention schedule as Registration.
export function anonymisedCheckoutSessionData(now: Date) {
  return {
    payload: "",
    anonymizedAt: now,
  }
}
