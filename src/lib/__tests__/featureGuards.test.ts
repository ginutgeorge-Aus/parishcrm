/** @jest-environment node */
import fs from "node:fs"
import path from "node:path"
import { FEATURE_KEYS } from "@/lib/features"

// Static coverage: every route segment and Server Action owned by a feature
// must check that feature, so turning it off blocks it (not just hides it).
// New files under these areas need an entry here.

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8")

// Segment layout → feature.
const GUARDED_LAYOUTS: Record<string, string> = {
  "src/app/(dashboard)/events/layout.tsx": "events",
  "src/app/(organiser)/my-events/layout.tsx": "events",
  "src/app/(public)/e/layout.tsx": "events",
  "src/app/(print)/events/layout.tsx": "events",
  "src/app/(dashboard)/memberships/layout.tsx": "memberships",
  "src/app/(print)/memberships/layout.tsx": "memberships",
  "src/app/(public)/membershipform/layout.tsx": "memberships",
  "src/app/(print)/accounting/layout.tsx": "accounting",
  "src/app/(print)/petty-cash/layout.tsx": "pettyCash",
  "src/app/(dashboard)/sunday-school/layout.tsx": "sundaySchool",
  "src/app/(organiser)/my-classes/layout.tsx": "sundaySchool",
  "src/app/(dashboard)/welcome-letter/layout.tsx": "welcomeLetter",
  "src/app/(dashboard)/people/clearances/layout.tsx": "clearances",
  "src/app/(dashboard)/people/birthdays/layout.tsx": "celebrations",
  "src/app/(dashboard)/people/anniversaries/layout.tsx": "celebrations",
  "src/app/(dashboard)/families/updates/layout.tsx": "familyUpdates",
  "src/app/(dashboard)/families/[id]/giving/layout.tsx": "accounting",
  "src/app/(public)/family/layout.tsx": "familyUpdates",
  "src/app/(dashboard)/accounting/layout.tsx": "accounting",
  "src/app/(dashboard)/accounting/reconciliation/layout.tsx": "reconciliation",
  "src/app/(dashboard)/accounting/reports/reconciliation/layout.tsx": "reconciliation",
  "src/app/(dashboard)/accounting/import/layout.tsx": "bankImport",
  "src/app/(dashboard)/accounting/petty-cash/layout.tsx": "pettyCash",
  "src/app/(dashboard)/accounting/dues/layout.tsx": "dues",
  "src/app/(dashboard)/accounting/send-receipts/layout.tsx": "receipts",
  "src/app/(dashboard)/accounting/receipt-audit/layout.tsx": "receipts",
  "src/app/(dashboard)/accounting/dgr-receipts/layout.tsx": "dgrReceipts",
  "src/app/(dashboard)/accounting/invoices/layout.tsx": "invoices",
  "src/app/(dashboard)/accounting/customers/layout.tsx": "invoices",
  "src/app/(dashboard)/accounting/budget/layout.tsx": "budget",
  "src/app/(dashboard)/accounting/reports/budget-vs-actual/layout.tsx": "budget",
}

// Action file → feature. Every exported async function must call
// featureGuard(key) or assertFeature(key) (the throwing form, for readers
// whose result has no `{ error }` shape).
const GUARDED_ACTIONS: Record<string, string> = {
  "src/lib/actions/event.ts": "events",
  "src/lib/actions/registration.ts": "events",
  "src/lib/actions/waitlist.ts": "events",
  "src/lib/actions/eventCheckout.ts": "events",
  "src/lib/actions/eventAccess.ts": "events",
  "src/lib/actions/membership.ts": "memberships",
  "src/lib/actions/sundaySchool.ts": "sundaySchool",
  "src/lib/actions/sundaySchoolAttendance.ts": "sundaySchool",
  "src/lib/actions/clearance.ts": "clearances",
  "src/lib/actions/familyUpdate.ts": "familyUpdates",
  "src/lib/actions/birthday.ts": "celebrations",
  "src/lib/actions/anniversary.ts": "celebrations",
  "src/lib/actions/reconciliation.ts": "reconciliation",
  "src/lib/actions/transactionReconcile.ts": "reconciliation",
  "src/lib/actions/invoice.ts": "invoices",
  "src/lib/actions/invoiceSend.ts": "invoices",
  "src/lib/actions/invoiceVoid.ts": "invoices",
  "src/lib/actions/invoicePayment.ts": "invoices",
  "src/lib/actions/invoiceSettings.ts": "invoices",
  "src/lib/actions/customer.ts": "invoices",
  "src/lib/actions/welcomeLetter.ts": "welcomeLetter",
  "src/lib/actions/dgrReceipt.ts": "dgrReceipts",
  "src/lib/actions/receipt.ts": "receipts",
  "src/lib/actions/receiptSettings.ts": "receipts",
  "src/lib/actions/pettyCashExpense.ts": "pettyCash",
  "src/lib/actions/pettyCashImport.ts": "pettyCash",
  "src/lib/actions/pettyCashReceipt.ts": "pettyCash",
  "src/lib/actions/pettyCashSession.ts": "pettyCash",
  "src/lib/actions/pettyCashTransfer.ts": "pettyCash",
  "src/lib/actions/budget.ts": "budget",
  "src/lib/actions/transaction.ts": "accounting",
  "src/lib/actions/transactionAttachment.ts": "accounting",
  "src/lib/actions/account.ts": "accounting",
  "src/lib/actions/accountGroup.ts": "accounting",
  "src/lib/actions/fund.ts": "accounting",
  "src/lib/actions/paymentAccount.ts": "accounting",
  "src/lib/actions/accountingSettings.ts": "accounting",
}

// Exports deliberately left ungated, with the reason.
const EXEMPT: Record<string, string[]> = {
  // Organiser picker, also used by Sunday School class pages.
  "src/lib/actions/eventAccess.ts": ["listAssignableOrganisers"],
}

// API route → feature. Every handler 404s (or, for cron, skips) while off.
const GUARDED_ROUTES: Record<string, string> = {
  "src/app/api/events/[slug]/register/route.ts": "events",
  "src/app/api/events/[slug]/waitlist/route.ts": "events",
  "src/app/api/events/[slug]/export-csv/route.ts": "events",
  "src/app/api/events/[slug]/image/[kind]/route.ts": "events",
  "src/app/api/welcome-letter/preview/route.ts": "welcomeLetter",
  "src/app/api/clearances/export/route.ts": "clearances",
  "src/app/api/people/[id]/clearances/[clearanceId]/route.ts": "clearances",
  "src/app/api/import/bank-statement/route.ts": "bankImport",
  "src/app/api/import/bank-statement/confirm/route.ts": "bankImport",
  "src/app/api/accounting/reports/general-ledger/export-csv/route.ts": "accounting",
  "src/app/api/accounting/reports/trial-balance/export-csv/route.ts": "accounting",
  "src/app/api/accounting/reports/balance-sheet/export-csv/route.ts": "accounting",
  "src/app/api/accounting/reports/cash-flow/export-csv/route.ts": "accounting",
  "src/app/api/accounting/reports/giving-summary/export-csv/route.ts": "accounting",
  "src/app/api/accounting/reports/budget-vs-actual/export-csv/route.ts": "budget",
  "src/app/api/accounting/transactions/export-csv/route.ts": "accounting",
  "src/app/api/accounting/transactions/[id]/attachments/[attachmentId]/route.ts": "accounting",
  "src/app/api/cron/send-reminders/route.ts": "events",
  "src/app/api/cron/send-celebrations/route.ts": "celebrations",
  "src/app/api/cron/send-clearance-digest/route.ts": "clearances",
  // Route handlers inside gated page segments: a segment layout never wraps a route.ts.
  "src/app/(dashboard)/accounting/dgr-receipts/[id]/pdf/route.ts": "dgrReceipts",
  "src/app/(dashboard)/accounting/invoices/[id]/pdf/route.ts": "invoices",
}

it("every route.ts inside a gated segment is itself gated", () => {
  const walk = (dir: string): string[] =>
    fs.readdirSync(path.join(process.cwd(), dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(`${dir}/${e.name}`) : e.name === "route.ts" ? [`${dir}/${e.name}`] : [])
  const segments = Object.keys(GUARDED_LAYOUTS).map((f) => path.dirname(f))
  const ungated = segments.flatMap(walk).filter((f) => !(f in GUARDED_ROUTES))
  expect([...new Set(ungated)]).toEqual([])
})

it.each(Object.entries(GUARDED_ROUTES))("%s: every handler gates %s", (file, key) => {
  const src = read(file)
  const handlers = src.match(/^export async function (GET|POST|PUT|PATCH|DELETE)\(/gm) ?? []
  expect(handlers.length).toBeGreaterThan(0)
  const gates = src.match(new RegExp(`(featureNotFound\\("${key}"\\)|cronFeatureSkip\\([^)]*\\), "${key}"\\))`, "g")) ?? []
  expect(gates.length).toBeGreaterThanOrEqual(handlers.length)
})

it("the Stripe webhook and checkout sweep stay ungated (in-flight payments must settle)", () => {
  for (const f of ["src/app/api/stripe/webhook/route.ts", "src/app/api/cron/sweep-checkouts/route.ts"]) {
    expect(read(f)).not.toMatch(/featureNotFound|cronFeatureSkip|isFeatureOn/)
  }
})

it("maps only known feature keys", () => {
  for (const key of [...Object.values(GUARDED_LAYOUTS), ...Object.values(GUARDED_ACTIONS), ...Object.values(GUARDED_ROUTES)]) {
    expect(FEATURE_KEYS).toContain(key)
  }
})

it.each(Object.entries(GUARDED_LAYOUTS))("%s calls requireFeature(%s)", (file, key) => {
  expect(read(file)).toContain(`await requireFeature("${key}")`)
})

it.each(Object.entries(GUARDED_ACTIONS))("%s: every exported action guards %s", (file, key) => {
  const src = read(file)
  const starts = [...src.matchAll(/^export async function (\w+)/gm)]
  expect(starts.length).toBeGreaterThan(0) // a mapped file with no actions is a stale entry
  const unguarded = starts
    .filter((m, i) => {
      if (EXEMPT[file]?.includes(m[1])) return false
      return !guards(src.slice(m.index, starts[i + 1]?.index ?? src.length), key)
    })
    .map((m) => m[1])
  expect(unguarded).toEqual([])
})

/** True when a function body checks `key` (single, any-of, or throwing form). */
function guards(body: string, key: string): boolean {
  return body.includes(`featureGuard("${key}")`)
    || body.includes(`assertFeature("${key}")`)
    || new RegExp(`featureGuardAny\\(\\[[^\\]]*"${key}"`).test(body)
}

// Mixed files (core + feature-owned functions): function → feature.
const GUARDED_FUNCTIONS: Record<string, Record<string, string>> = {
  "src/lib/actions/settings.ts": {
    updateBirthdayTemplate: "celebrations",
    sendTestBirthdayEmail: "celebrations",
    updateAnniversaryTemplate: "celebrations",
    sendTestAnniversaryEmail: "celebrations",
    updateAutoEmailFlags: "celebrations",
    updatePettyCashCustodian: "pettyCash",
    updateLetterSettings: "welcomeLetter",
    updateMembershipSettings: "memberships",
  },
}

it.each(Object.entries(GUARDED_FUNCTIONS).flatMap(([file, fns]) => Object.entries(fns).map(([fn, key]) => [file, fn, key])))(
  "%s: %s guards %s", (file, fn, key) => {
    const src = read(file)
    const start = src.indexOf(`export async function ${fn}(`)
    expect(start).toBeGreaterThan(-1)
    const next = src.indexOf("\nexport ", start + 1)
    expect(guards(src.slice(start, next === -1 ? undefined : next), key)).toBe(true)
  })

it("every Server Action file in a feature area is mapped", () => {
  // A new "use server" file whose name matches a feature area must be added above.
  const area = /^(event|registration|waitlist|membership|sundaySchool|clearance|familyUpdate|birthday|anniversary|reconcil|transaction|invoice|customer|welcomeLetter|dgrReceipt|receipt|pettyCash|budget|account|fund|paymentAccount)/
  const dir = "src/lib/actions"
  const unmapped = fs.readdirSync(path.join(process.cwd(), dir))
    .filter((f) => f.endsWith(".ts") && area.test(f))
    .map((f) => `${dir}/${f}`)
    .filter((f) => /^"use server"/m.test(read(f)) && !(f in GUARDED_ACTIONS))
  expect(unmapped).toEqual([])
})
