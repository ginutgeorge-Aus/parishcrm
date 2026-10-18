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

it("maps only known feature keys", () => {
  for (const key of [...Object.values(GUARDED_LAYOUTS), ...Object.values(GUARDED_ACTIONS)]) {
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
      const body = src.slice(m.index, starts[i + 1]?.index ?? src.length)
      return !body.includes(`featureGuard("${key}")`) && !body.includes(`assertFeature("${key}")`)
    })
    .map((m) => m[1])
  expect(unguarded).toEqual([])
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
