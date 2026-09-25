// Curated, user-facing release highlights. Source of truth for the in-app
// "What's New" footer + /whats-new page. Keep bullets plain-English and
// user-facing (what staff can now do) — never internal refactors or
// security-fix specifics. That is what CHANGELOG.md is for.
//
// At release time, add a new entry at the TOP (newest first) with the same
// version string as the git tag, alongside the CHANGELOG [Unreleased] rename.

export type WhatsNewEntry = {
  version: string // matches the git tag / NEXT_PUBLIC_APP_VERSION, e.g. "v1.10.0"
  date: string // ISO date "YYYY-MM-DD"
  highlights: string[] // short, plain-English, user-facing bullets
}

export const WHATS_NEW: WhatsNewEntry[] = [
  {
    version: "v1.1.0",
    date: "2026-09-25",
    highlights: [
      "New installs can add an optional starter chart of accounts (common income and expense categories plus bank and petty-cash accounts) instead of setting up accounting from scratch.",
      "Pop-up dialogs and menus no longer trigger browser security warnings when they open.",
    ],
  },
  {
    version: "v1.50.1",
    date: "2026-09-25",
    highlights: [
      "The site footer now credits ParishCRM, the open-source software behind this app.",
    ],
  },
  {
    version: "v1.50.0",
    date: "2026-09-24",
    highlights: [
      "Event check-in lists now pick up attendees and check-ins made on another device.",
      "Birthday and anniversary lists now cover up to 5,000 people and warn if the list may be incomplete.",
      "Welcome letter and tax receipt PDFs have tidier layouts, and membership form dates reject impossible dates like 31 February.",
      "This release also includes fixes to event reminder emails, transaction date filters, petty cash, and touch-screen button sizes.",
    ],
  },
  {
    version: "v1.49.0",
    date: "2026-09-24",
    highlights: [
      "Bank and cash accounts are now set up in Settings → Accounting — add, rename, choose the default, or deactivate accounts. All existing accounts and history carry over unchanged.",
      "More of the app can now be tailored from Settings: tax receipt wording and titles (Settings → Tax Receipt), membership form questions and the monthly-dues minimum (Settings → Membership), and the welcome-letter text (Settings → Welcome Letter).",
      "The Resync website button on Events now only appears when the website sync is set up.",
      "This release also includes a broad round of fixes across accounting screens, bank and petty-cash imports, card payments, family merges, events, printing, and mobile layouts.",
    ],
  },
  {
    version: "v1.48.0",
    date: "2026-09-16",
    highlights: [
      "An administrator can now set the church's look from App Settings → Branding — upload the logo, crest, app/PWA icon and PDF letterhead, and they appear everywhere: the login screen, sidebar, public pages, browser tab, and receipt and letter PDFs. “Reset” restores the built-in default for any slot.",
      "This release also bundles a broad round of accuracy and reliability fixes across accounting totals and exports, event registration, bank and petty-cash imports, and sign-in.",
    ],
  },
  {
    version: "v1.47.0",
    date: "2026-09-10",
    highlights: [
      "Payment-reminder emails now let a registrant pay by card. Each unpaid person's reminder links straight to their own booking (with the bank-transfer details and reference), and for events that take online payment they can choose Pay now by card instead — it marks them paid without creating a duplicate registration.",
    ],
  },
  {
    version: "v1.46.0",
    date: "2026-09-07",
    highlights: [
      "You can now email unpaid event registrants a payment reminder — from an event's registrations (or your managed event), pick the registrations that still owe, edit the message if you like, and send each one a reminder with a link to pay. The table shows when each person was last reminded.",
    ],
  },
  {
    version: "v1.45.0",
    date: "2026-09-04",
    highlights: [
      "You can now add your own greeting and sign-off around each birthday and anniversary blessing email, and send yourself a test copy from App Settings → Email templates before turning them on.",
    ],
  },
  {
    version: "v1.44.0",
    date: "2026-09-02",
    highlights: [
      "New members now consent to church emails by default — the consent box on the person form starts ticked, and every existing member has been set to consenting. You can still untick it per person to opt someone out.",
    ],
  },
  {
    version: "v1.43.0",
    date: "2026-09-02",
    highlights: [
      "You can now send a written birthday or wedding-anniversary blessing to members straight from People → Birthdays and the new People → Anniversaries page. The birthday message adapts to the member’s gender and the anniversary message names both spouses.",
      "Edit the wording of both blessing emails under App Settings → Email templates.",
      "New: turn on automatic daily sending for either blessing under App Settings — once enabled, members are emailed their birthday or anniversary blessing on the day, with no manual step. Both toggles start off, and no one is ever emailed twice in a day.",
    ],
  },
  {
    version: "v1.42.0",
    date: "2026-09-01",
    highlights: [
      "Data tables now stack into readable cards on your phone instead of scrolling sideways — event registrations, reconcile, bank review, send receipts, ledger, audit log, families, funds, dues, and more all read cleanly on a small screen.",
      "On an event's Registrations page, the detail popup now opens full-width on a laptop so you can read a booking's contact details and answers without a cramped column.",
      "New for admins: a Usage dashboard under Settings → Usage showing which features are used, active users, a 12-week trend, dormant features, and the most-viewed pages — all from anonymous counts, no per-person browsing data.",
    ],
  },
  {
    version: "v1.41.0",
    date: "2026-08-31",
    highlights: [
      "New: generate a branded new-member welcome letter for a family — edit the draft, preview the PDF, and email it to selected family members. Set up your bank accounts and default signer under App Settings → Welcome Letter.",
      "Event organisers can now check attendees in on the day for events they manage, not just view the registration list — a new check-in page on each of their events.",
      "On an event's Registrations page, click a registrant's name to open a dialog with that booking's full contact details, answers, and each attendee's check-in status.",
      "The public event registration and membership forms are much smoother on a phone — correct keyboards and autofill, larger tap targets, a submit bar that stays in view, and jump-to-the-first-error on a failed submit.",
      "Public forms no longer get stuck on a blank verification box: if the anti-spam check can't load (ad-blocker or restrictive network), visitors now see a clear message on how to recover instead of a dead end.",
      "The login screen now shows a live countdown while an account is locked after too many failed attempts, and a sent birthday email is marked “Sent” so it can't be accidentally emailed twice.",
      "Wide-ranging accessibility improvements across the app for screen-reader and keyboard users (labelled controls, announced errors, correct headings and chart descriptions).",
    ],
  },
  {
    version: "v1.40.1",
    date: "2026-08-17",
    highlights: [
      "Fixed a bug where saving an event did nothing if tiered pricing was switched off — the form now saves reliably whether tiered pricing is on or off.",
    ],
  },
  {
    version: "v1.40.0",
    date: "2026-08-17",
    highlights: [
      "Event organisers can now close registration — either manually with a toggle or automatically on a deadline you set. Once closed, the public event page shows a “registration closed — contact the organiser” message instead of the booking form.",
      "The registrations “All” tab shows active bookings only; free ($0) registrations now show a clear “no payment required” confirmation instead of bank-transfer instructions.",
    ],
  },
  {
    version: "v1.39.0",
    date: "2026-08-13",
    highlights: [
      "Event registration lists now have a “Method” column — Card for online payments, Bank transfer for offline bookings — so you can see at a glance how each person paid.",
      "The registrations “All” tab now shows only active bookings; cancelled registrations appear under the “Cancelled” tab instead of cluttering the default view.",
      "Large event registration lists and the per-fund accounting report now load noticeably faster.",
    ],
  },
  {
    version: "v1.38.3",
    date: "2026-08-11",
    highlights: [
      "Fixed an occasional failure when paying online for an event — some payers were shown an error instead of the Stripe checkout page. Card payments now open reliably.",
      "Accounting reports (Profit & Loss, Trial Balance, Cash Flow, Budget vs Actual) no longer count internal petty-cash-to-bank transfers as real expenses or cash out, so totals are accurate on any financial year that includes a transfer.",
      "Dates and times across events, receipts and the reconciliation report now consistently show in Sydney time, instead of occasionally showing the wrong day or an hour offset.",
    ],
  },
  {
    version: "v1.38.2",
    date: "2026-08-05",
    highlights: [
      "A brief “we’ll be back shortly” maintenance page now appears automatically while an update is being deployed, instead of a half-updated app.",
      "Fixed a crash when exporting the full people list to CSV if anyone had no assigned family — those rows now export with a blank Family column.",
      "The budget editor now loads the correct amounts when you switch financial years, and editing an unassigned petty-cash entry no longer silently moves it to the General fund.",
    ],
  },
  {
    version: "v1.38.1",
    date: "2026-08-03",
    highlights: [
      "Fixed online card payments for events with a family discount (tiered pricing or fee waiver): the payer was being charged the full undiscounted price and then no registration was created. Discounted events now charge the correct total and record the registration reliably.",
    ],
  },
  {
    version: "v1.38.0",
    date: "2026-08-03",
    highlights: [
      "New Event Organiser role: you can now give a volunteer a login that only sees the events you assign them. They get a “My Events” area where they can view and export (CSV + PDF) the registration list for those events — and nothing else. Assign organisers from an event's registrations page, and create their account under Users.",
      "The public event page now shows the event date and time in Sydney time, matching the confirmation email and calendar file.",
    ],
  },
  {
    version: "v1.37.2",
    date: "2026-08-02",
    highlights: [
      "Fixed event times showing about 11 hours off — an 8:30 AM event was appearing as 7:30 PM on the confirmation email, calendar file and event page. Event times are now saved and shown correctly in Sydney time. Please re-save each existing event once so its time is corrected.",
    ],
  },
  {
    version: "v1.37.1",
    date: "2026-08-01",
    highlights: [
      "Fixed the church crest showing as a broken image in the header of public event and registration pages — it now displays correctly for visitors who aren’t logged in.",
    ],
  },
  {
    version: "v1.37.0",
    date: "2026-08-01",
    highlights: [
      "Event organiser contacts (name and phone) now also appear on the registration confirmation email, the post-registration success page, and the pre-event reminder email — not just the public event page — so registrants always know who to contact.",
      "The registration CSV export now shows the registrant-facing “REG-…” reference in the Ref column, so you can match a bank transfer against the export directly.",
      "Fixed a crash on person and family pages when a member’s date of birth was unreadable — an unparseable date is now treated as “no date of birth” instead of erroring the whole page.",
    ],
  },
  {
    version: "v1.36.0",
    date: "2026-07-31",
    highlights: [
      "Event consent questions can now list several statements, each with its own required tick plus a final “I have read and agree to the above” box — handy for waivers or policies with multiple points to acknowledge. Add one statement per line in the question editor.",
      "Events can price a whole family registration by headcount using a per-event table (e.g. 1 person $60, 2 people $120, 3 people $150, 4 people $180), with a maximum group size — an alternative to the flat family-fee waiver.",
      "Events can now pass the card processing fee on to the registrant so the church receives the full ticket price. The fee and updated total are shown before payment; people paying by bank transfer are never charged extra.",
      "You can now list one or more organisers (name and optional phone) on an event, shown on the public event page so registrants know who to contact.",
    ],
  },
  {
    version: "v1.35.2",
    date: "2026-07-31",
    highlights: [
      "Fixed the grand-total row on the Cash Flow and Giving Summary reports, which could show a figure 100× too large (the individual line items were always correct).",
      "Editing a transaction or a petty-cash cash-in receipt no longer fails with an error.",
      "Registration, reminder, receipt and DGR emails now automatically retry after a temporary email hiccup instead of silently failing to send.",
      "Bank statement import now clearly flags a row that has no category selected, instead of quietly skipping it.",
    ],
  },
  {
    version: "v1.35.1",
    date: "2026-07-30",
    highlights: [
      "Fixed the church logo showing as a broken image in the sidebar — it now displays correctly again.",
    ],
  },
  {
    version: "v1.35.0",
    date: "2026-07-29",
    highlights: [
      "Multiple-choice questions on event registration forms can now include an “Other” option that lets people type in their own answer, so you're no longer limited to the preset choices.",
      "The church crest now appears throughout the app — on the login screens, the sidebar, and as the browser tab and home-screen icon — replacing the old “SM” placeholder.",
    ],
  },
  {
    version: "v1.34.0",
    date: "2026-07-28",
    highlights: [
      "You can now track giving and spending by fund or ministry (e.g. Building Fund, Sunday School). Tag any transaction or petty-cash entry with a fund, then see a per-fund income, expense and net summary in Accounting → Reports. Set up your funds under Accounting → Settings (admins only).",
    ],
  },
  {
    version: "v1.33.0",
    date: "2026-07-23",
    highlights: [
      "Each event now has a private volunteer share link you can send to helpers — they can see live how many spots are filled and who has booked and paid, on their phone, without needing to log in. Turn it on (and regenerate the link) from the event's registrations page.",
    ],
  },
  {
    version: "v1.32.0",
    date: "2026-07-23",
    highlights: [
      "Before a draft event goes live, admins can now clear out all test registrations, waitlist entries and unfinished checkouts in one click from the event's registrations page — a clean slate for the real launch.",
      "If someone submits the same event registration twice within a few minutes, the confirmation page now clearly says it was a repeat, instead of looking like a brand-new booking.",
      "Cancelled event registrations no longer count toward an event's tickets sold or fill rate, so those numbers now match the real capacity.",
    ],
  },
  {
    version: "v1.31.0",
    date: "2026-07-23",
    highlights: [
      "Events can now waive fees for larger families: once a family registers more than a set number of members, the extra members are free. You can exclude ticket types (like Visitor) so they always pay full price.",
    ],
  },
  {
    version: "v1.30.3",
    date: "2026-07-20",
    highlights: [
      "Fixed a rare error when two admins approved the same membership application at the same time.",
      "Improved keyboard/screen-reader navigation for the sidebar's collapsible menu groups.",
    ],
  },
  {
    version: "v1.30.0",
    date: "2026-07-17",
    highlights: [
      "Paid events can now take card payments online. Turn on “online card payment” when editing an event, and registrants can choose to pay now by card (via Stripe) or pay later by bank transfer.",
      "Card registrations are only confirmed once payment goes through, and are automatically refunded if the event sells out in the meantime.",
      "Petty cash session close now supports an optional physical cash count, showing the variance against the system balance (a note is required if they don't match).",
      "Public pages (event pages, membership form, privacy) now have a footer link for visitors to report a bug or send feedback, straight to our tracked issues.",
      "Accounting's sidebar menu is now grouped into Transactions/Reports/Admin, with a collapsible rail on desktop.",
      "Membership-application email alerts can now go to more than one address (Settings → Membership Applications).",
    ],
  },
  {
    version: "v1.29.0",
    date: "2026-07-14",
    highlights: [
      "The Privacy Policy is now linked in the footer on every page, and the policy has more detail on data security, cookies and how to contact us.",
      "The public membership registration form now opens with a short welcome and confidentiality note, and asks for fewer fields (mobile number only).",
    ],
  },
  {
    version: "v1.28.0",
    date: "2026-07-12",
    highlights: [
      "Attach receipts and invoices to any transaction (Xero-style): upload JPEG, PNG or PDF files and view them from the transaction detail page.",
      "Events list and the petty-cash / membership CSV imports are now noticeably faster on larger data.",
      "Public membership and event-registration forms — including the signature pad — are now fully keyboard and screen-reader accessible.",
    ],
  },
  {
    version: "v1.27.2",
    date: "2026-07-11",
    highlights: [
      "The public pages (membership form, event tickets, privacy and family-update links) are now easier to use with a screen reader or keyboard — a skip-to-content link, clearer page titles, and status messages that read out when a form is submitting or has an error.",
      "Faster pages across giving reports, people and family searches, registrations and the audit log, thanks to database tuning behind the scenes.",
    ],
  },
  {
    version: "v1.27.1",
    date: "2026-07-10",
    highlights: [
      "The public membership form now carries the official church letterhead at the top, and the secretary’s new-application email now includes a branded PDF of the completed form (all sections, family details and signature) — so it can be read and filed without logging in.",
      "DGR donation receipts can now be edited while still in Draft or after a failed send — fix a donor name, email or donation line and re-send. Receipts already sent stay locked as issued.",
      "The sidebar “Membership Forms” link now shows a badge with the number of applications waiting for review, like the Family Updates badge.",
    ],
  },
  {
    version: "v1.27.0",
    date: "2026-07-10",
    highlights: [
      "Automated event reminder emails — when creating or editing an event, set a “Send reminder (days before)” lead time and every registrant is emailed a reminder once, that many days before the event.",
      "New public membership registration form at /membershipform — prospective members fill in and digitally sign their details online; the church secretary is notified by email, and applications appear in a Memberships review queue where you approve them into a new or existing family or reject them, with a printable branded PDF for the register.",
      "Budget vs Actual report now lets accounting staff add an explanation note to a flagged variance line, visible read-only to other accounting roles.",
      "Admins can now set the membership-secretary alert email under Settings → App Settings, without needing an environment-variable change.",
    ],
  },
  {
    version: "v1.26.2",
    date: "2026-07-09",
    highlights: [
      "The downloadable annual DGR receipt PDF now has a professionally branded layout — church letterhead with crest, name, address and ABN, an itemised donation table, and a highlighted tax-deductible total — replacing the old plain-text version. Long lists of gifts flow neatly across pages.",
    ],
  },
  {
    version: "v1.26.1",
    date: "2026-07-09",
    highlights: [
      "The email that carries an annual DGR donation receipt now has a professional branded layout — a church header, the total tax-deductible amount, and an official footer with ABN and address — matching the look of the app’s transaction receipts (the receipt PDF is unchanged).",
    ],
  },
  {
    version: "v1.26.0",
    date: "2026-07-08",
    highlights: [
      "Annual DGR receipts now email and download reliably — a problem that was marking them as “failed” has been fixed. Any receipt still showing Failed can be re-sent after editing it once.",
      "The covering email that goes out with an annual DGR receipt is now editable under Settings → Email Templates, so you can word the message donors receive (the receipt PDF itself is unchanged).",
    ],
  },
  {
    version: "v1.25.0",
    date: "2026-07-08",
    highlights: [
      "Annual tax receipts for tithes and donations — go to Accounting → DGR Receipts, pick a person and financial year, enter their dated gifts, and the app produces a numbered ATO-format receipt PDF and emails it to them.",
      "The dashboard now shows this month’s wedding anniversaries (from each family’s marriage date) next to upcoming birthdays, replacing the old membership-anniversary list.",
      "Adding a new family now starts with monthly subscription dues pre-filled at $80, so you don’t have to key the standard amount every time (you can still change or clear it).",
    ],
  },
  {
    version: "v1.24.0",
    date: "2026-07-06",
    highlights: [
      "Event check-in by QR code — the registration success page now shows a scannable check-in code, and the check-in screen has a Scan QR button that opens the camera to pull up a party instantly instead of typing their reference.",
      "Public event registration no longer double-books — an accidental double-click, back-and-resubmit, or network retry for the same event and email within 10 minutes returns the original confirmation instead of creating a second registration.",
      "When the public register button is greyed out, the form now lists exactly what is still missing (attendee names, a required tick-box, an unanswered question) instead of leaving visitors staring at a dead button.",
      "Accessibility and mobile polish across the app — screen-reader announcements for form errors and confirmations, stronger text contrast, clickable breadcrumbs on more create/edit pages, and more reports and tables that scroll or stack cleanly on phones.",
    ],
  },
  {
    version: "v1.23.1",
    date: "2026-07-03",
    highlights: [
      "Events can now have a full poster image — upload it on the event edit page and it shows large at the top of the public ticket page, with the title over it. You can also upload the smaller banner instead of pasting a link.",
      "Keying in a transaction that looks like one you already entered (same date, amount, category and description) now warns you before saving, so double-entered offerings and expenses get caught — the same check now covers petty-cash expenses too.",
      "Transactions now show at-a-glance flags for entries worth a second look — large amounts, ones entered well after their date, and ones edited after posting.",
      "The budget-vs-actual report now marks any line that is over or under budget by more than 10%.",
      "Every financial report (trial balance, cash flow, balance sheet, budget) now has an Export CSV button beside Print.",
      "If two people edit the same transaction, person, family or event at once, the second save is now stopped with a “reload and reapply” message instead of silently overwriting the first.",
      "Reconciled transactions and any financial record inside the 7-year ATO window are now protected from being edited or deleted by mistake.",
    ],
  },
  {
    version: "v1.22.0",
    date: "2026-07-02",
    highlights: [
      "Registrations page now shows per-event analytics — fill rate per ticket type, revenue breakdown by ticket, and a registrations-over-time chart.",
      "Bank reconciliation: filter by pending or reconciled, see a running book balance down the list, and reconcile several transactions at once.",
      "Accounting period lock: admins can close a period in Accounting Settings so records on or before that date become read-only.",
    ],
  },
  {
    version: "v1.21.1",
    date: "2026-06-30",
    highlights: [
      "“Remember this device” now sticks across logging out — once you tick it and enter the code, that browser skips the email code for the full 14 days, even if you log out and back in the same day",
    ],
  },
  {
    version: "v1.21.0",
    date: "2026-06-28",
    highlights: [
      "Event registration questions can now be asked per attendee, not just per booking — so you can collect a dietary need or allergy for each named guest",
      "New day-of check-in screen for events — search attendees by name or reference and tap to mark them present, with a live checked-in count",
      "Sold-out ticket types now offer a waitlist — people can add their name and email, and staff can see the list and mark people as notified",
      "The users list now shows each person's last login and flags accounts locked out by failed sign-in attempts",
    ],
  },
  {
    version: "v1.20.0",
    date: "2026-06-27",
    highlights: [
      "Event pages can now show a banner image, and people who register get an automatic confirmation email with payment details and an add-to-calendar link",
      "Event registration questions are more flexible — extra answer types, consent tick-boxes, one-click presets, and questions that appear only for the ticket they apply to (e.g. a child’s age only on a Child ticket)",
      "Family pages now show who last updated the family or a member, and when",
    ],
  },
  {
    version: "v1.19.0",
    date: "2026-06-26",
    highlights: [
      "New admin “Verify” page — after each update, admins can tick off that new features and fixes work, and flag anything that doesn’t (which automatically files a bug)",
      "Admins can now customise the wording of the welcome, family-update invite and donation-receipt emails — with live preview and a send-test-to-me button — under Settings → Email Templates",
    ],
  },
  {
    version: "v1.18.0",
    date: "2026-06-25",
    highlights: [
      "A more polished, consistent look across the app — refreshed colours and tables that follow the church’s brand, plus loading skeletons so pages no longer flash blank while they load",
      "Better on phones — money, event and people lists now stack into easy-to-read cards on small screens",
      "Improved accessibility — stronger text contrast, screen-reader labels on search and filter boxes, and a “Skip to main content” link",
    ],
  },
  {
    version: "v1.17.0",
    date: "2026-06-25",
    highlights: [
      "New “Office Admin” role for church office staff — manage families, events and users, with read-only access to accounting",
      "New team members now get a welcome email to set their own password securely, plus a built-in “Help” guide (look for Help in the sidebar)",
    ],
  },
  {
    version: "v1.16.0",
    date: "2026-06-25",
    highlights: [
      "The “Report Bug” button is now “Feedback” — send us a bug, a feature request, or an idea, all from one place",
      "New “My Reports” page shows everything you’ve sent us and whether it’s Open, Resolved, or Won’t-fix",
    ],
  },
  {
    version: "v1.15.0",
    date: "2026-06-24",
    highlights: [
      "Fresh new look — a navy and gold church theme across the whole app, with cleaner headings and a redesigned sidebar",
      "Redesigned dashboard grouped into Money, People and Needs-attention, with a giving trend compared to the same month last year",
      "Clearer money pages — colour-coded amounts (income green, expense red) and easy-to-read transaction cards on phones",
      "Loading placeholders and friendlier empty messages on the People, Families, Users and Events lists",
    ],
  },
  {
    version: "v1.14.0",
    date: "2026-06-24",
    highlights: [
      "Better on phones — pages no longer scroll sideways or get cut off on small screens",
      "People and Families lists now show easy-to-tap cards on mobile instead of a wide table",
    ],
  },
  {
    version: "v1.13.0",
    date: "2026-06-24",
    highlights: [
      "New “Remember this device” option at login — skip the emailed verification code for 14 days on devices you trust",
      "Stay signed in for up to 7 days when you choose to be remembered",
      "Review and remove your trusted devices anytime from the new My Account page",
    ],
  },
  {
    version: "v1.12.0",
    date: "2026-06-23",
    highlights: [
      "New Trial Balance report — debit/credit totals per account for the financial year",
      "New Cash Flow report — money in and out by category, plus opening and closing balances per account",
      "New General Ledger report — every transaction for an account with a running balance, exportable to CSV",
    ],
  },
  {
    version: "v1.11.0",
    date: "2026-06-23",
    highlights: [
      "Families can now add their marriage date when updating their details",
      "Easier date entry — pick dates from a calendar instead of typing them",
      "Staff get a dashboard card and a sidebar badge showing family update requests waiting to be reviewed",
    ],
  },
  {
    version: "v1.10.2",
    date: "2026-06-23",
    highlights: [
      "Family and registration pages now display correctly on phones",
      "Faster transaction and audit-log searches (results update as you type, without reloading)",
      "Giving Summary report gained a Print button, and is now viewable by auditors",
      "Many reliability, accessibility, and security improvements across accounting, petty cash, and events",
    ],
  },
  {
    version: "v1.10.1",
    date: "2026-06-20",
    highlights: [
      "Add the CRM to your phone's home screen — it now opens full-screen like an app",
      "Mobile-friendly layouts: forms and tables work properly on phones",
      "This “What’s New” page, so you can see what changed each update",
    ],
  },
  {
    version: "v1.10.0",
    date: "2026-06-19",
    highlights: [
      "Annual giving summary report — per-family totals for a financial year, with CSV export for acknowledgement letters",
      "Faster, debounced family search",
      "Reliability and security fixes across petty cash and accounting",
    ],
  },
]

// Exact string match against NEXT_PUBLIC_APP_VERSION. Returns undefined when
// there is no authored entry for the running version (e.g. "dev" locally, or a
// release whose entry has not been added yet) so callers can degrade gracefully.
export function findEntry(version?: string): WhatsNewEntry | undefined {
  if (!version) return undefined
  return WHATS_NEW.find((e) => e.version === version)
}
