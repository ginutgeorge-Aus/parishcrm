// Code-defined verification checkpoints — the source of truth for the ADMIN
// /verify page. At release time, add an entry per shipped feature/bugfix
// (newest first), alongside the CHANGELOG + whatsNew updates.
//
// `id` is a PERMANENT anchor for stored results (CheckpointResult.checkpointId).
// Never change or reuse a shipped id; editing area/title/steps text is fine.

export type TestCheckpoint = {
  id: string // stable, unique — e.g. "v1.19.0-verify-page"
  version: string // git tag this shipped in, e.g. "v1.19.0"
  area: string // grouping label, e.g. "Events"
  title: string // short human name of the thing to test
  steps: string // plain-English steps to verify it works
}

export const TEST_CHECKPOINTS: TestCheckpoint[] = [
  {
    id: "v1.21.0-per-attendee-questions",
    version: "v1.21.0",
    area: "Events",
    title: "Per-attendee custom questions",
    steps:
      "On a public event with a per-attendee question (e.g. dietary), register 2 attendees and give each a different answer → export the registrations CSV and open the print sheet → confirm one row per attendee with each person's own answer (decrypted).",
  },
  {
    id: "v1.21.0-event-checkin",
    version: "v1.21.0",
    area: "Events",
    title: "Day-of check-in",
    steps:
      "Open an event's check-in screen → search an attendee by name and by reference → tap to mark present → confirm the live checked-in count goes up and the state persists on reload.",
  },
  {
    id: "v1.21.0-waitlist",
    version: "v1.21.0",
    area: "Events",
    title: "Waitlist for sold-out tickets",
    steps:
      "On a sold-out ticket type, use the public event page to join the waitlist (name + email) → as staff, open the event and confirm the waitlist entry shows → mark it notified and confirm the status updates.",
  },
  {
    id: "v1.21.0-users-last-login",
    version: "v1.21.0",
    area: "Admin",
    title: "Users list last login + lock badge",
    steps:
      "Open the Users list → confirm each user shows their last successful login → lock a test account via repeated failed logins (or check an already-locked one) and confirm the OTP-lock badge appears.",
  },
  {
    id: "v1.19.0-email-templates",
    version: "v1.19.0",
    area: "Settings",
    title: "Customisable email templates",
    steps:
      "Settings → Email Templates → edit the welcome template's wording → check the live preview updates → click send-test-to-me and confirm the email arrives → Reset to default and confirm it reverts.",
  },
  {
    id: "v1.19.0-event-capacity-cancelled",
    version: "v1.19.0",
    area: "Events",
    title: "Cancelled registrations free up capacity",
    steps:
      "Open an event at/near capacity → cancel one paid registration → confirm the remaining-spots count goes up and a new registration can be taken.",
  },
  {
    id: "v1.19.0-registration-custom-answers",
    version: "v1.19.0",
    area: "Events",
    title: "Custom-question answers still export",
    steps:
      "Register on a public event that has custom questions (e.g. dietary) → export the event registrations CSV → confirm the answers appear correctly (decrypted) in the export.",
  },
  {
    id: "v1.19.0-church-name",
    version: "v1.19.0",
    area: "General",
    title: "Full church name shown",
    steps:
      "Check a sent receipt/welcome email and the privacy page show your church's full name, not an abbreviation. (The name comes from the CHURCH_NAME env var + the churchName setting — confirm those are set to the full name.)",
  },
  {
    id: "v1.19.0-verify-page",
    version: "v1.19.0",
    area: "Admin",
    title: "Feature verification page",
    steps:
      "Open Verify in the sidebar → confirm checkpoints are listed grouped by version → mark one Working and confirm the badge count drops.",
  },
  {
    id: "v1.19.0-verify-not-working",
    version: "v1.19.0",
    area: "Admin",
    title: "Not-working files a bug",
    steps:
      "On Verify, mark a checkpoint Not working → enter a note → confirm a GitHub issue is filed and it appears in My Reports.",
  },
]

export function findCheckpoint(id: string): TestCheckpoint | undefined {
  return TEST_CHECKPOINTS.find((c) => c.id === id)
}
