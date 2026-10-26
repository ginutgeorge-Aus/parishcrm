// Code-defined verification checkpoints — the source of truth for the ADMIN
// /verify page. At release time, add an entry per shipped feature/bugfix
// (newest first), alongside the CHANGELOG + whatsNew updates.
//
// `id` is a PERMANENT anchor for stored results (CheckpointResult.checkpointId).
// Never change or reuse a shipped id; editing area/title/steps text is fine.
//
// `version` must be a real release tag. Release gate: the testCheckpoints test
// fails until at least one entry exists for the package.json version, so the
// release PR needs checkpoints added alongside its WHATS_NEW entry.
// The v1.0.0 entries below shipped under the old pre-OSS numbering (v1.19/v1.21)
// and were relabelled to v1.0.0, the first tag of the reset version line.

export type TestCheckpoint = {
  id: string // stable, unique — e.g. "v1.19.0-verify-page"
  version: string // git tag this shipped in, e.g. "v1.19.0"
  area: string // grouping label, e.g. "Events"
  title: string // short human name of the thing to test
  steps: string // plain-English steps to verify it works
}

export const TEST_CHECKPOINTS: TestCheckpoint[] = [
  {
    id: "v1.10.0-venue-bookings",
    version: "v1.10.0",
    area: "Venue",
    title: "Venue bookings list and bulk actions",
    steps:
      "With venue usage enabled, open Venue bookings → add all Sundays for a month → select several bookings and confirm them, then cancel one → confirm statuses update and the list stays correct after a page reload.",
  },
  {
    id: "v1.10.0-venue-requests",
    version: "v1.10.0",
    area: "Venue",
    title: "Booking and invoice request emails",
    steps:
      "On Venue bookings, open the booking-request panel → approve the month and send → confirm the email arrives (with the CC list from Settings) → repeat for the invoice-request panel.",
  },
  {
    id: "v1.10.0-venue-calendar",
    version: "v1.10.0",
    area: "Venue",
    title: "Public committee calendar link",
    steps:
      "Copy the calendar link from Venue bookings → open it in a private window → confirm confirmed and pending bookings show in month and list views and previous/next month work → reset the link and confirm the old link no longer opens.",
  },
  {
    id: "v1.9.1-security-smoke",
    version: "v1.9.1",
    area: "Security",
    title: "Smoke test after security dependency update",
    steps:
      "Sign in with password and OTP → open the dashboard, People and an event → open a page with images (e.g. Settings → Branding) and confirm logos load → save one small change (e.g. a person's note) and confirm it saves.",
  },
  {
    id: "v1.9.0-warm-theme",
    version: "v1.9.0",
    area: "Navigation",
    title: "Warmer theme and sentence-case labels",
    steps:
      "Open the dashboard, People and Settings → confirm the warm neutral colours and terracotta accent (or your brand colour if THEME_ACCENT is set) → confirm buttons and labels use sentence case → check text is readable in both light and dark mode.",
  },
  {
    id: "v1.9.0-setup-features",
    version: "v1.9.0",
    area: "Settings",
    title: "Setup asks which features are needed",
    steps:
      "On a fresh install (or the setup checklist as ADMIN), open the features step → turn off a feature you don't need and continue → confirm it is hidden from the sidebar afterwards and can be turned back on in Settings → Features.",
  },
  {
    id: "v1.9.0-unsaved-guard",
    version: "v1.9.0",
    area: "Settings",
    title: "Unsaved-changes warning on any navigation",
    steps:
      "In Settings, change a field without saving → click a sidebar link, a top-bar item and the browser back button in turn → confirm each time you are warned before leaving → save and confirm you can then leave without a warning.",
  },
  {
    id: "v1.9.0-blocked-switch-focus",
    version: "v1.9.0",
    area: "Settings",
    title: "Blocked feature switches stay focusable",
    steps:
      "Settings → Features → Tab through the switches with the keyboard → confirm a switch that can't be turned off still receives focus and its reason is announced or shown.",
  },
  {
    id: "v1.8.0-app-shell",
    version: "v1.8.0",
    area: "Navigation",
    title: "Top bar, New menu and user menu",
    steps:
      "On desktop, check the top bar → open the New menu and confirm it lists quick-add items you may use → click the notifications bell and confirm it opens → open your account menu and confirm Account and Sign out are there. Then sign in as a VIEWER and confirm New only shows what that role may do.",
  },
  {
    id: "v1.8.0-mobile-drawer",
    version: "v1.8.0",
    area: "Navigation",
    title: "Mobile navigation drawer",
    steps:
      "At 375px wide (phone or browser dev tools), tap the menu button → confirm the sidebar slides in as a drawer → tap a link and confirm the drawer closes and the page loads → confirm the top bar fits with no sideways scrolling.",
  },
  {
    id: "v1.8.0-settings-tabs",
    version: "v1.8.0",
    area: "Settings",
    title: "Tabbed settings area",
    steps:
      "Open Settings → confirm church and system tabs → switch between tabs and confirm each loads its own section and the current tab is highlighted → reload on a tab and confirm you stay on it → confirm tabs work by keyboard and on a phone width.",
  },
  {
    id: "v1.8.0-feature-toggles",
    version: "v1.8.0",
    area: "Settings",
    title: "Feature toggles hide nav and close routes",
    steps:
      "Settings → Features → turn one feature off (e.g. Invoices) and save → confirm it disappears from the sidebar and the New menu → open its URL directly and confirm the page is closed → turn it back on and confirm the menu item and page return.",
  },
  {
    id: "v1.8.0-concurrent-save",
    version: "v1.8.0",
    area: "Accounting",
    title: "Petty cash and transactions with two people saving",
    steps:
      "In two browser sessions, edit the same account at once: in one, deactivate a petty-cash account; in the other, add a receipt, expense or transaction to it and save → confirm the save is rejected with a clear message rather than writing to an inactive account.",
  },
  {
    id: "v1.8.0-pl-mobile",
    version: "v1.8.0",
    area: "Accounting",
    title: "Profit & Loss fits at 375px",
    steps:
      "Open Reports → Profit & Loss at 375px wide → confirm the header wraps and the year selector is fully visible with no sideways page scroll.",
  },
  {
    id: "v1.7.0-passkey-signin",
    version: "v1.7.0",
    area: "Auth",
    title: "Passkey sign-in",
    steps:
      "On the Account page add a passkey (fingerprint, face or device PIN) → sign out → choose passkey sign-in and confirm you are signed in without typing a password or code → remove the passkey and confirm it no longer works.",
  },
  {
    id: "v1.7.0-needs-attention",
    version: "v1.7.0",
    area: "Dashboard",
    title: "Needs attention list and setup checklist",
    steps:
      "Open the dashboard → confirm a Needs attention list shows items such as updates to review, transactions to reconcile or open petty-cash sessions, each linking to the right page → on a fresh install confirm the short setup checklist appears.",
  },
  {
    id: "v1.7.0-sidebar-reports",
    version: "v1.7.0",
    area: "Navigation",
    title: "Five-section sidebar and Reports hub",
    steps:
      "Confirm the sidebar groups pages into five sections → open Reports and confirm it links to every report and each link opens.",
  },
  {
    id: "v1.7.0-event-revenue-split",
    version: "v1.7.0",
    area: "Events",
    title: "Event revenue split by card and transfer",
    steps:
      "Open an event with both card and bank-transfer registrations → confirm revenue shows card and transfer separately and they add up to the total → send an invoice, change the letterhead in Branding, and confirm the already-sent invoice PDF keeps its original letterhead.",
  },
  {
    id: "v1.6.0-pl-drilldown",
    version: "v1.6.0",
    area: "Accounting",
    title: "Profit & Loss drill-down",
    steps:
      "Open Profit & Loss → click a category and confirm its transactions for the year open → in the monthly view click a month and confirm only that month's transactions show.",
  },
  {
    id: "v1.6.0-transaction-filters",
    version: "v1.6.0",
    area: "Accounting",
    title: "Transaction filters persist; month filter",
    steps:
      "On Transactions apply a filter and a month → edit a transaction and save → confirm you return to the list with the same filters still applied.",
  },
  {
    id: "v1.6.0-financial-year",
    version: "v1.6.0",
    area: "Accounting",
    title: "Financial-year label with a non-July start",
    steps:
      "Set the financial-year start month to something other than July → open a report and confirm the year label and date range match that start month.",
  },
  {
    id: "v1.5.0-invoices",
    version: "v1.5.0",
    area: "Invoices",
    title: "Invoice lifecycle",
    steps:
      "Create a draft invoice for a hall hirer → email it as a PDF (or mark it sent) → record a payment and confirm the Invoices page moves it from owed to paid → create another and void it.",
  },
  {
    id: "v1.5.0-sunday-school",
    version: "v1.5.0",
    area: "Sunday School",
    title: "Classes, roll and rollover lock",
    steps:
      "Create a class with a teacher and enrol a child → take this week's roll and confirm it saves → after rollover confirm last year's classes are locked from editing.",
  },
  {
    id: "v1.5.0-clearances",
    version: "v1.5.0",
    area: "People",
    title: "Ministry roles and WWCC / Safe Ministry clearances",
    steps:
      "On a person add a ministry role and a Working With Children Check with an expiry date → open the compliance list and confirm the person appears with the right status and expiry.",
  },
  {
    id: "v1.21.0-per-attendee-questions",
    version: "v1.0.0",
    area: "Events",
    title: "Per-attendee custom questions",
    steps:
      "On a public event with a per-attendee question (e.g. dietary), register 2 attendees and give each a different answer → export the registrations CSV and open the print sheet → confirm one row per attendee with each person's own answer (decrypted).",
  },
  {
    id: "v1.21.0-event-checkin",
    version: "v1.0.0",
    area: "Events",
    title: "Day-of check-in",
    steps:
      "Open an event's check-in screen → search an attendee by name and by reference → tap to mark present → confirm the live checked-in count goes up and the state persists on reload.",
  },
  {
    id: "v1.21.0-waitlist",
    version: "v1.0.0",
    area: "Events",
    title: "Waitlist for sold-out tickets",
    steps:
      "On a sold-out ticket type, use the public event page to join the waitlist (name + email) → as staff, open the event and confirm the waitlist entry shows → mark it notified and confirm the status updates.",
  },
  {
    id: "v1.21.0-users-last-login",
    version: "v1.0.0",
    area: "Admin",
    title: "Users list last login + lock badge",
    steps:
      "Open the Users list → confirm each user shows their last successful login → lock a test account via repeated failed logins (or check an already-locked one) and confirm the OTP-lock badge appears.",
  },
  {
    id: "v1.19.0-email-templates",
    version: "v1.0.0",
    area: "Settings",
    title: "Customisable email templates",
    steps:
      "Settings → Email → edit the welcome template's wording → check the live preview updates → click send-test-to-me and confirm the email arrives → Reset to default and confirm it reverts.",
  },
  {
    id: "v1.19.0-event-capacity-cancelled",
    version: "v1.0.0",
    area: "Events",
    title: "Cancelled registrations free up capacity",
    steps:
      "Open an event at/near capacity → cancel one paid registration → confirm the remaining-spots count goes up and a new registration can be taken.",
  },
  {
    id: "v1.19.0-registration-custom-answers",
    version: "v1.0.0",
    area: "Events",
    title: "Custom-question answers still export",
    steps:
      "Register on a public event that has custom questions (e.g. dietary) → export the event registrations CSV → confirm the answers appear correctly (decrypted) in the export.",
  },
  {
    id: "v1.19.0-church-name",
    version: "v1.0.0",
    area: "General",
    title: "Full church name shown",
    steps:
      "Check a sent receipt/welcome email and the privacy page show your church's full name, not an abbreviation. (The name comes from the CHURCH_NAME env var + the churchName setting — confirm those are set to the full name.)",
  },
  {
    id: "v1.19.0-verify-page",
    version: "v1.0.0",
    area: "Admin",
    title: "Feature verification page",
    steps:
      "Open Release Checks in the sidebar → confirm checkpoints are listed grouped by version → mark one Working and confirm the badge count drops.",
  },
  {
    id: "v1.19.0-verify-not-working",
    version: "v1.0.0",
    area: "Admin",
    title: "Not-working files a bug",
    steps:
      "On Release Checks, mark a checkpoint Not working → enter a note → confirm a GitHub issue is filed and it appears in My Feedback.",
  },
]

export function findCheckpoint(id: string): TestCheckpoint | undefined {
  return TEST_CHECKPOINTS.find((c) => c.id === id)
}
