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
  "src/app/(public)/e/[slug]/crew/layout.tsx": "events",
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
  "src/lib/actions/serviceType.ts": "pettyCash",
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

// Pages gated in the page itself (a layout would also block a sibling that
// must stay reachable, e.g. the public event success page after payment).
const GUARDED_PAGES: Record<string, string> = {
  "src/app/(public)/e/[slug]/page.tsx": "events",
}

it.each(Object.entries(GUARDED_PAGES))("%s calls requireFeature(%s)", (file, key) => {
  expect(read(file)).toContain(`await requireFeature("${key}")`)
})

it("the organiser home (/my-events) gates on events without a 404 dead end", () => {
  // Organisers land here (middleware); its own test covers redirect/notice.
  const src = read("src/app/(organiser)/my-events/layout.tsx")
  expect(src).toContain('features.has("events")')
  expect(src).not.toMatch(/requireFeature\(/)
})

it("the public event success page stays reachable (in-flight payments must show their confirmation)", () => {
  expect(fs.existsSync(path.join(process.cwd(), "src/app/(public)/e/layout.tsx"))).toBe(false)
  expect(fs.existsSync(path.join(process.cwd(), "src/app/(public)/e/[slug]/layout.tsx"))).toBe(false)
  expect(read("src/app/(public)/e/[slug]/success/page.tsx")).not.toMatch(/requireFeature/)
})

it.each(Object.entries(GUARDED_LAYOUTS))("%s calls requireFeature(%s)", (file, key) => {
  expect(read(file)).toContain(`await requireFeature("${key}")`)
})

// Module-private guard helpers that run assertNotDemo, auth, then the feature
// check, so an action calling one is gated. Each helper must itself guard (tested below).
const GUARD_HELPERS: Record<string, string[]> = {
  "src/lib/actions/sundaySchool.ts": ["editor", "editableClass"],
  "src/lib/actions/sundaySchoolAttendance.ts": ["rollGuard", "markerGuard"],
  "src/lib/actions/invoiceSend.ts": ["sendInvoiceGuarded"],
}

it.each(Object.entries(GUARD_HELPERS).flatMap(([file, fns]) => fns.map((fn) => [file, fn])))(
  "%s: guard helper %s checks the feature (directly or via another helper)", (file, fn) => {
    const src = read(file)
    const start = src.indexOf(`async function ${fn}(`)
    expect(start).toBeGreaterThan(-1)
    const next = src.slice(start + 1).search(/\n(?:export )?(?:async )?function /)
    expect(guards(src.slice(start, next === -1 ? undefined : start + 1 + next), GUARDED_ACTIONS[file], file)).toBe(true)
  })

it.each(Object.entries(GUARDED_ACTIONS))("%s: every exported action guards %s", (file, key) => {
  const src = read(file)
  const starts = [...src.matchAll(/^export async function (\w+)/gm)]
  expect(starts.length).toBeGreaterThan(0) // a mapped file with no actions is a stale entry
  const unguarded = starts
    .filter((m, i) => {
      if (EXEMPT[file]?.includes(m[1])) return false
      return !guards(src.slice(m.index, starts[i + 1]?.index ?? src.length), key, file)
    })
    .map((m) => m[1])
  expect(unguarded).toEqual([])
})

/**
 * True when a function body checks `key` (single, any-of, or throwing form),
 * or calls one of the file's GUARD_HELPERS.
 * @param body function source
 * @param key feature key
 * @param file source file, for its guard helpers
 */
function guards(body: string, key: string, file?: string): boolean {
  return body.includes(`featureGuard("${key}")`)
    || body.includes(`assertFeature("${key}")`)
    || new RegExp(`featureGuardAny\\(\\[[^\\]]*"${key}"`).test(body)
    || (file !== undefined && (GUARD_HELPERS[file] ?? []).some((h) => new RegExp(`(?:await|return) ${h}\\(`).test(body)))
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

// Action files deliberately not owned by one feature. Every "use server" file
// must be classified (GUARDED_ACTIONS, GUARDED_FUNCTIONS, or here), so a new
// file under a gated area can't ship unguarded by omission.
const CORE_ACTIONS = new Set([
  "auth.ts", "branding.ts", "checkpoint.ts", "family.ts", "features.ts", "feedback.ts", "passkey.ts",
  "person.ts", "publicFeedback.ts", "session.ts", "setup.ts", "totp.ts", "trustedDevice.ts", "user.ts",
  // Gated per template key (feature-owned templates only): emailTemplates.test.ts + the sweep.
  "emailTemplates.ts",
])

it("every Server Action file is classified (feature-owned, mixed, or core)", () => {
  const dir = "src/lib/actions"
  const unclassified = fs.readdirSync(path.join(process.cwd(), dir))
    .filter((f) => f.endsWith(".ts") && /^"use server"/m.test(read(`${dir}/${f}`)))
    .filter((f) => !(`${dir}/${f}` in GUARDED_ACTIONS) && !(`${dir}/${f}` in GUARDED_FUNCTIONS) && !CORE_ACTIONS.has(f))
  expect(unclassified).toEqual([])
})

// Public (anonymous) actions: honeypot/rate limit → feature, generic wording.
// Everything else must authenticate before the feature check.
const PUBLIC_ACTIONS = new Set([
  "membership.ts:submitMembershipApplication",
  "familyUpdate.ts:submitFamilyUpdate",
  "eventCheckout.ts:startEventCheckout",
  "eventCheckout.ts:startExistingRegistrationCheckout",
])

// Feature-only helpers (no auth of their own): their callers are checked instead.
const FEATURE_ONLY_HELPERS = new Set(["emailTemplates.ts:templateFeatureGuard"])

// A real role/permission check (not just "is there a session"): a role
// helper (isAdmin, canEdit, canEditOrOrganise, …) or a role comparison.
// DB-backed per-entity authz (canManageEvent, canMarkRoll) may follow the
// feature check, as long as a DB-free role check precedes it; they never
// count as that role check.
const ROLE_CHECK = /\b(?:isAdmin|can(?!ManageEvent\b|MarkRoll\b)[A-Z]\w*)\(|\.role\s*[!=]==|\brole\s*[!=]==/
const ACTION_AUTH = /await auth\(\)/
const ACTION_FEATURE = /[fF]eatureGuard\w*\(|assertFeature\(/

/**
 * Why `body` breaks demo → auth → role check → feature, or null when it doesn't.
 * @param body function source containing a feature check
 * @param authCall regex for the auth call (auth(), or a route's auth helper)
 * @param featureCall regex for the feature check
 */
function orderViolation(body: string, authCall: RegExp, featureCall: RegExp): string | null {
  const feature = indexFrom(body, featureCall)
  if (feature === Infinity) return null
  // A missing demo check is fine (-1); a missing auth or role check is not (Infinity).
  const demo = body.includes("assertNotDemo(") ? indexFrom(body, /assertNotDemo\(/) : -1
  const auth = indexFrom(body, authCall)
  const role = indexFrom(body, ROLE_CHECK, auth)
  const late = ([["demo", demo], ["auth", auth], ["role check", role]] as const).find(([, at]) => at > feature)
  return late ? `feature before ${late[0]}` : null
}

/**
 * Index of the first `re` match at or after `from`; Infinity when none.
 * @param body source text
 * @param re pattern to find
 * @param from start offset (Infinity → none)
 */
function indexFrom(body: string, re: RegExp, from = 0): number {
  if (from === Infinity) return Infinity
  const i = body.slice(from).search(re)
  return i === -1 ? Infinity : from + i
}

/**
 * Public actions: index of the first throttle and of the feature check.
 * @param body function source
 */
function throttleThenFeature(body: string): { throttle: number; feature: number } {
  return { throttle: indexFrom(body, /\b(?:db)?[rR]ateLimit\(/), feature: indexFrom(body, ACTION_FEATURE) }
}

describe("orderViolation (fixtures)", () => {
  const fn = (...lines: string[]) => lines.join("\n")
  it("accepts demo → auth → role → feature", () => {
    expect(orderViolation(fn("assertNotDemo()", "const session = await auth()",
      "if (!isAdmin(session?.user?.role)) return x", 'await featureGuard("events")'), ACTION_AUTH, ACTION_FEATURE)).toBeNull()
  })
  it("accepts auth → coarse role → feature → DB authz", () => {
    expect(orderViolation(fn("const session = await auth()",
      "if (!session?.user || !canEditOrOrganise(session.user.role)) return x", 'await featureGuard("events")',
      "if (!(await canManageEvent(1, 2, session.user.role))) return x"), ACTION_AUTH, ACTION_FEATURE)).toBeNull()
  })
  it("rejects a DB-backed check (canManageEvent) as the only check before the feature", () => {
    expect(orderViolation(fn("const session = await auth()",
      "if (!(await canManageEvent(1, 2, session?.user?.role))) return x", 'await featureGuard("events")'),
    ACTION_AUTH, ACTION_FEATURE)).toBe("feature before role check")
  })
  it("rejects auth → session-null → feature → role", () => {
    expect(orderViolation(fn("const session = await auth()", "if (!session?.user) return x",
      'await featureGuard("events")', "if (!canEdit(session.user.role)) return x"), ACTION_AUTH, ACTION_FEATURE))
      .toBe("feature before role check")
  })
  it("rejects feature → auth", () => {
    expect(orderViolation(fn('await featureGuard("events")', "const session = await auth()",
      "if (!canEdit(session?.user?.role)) return x"), ACTION_AUTH, ACTION_FEATURE)).toBe("feature before auth")
  })
  it("rejects feature → demo", () => {
    expect(orderViolation(fn('await featureGuard("events")', "assertNotDemo()"), ACTION_AUTH, ACTION_FEATURE))
      .toBe("feature before demo")
  })
})

it("demo → auth → role check → feature in every action and guard helper (no settings read or admin wording before authz)", () => {
  const dir = "src/lib/actions"
  const bad = fs.readdirSync(path.join(process.cwd(), dir))
    .filter((f) => f.endsWith(".ts"))
    .flatMap((f) => {
      const src = read(`${dir}/${f}`)
      // Slice at every top-level function so a private helper's body isn't
      // attributed to the export above it.
      const starts = [...src.matchAll(/^(?:export )?(?:async )?function (\w+)/gm)]
      return starts.flatMap((m, i) => {
        if (PUBLIC_ACTIONS.has(`${f}:${m[1]}`) || FEATURE_ONLY_HELPERS.has(`${f}:${m[1]}`)) return []
        const why = orderViolation(src.slice(m.index, starts[i + 1]?.index ?? src.length), ACTION_AUTH, ACTION_FEATURE)
        return why ? [`${f}:${m[1]}: ${why}`] : []
      })
    })
  expect(bad).toEqual([])
})

it.each([...PUBLIC_ACTIONS])("public action %s throttles before the feature check", (id) => {
  const [file, fn] = id.split(":")
  const src = read(`src/lib/actions/${file}`)
  const start = src.indexOf(`export async function ${fn}(`)
  const next = src.indexOf("\nexport ", start + 1)
  const { throttle, feature } = throttleThenFeature(src.slice(start, next === -1 ? undefined : next))
  expect(feature).toBeLessThan(Infinity)
  expect(throttle).toBeLessThan(feature)
})

// Public routes throttle → feature (anonymous by design); cron routes gate
// inside cronFeatureSkip (secret first). Every other gated route must sign in
// and role-check before featureNotFound, so feature state never leaks pre-auth.
const PUBLIC_ROUTES = new Set([
  "src/app/api/events/[slug]/register/route.ts",
  "src/app/api/events/[slug]/waitlist/route.ts",
  "src/app/api/events/[slug]/image/[kind]/route.ts",
])

it.each(Object.keys(GUARDED_ROUTES).filter((f) => !PUBLIC_ROUTES.has(f) && !f.includes("/api/cron/")))(
  "%s: every handler authenticates and role-checks before featureNotFound", (file) => {
    const src = read(file)
    const starts = [...src.matchAll(/^export async function (GET|POST|PUT|PATCH|DELETE)\(/gm)]
    const bad = starts.flatMap((m, i) => {
      let body = src.slice(m.index, starts[i + 1]?.index ?? src.length)
      expect(body).toContain("featureNotFound(")
      // guardAccountingExport does auth + canViewAccounting itself (exportGuard.ts).
      body = body.replace(/await guardAccountingExport\(/, "await auth() && canViewAccounting(")
      const why = orderViolation(body, ACTION_AUTH, /featureNotFound\(/)
      return why ? [`${m[1]}: ${why}`] : []
    })
    expect(bad).toEqual([])
  })

it("guardAccountingExport authenticates and role-checks (export routes rely on it)", () => {
  const src = read("src/lib/reports/exportGuard.ts")
  // auth → 401 early return → canViewAccounting → 403 early return, before anything else.
  expect(src).toMatch(new RegExp([
    String.raw`const session = await auth\(\)\s*`,
    String.raw`if \(!session\?\.user\) return [^\n]*status: 401[^\n]*\s*`,
    String.raw`if \(!canViewAccounting\(session\.user\.role\)\) \{\s*return [^\n]*status: 403`,
  ].join("")))
})
