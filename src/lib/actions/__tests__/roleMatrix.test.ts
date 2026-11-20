/**
 * @jest-environment node
 *
 * AUD-7-07 role matrix. GENERATED from source: scans every src/lib/actions/*.ts,
 * finds each exported async function that opens with a negated roleGuard check
 * (`if (!canX(session?.user?.role)) ...` or `canX(...) === false` before any DB
 * access; comments and strings ignored), and for every role that the REAL
 * roleGuard helpers refuse, asserts the action performs no Prisma write. Writes
 * are model write methods, `$executeRaw*`, and `$queryRaw*` whose SQL writes or locks;
 * `$transaction` itself is not a write, only what runs inside it. Covers OFFICE_ADMIN being refused on admin-only / PASTOR+ADMIN
 * actions (the audit's nearest-miss role). roleGuard is never mocked.
 */
import fs from "node:fs"
import path from "node:path"
import { UserRole } from "@/lib/generated/prisma/enums"
import * as roleGuard from "@/lib/roleGuard"

type Role = (typeof UserRole)[keyof typeof UserRole]

const WRITE_METHODS = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
  "$executeRaw",
  "$executeRawUnsafe",
])
/** Raw SQL that mutates state (INSERT/UPDATE/DELETE, advisory locks); a plain SELECT is a read. */
const RAW_WRITE_SQL =
  /\b(insert|update|delete|truncate|alter|drop|create|merge|copy|lock|set_config|nextval|setval)\b|\bfor\s+(share|no\s+key)\b|\binto\b|pg_(try_)?advisory/i

/**
 * True when a `$queryRaw` / `$queryRawUnsafe` call carries SQL that writes. Tagged templates pass a
 * strings array first; the Unsafe form passes the SQL string itself.
 * @param args the arguments the mocked raw-query method received
 */
function rawQueryWrites(args: unknown[]): boolean {
  const first = args[0]
  // Any other shape (e.g. a Prisma.sql object) cannot be inspected here: count it as a write.
  if (!Array.isArray(first) && typeof first !== "string") return true
  const sql = Array.isArray(first) ? first.join(" ") : first
  return RAW_WRITE_SQL.test(sql)
}
const writes: string[] = []
let currentRole: Role | undefined
/** Rows the mocked `findMany` returns; empty unless a case needs a non-empty read to prove a refusal. */
let findManyRows: unknown[] = []

jest.mock("server-only", () => ({}))
jest.mock("@/auth", () => ({
  auth: jest.fn(async () => ({ user: { id: "actor-1", role: currentRole, email: "a@example.com" } })),
  signIn: jest.fn(),
  signOut: jest.fn(),
  unstable_update: jest.fn(),
}))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn(), revalidateTag: jest.fn(), unstable_cache: (f: unknown) => f }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn((u: string) => {
    throw new Error(`REDIRECT:${u}`)
  }),
  notFound: jest.fn(() => {
    throw new Error("NOT_FOUND")
  }),
}))
jest.mock("@/lib/prisma", () => {
  const model = (name: string): unknown =>
    new Proxy(
      {},
      {
        get: (_t, method: string) =>
          jest.fn(async () => {
            if (WRITE_METHODS.has(method)) writes.push(`${name}.${method}`)
            return method.startsWith("find") ? (method === "findMany" ? findManyRows : null) : method === "count" ? 0 : undefined
          }),
      },
    )
  // Interactive transactions run their callback against the same proxy, so a write made through
  // `tx` inside the callback is recorded (the $transaction call itself is not a write; its
  // contents are). Array-form transactions already recorded their writes when the items were built.
  const client: unknown = new Proxy(
    {},
    {
      get: (_t, key: string) => {
        if (key === "$transaction") {
          return jest.fn(async (arg: unknown) =>
            typeof arg === "function" ? (arg as (tx: unknown) => unknown)(client) : Array.isArray(arg) ? Promise.all(arg) : undefined,
          )
        }
        if (key.startsWith("$")) {
          return jest.fn(async (...args: unknown[]) => {
            if (WRITE_METHODS.has(key)) writes.push(key)
            else if ((key === "$queryRaw" || key === "$queryRawUnsafe") && rawQueryWrites(args)) writes.push(`${key}(write)`)
            return []
          })
        }
        if (key === "then") return undefined
        return model(key)
      },
    },
  )
  return { prisma: client, __esModule: true }
})
// External side effects must never run for real.
jest.mock("@/lib/notifications", () => new Proxy({}, { get: () => jest.fn(async () => undefined) }))
jest.mock("@/lib/stripe", () => new Proxy({ __esModule: true }, { get: (t, k) => (k in t ? (t as never)[k] : jest.fn()) }))

const ACTIONS_DIR = path.join(__dirname, "..")
const HELPERS = Object.entries(roleGuard)
  .filter(([, v]) => typeof v === "function")
  .map(([k]) => k)
  .filter((k) => k !== "canAssignRole") // two-arg helper, per-target; covered in user.ts tests
const ALL_ROLES = Object.values(UserRole) as Role[]
// The six roles named in the audit; Sunday-school roles are included via ALL_ROLES.
const AUDIT_ROLES: Role[] = ["ADMIN", "PASTOR", "OFFICE_ADMIN", "AUDITOR", "VIEWER", "EVENT_ORGANISER"] as Role[]

type Entry = { file: string; fn: string; guards: string[] }

/** Source of a top-level function: from its start to the first column-0 closing brace. */
function bodyOf(src: string, start: number): string {
  const end = src.indexOf("\n}\n", start)
  return src.slice(start, end === -1 ? src.length : end + 2)
}

/**
 * Blank out comments and string/template literals (keeping length) so a guard-looking token inside
 * them is not mistaken for code.
 * @param src source text
 */
function stripCommentsAndStrings(src: string): string {
  return src.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, (m) => " ".repeat(m.length))
}

/**
 * Role helpers used as a refusal before the first DB access in the body: `!canX(`, `canX(...) === false`
 * and `false === canX(`. Comments and strings are ignored.
 * @param body source of one exported function
 */
function leadingGuards(body: string): string[] {
  const code = stripCommentsAndStrings(body)
  const firstDb = code.search(/\bprisma\b|\btx\./)
  const head = firstDb === -1 ? code : code.slice(0, firstDb)
  return HELPERS.filter((h) =>
    new RegExp(`(?<!!)!\\s*${h}\\(|\\bfalse\\s*===?\\s*${h}\\(|\\b${h}\\([^()]*(?:\\([^()]*\\)[^()]*)*\\)\\s*===?\\s*false`).test(head),
  )
}

function discover(): Entry[] {
  const out: Entry[] = []
  for (const file of fs.readdirSync(ACTIONS_DIR).filter((f) => f.endsWith(".ts")).sort()) {
    const src = fs.readFileSync(path.join(ACTIONS_DIR, file), "utf8")
    if (!src.includes("roleGuard")) continue
    for (const m of src.matchAll(/^export async function (\w+)\s*\(/gm)) {
      const body = bodyOf(src, m.index!)
      const guards = leadingGuards(body)
      if (guards.length) out.push({ file: file.replace(/\.ts$/, ""), fn: m[1], guards })
    }
  }
  return out
}

/** A value that survives any property access, call, string or number coercion. */
function anyArg(): unknown {
  const f = function () {}
  return new Proxy(f, {
    get: (_t, k) => {
      if (k === Symbol.toPrimitive) return (hint: string) => (hint === "number" ? 1 : "1")
      if (k === "then") return undefined
      if (k === Symbol.iterator) return function* () {}
      return anyArg()
    },
    apply: () => anyArg(),
  })
}

/**
 * True for the shapes guarded actions return when they refuse: an `{ error }` result, an empty
 * read (null, false, [] or {}), or the petty-cash `{ status: "not-editor" }` signal. Anything else
 * (a success flag, a populated payload, a bare undefined) is not a refusal.
 * @param r the action's resolved value
 */
function isRefusalShape(r: unknown): boolean {
  if (r === null || r === false) return true
  if (Array.isArray(r)) return r.length === 0
  if (r && typeof r === "object") {
    const o = r as Record<string, unknown>
    // A success flag beats any refusal marker: `{ success: true, error: "x" }` is not a refusal.
    if (o.success || o.ok) return false
    if (typeof o.error === "string") return true
    if (o.status === "not-editor") return true
    return Object.keys(o).length === 0
  }
  return false
}

/**
 * True when a thrown value is one of the refusal errors the next/navigation mock raises
 * (`redirect` or `notFound`), rather than an unrelated crash that happened to stop the action.
 * @param e the thrown value
 */
function isRefusalThrow(e: unknown): boolean {
  return e instanceof Error && /^(REDIRECT:|NOT_FOUND$)/.test(e.message)
}

/**
 * Fixtures for actions that return an empty read for the default junk arguments, which would make a
 * removed guard indistinguishable from a refusal. Each gives real arguments and the rows `findMany`
 * returns, so without its guard the action would hand back a non-empty result.
 */
const READ_FIXTURES: Record<string, { args: unknown[]; rows: unknown[] }> = {
  "sacrament.searchSacramentPeople": {
    args: ["smith"],
    rows: [{ id: 1, firstName: "Sam", lastName: "Smith", family: { name: "Smith" } }],
  },
}

/** An empty FormData, passed as the second argument of every action. */
function formData(): FormData {
  return new FormData()
}

const ENTRIES = discover()

/** Error messages thrown by the redirect/notFound mocks: the only throws that count as a refusal. */
const REFUSAL_THROW = /^(REDIRECT:\/(login|unauthorized|forbidden)\b|NOT_FOUND$)/

/**
 * Pinned guarded-export set, one `file.fn:guard[,guard]` per line. Discovery only
 * sees exports whose guard is still a leading negated helper, so a removed or
 * rewritten guard silently drops the export from the matrix. Comparing against
 * this list in both directions makes that fail loudly; add new guarded exports here.
 */
const EXPECTED_GUARDED = `
account.createAccount:isAdmin
account.updateAccount:isAdmin
account.deleteAccount:isAdmin
accountGroup.createAccountGroup:isAdmin
accountGroup.updateAccountGroup:isAdmin
accountGroup.deleteAccountGroup:isAdmin
accountingSettings.upsertOpeningBalance:isAdmin
accountingSettings.setAccountingLockDate:isAdmin
anniversary.sendAnniversaryEmail:canEdit
anniversary.sendAnniversaryEmailsBulk:canEdit
attendance.getHeadcount:canEditAttendance
attendance.saveHeadcount:canEditAttendance
attendance.deleteHeadcount:canEditAttendance
bankImport.rememberBankImportAccount:canAccessAccounting
birthday.sendBirthdayEmail:canEdit
birthday.sendBirthdayEmailsBulk:canEdit
branding.uploadBranding:isAdmin
branding.resetBranding:isAdmin
budget.upsertBudgets:isAdmin
budget.saveBudgetVarianceNote:canAccessAccounting
budget.getPrevYearBudgets:isAdmin
checkpoint.markWorking:isAdmin
checkpoint.markBroken:isAdmin
clearance.upsertClearance:canManageClearances
clearance.verifyClearance:canManageClearances
clearance.unverifyClearance:canManageClearances
clearance.deleteClearance:canManageClearances
clearance.verifyClearancesBulk:canManageClearances
customer.createCustomer:canAccessAccounting
customer.updateCustomer:canAccessAccounting
customer.setCustomerActive:canAccessAccounting
customer.createCustomerInline:canAccessAccounting
customer.listCustomers:canViewAccounting
customer.getCustomerForEdit:canAccessAccounting
dgrReceipt.createDgrReceipt:canAccessAccounting
dgrReceipt.updateDgrReceipt:canAccessAccounting
dgrReceipt.deleteDgrReceipt:canAccessAccounting
dgrReceipt.sendDgrReceipt:canAccessAccounting
dgrReceipt.getDonorEmail:canAccessAccounting
dgrReceipt.listDgrReceipts:canViewAccounting
emailTemplates.updateEmailTemplate:isAdmin
emailTemplates.resetEmailTemplate:isAdmin
emailTemplates.previewEmailTemplate:isAdmin
emailTemplates.sendTestEmail:isAdmin
event.createEvent:canEdit
event.updateEvent:canEdit
event.deleteEvent:isAdmin
event.publishEvent:canEdit
event.setRegistrationClosed:canEdit
event.resyncEventsToWebsite:isAdmin
eventAccess.setVolunteerView:canEdit
eventAccess.regenerateVolunteerToken:canEdit
eventAccess.addEventManager:canEdit
eventAccess.removeEventManager:canEdit
eventAccess.listAssignableOrganisers:canEdit
eventManaged.updateManagedEvent:canEditOrOrganise
family.createFamily:canEdit
family.updateFamily:canEdit
family.deleteFamily:isAdmin
family.archiveFamily:isAdmin
family.unarchiveFamily:isAdmin
family.previewMerge:isAdmin
family.mergeFamilies:isAdmin
familyUpdate.sendFamilyUpdateInvite:canEdit
familyUpdate.approveFamilyUpdate:canEdit
familyUpdate.rejectFamilyUpdate:canEdit
features.saveFeatures:isAdmin
features.finishFeatureOnboarding:isAdmin
followUp.createFollowUpTask:canManageFollowUps
followUp.updateFollowUpTask:canManageFollowUps
followUp.deleteFollowUpTask:canManageFollowUps
fund.createFund:isAdmin
fund.updateFund:isAdmin
fund.deleteFund:isAdmin
fund.validateFund:canAccessAccounting
fund.getActiveFunds:canViewAccounting
fundraiser.getReminderPlan:canManageFundraiser
givingStatement.listGivingStatements:canViewAccounting
givingStatement.sendGivingStatements:canAccessAccounting
givingStatement.listStatementSendLog:canViewAccounting
groupMessage.sendGroupMessage:canEditOrOrganise
invoice.createInvoice:canAccessAccounting
invoice.updateInvoice:canAccessAccounting
invoice.deleteDraftInvoice:canAccessAccounting
invoice.getInvoice:canViewAccounting
invoice.listInvoices:canViewAccounting
invoice.getInvoiceSummary:canViewAccounting
invoice.getRecipientContact:canAccessAccounting
invoicePayment.markInvoicePaid:canAccessAccounting
invoicePayment.unmarkInvoicePaid:canAccessAccounting
invoicePayment.listPaymentCandidates:canAccessAccounting
invoiceSend.resendInvoice:canAccessAccounting
invoiceSettings.updateInvoiceSettings:isAdmin
invoiceVoid.voidInvoice:canAccessAccounting
membership.findMembershipMatches:canEdit
membership.approveMembershipApplication:canEdit
membership.rejectMembershipApplication:canEdit
paymentAccount.createPaymentAccount:isAdmin
paymentAccount.renamePaymentAccount:isAdmin
paymentAccount.setDefaultAccount:isAdmin
paymentAccount.setAccountActive:isAdmin
person.createPerson:canEdit
person.updatePerson:canEdit
person.deletePerson:isAdmin
pettyCashExpense.createExpense:canAccessAccounting
pettyCashExpense.updateExpense:canAccessAccounting
pettyCashExpense.deleteExpense:isAdmin
pettyCashImport.previewImport:isAdmin
pettyCashImport.commitImport:isAdmin
pettyCashReceipt.createReceipt:canAccessAccounting
pettyCashReceipt.updateReceipt:canAccessAccounting
pettyCashReceipt.deleteReceipt:isAdmin
pettyCashSession.createSession:canAccessAccounting
pettyCashSession.updateSessionCustodian:canAccessAccounting
pettyCashSession.ensureWeeklySession:canAccessAccounting
pettyCashSession.closeSession:canAccessAccounting
pettyCashSession.deleteSession:isAdmin
pettyCashTransfer.createTransfer:canAccessAccounting
pettyCashTransfer.deleteTransfer:isAdmin
pettyCashTransfer.updateTransfer:canAccessAccounting
prayerRequest.createPrayerRequest:canManagePrayerRequests
prayerRequest.updatePrayerRequest:canManagePrayerRequests
prayerRequest.withdrawPrayerShareConsent:canManagePrayerRequests
prayerRequest.setPrayerRequestStatus:canManagePrayerRequests
prayerRequest.listPrayerRequests:canManagePrayerRequests
prayerRequest.getPrayerRequest:canManagePrayerRequests
prayerRequest.listShareablePrayerRequests:canViewSharedPrayerRequests
receipt.sendSingleReceipt:canAccessAccounting
receipt.sendBatchReceipts:canAccessAccounting
receipt.fetchTransactionsForReceipt:canAccessAccounting
receiptSettings.updateReceiptSettings:isAdmin
receiptSettings.resetReceiptSettings:isAdmin
reconciliation.saveStatementBalance:canAccessAccounting
registration.markPaid:canEdit
registration.cancelRegistration:canEdit
registration.toggleAttendeeCheckIn:canEditOrOrganise
registration.resetEventRegistrations:isAdmin
registration.getRegistrationDetail:canEditOrOrganise,canViewPeople
registration.sendPaymentReminders:canEditOrOrganise
registration.lastRemindedAtByRegistration:canEditOrOrganise
rosterFeed.rotateRosterFeedToken:canManageRoster
sacrament.createSacramentRecord:canEditSacraments
sacrament.updateSacramentRecord:canEditSacraments
sacrament.deleteSacramentRecord:canEditSacraments
sacrament.searchSacramentPeople:canEditSacraments
sacrament.getSacramentRecord:canViewSacraments
serviceType.createServiceType:isAdmin
serviceType.toggleServiceTypeActive:isAdmin
serviceType.deleteServiceType:isAdmin
settings.upsertSetting:isAdmin
settings.updateChurchInfo:isAdmin
settings.updateBirthdayTemplate:isAdmin
settings.sendTestBirthdayEmail:isAdmin
settings.updateAnniversaryTemplate:isAdmin
settings.sendTestAnniversaryEmail:isAdmin
settings.updateAutoEmailFlags:isAdmin
settings.updatePettyCashCustodian:isAdmin
settings.updateLetterSettings:isAdmin
settings.updateMembershipSettings:isAdmin
sundaySchool.lockSundaySchoolYear:isAdmin
sundaySchool.unlockSundaySchoolYear:isAdmin
transaction.validateAccount:canAccessAccounting
transaction.createTransaction:canAccessAccounting
transaction.updateTransaction:canAccessAccounting
transaction.deleteTransaction:isAdmin
transactionAttachment.attachTransactionReceipt:canAccessAccounting
transactionAttachment.removeTransactionReceipt:canAccessAccounting
transactionReconcile.toggleReconciled:canAccessAccounting
transactionReconcile.reconcileMany:canAccessAccounting
user.createUser:canManageUsers
user.updateUser:canManageUsers
user.unlockUser:canManageUsers
user.resetUserTotp:canManageUsers
user.revokeUserPasskeys:canManageUsers
user.deleteUser:canManageUsers
user.resendWelcome:canManageUsers
venueCalendar.resetVenueCalendarLink:isAdmin
venueUsage.createVenueUsage:canEdit
venueUsage.updateVenueUsage:canEdit
venueUsage.deleteVenueUsage:canEdit
venueUsage.addAllSundays:canEdit
venueUsage.setVenueUsageStatus:canEdit
venueUsage.updateVenueUsageSettings:isAdmin
venueUsage.getVenueRequestPreview:canEdit
venueUsage.sendVenueUsageRequest:canEdit
waitlist.markWaitlistNotified:canEdit
welcomeLetter.buildWelcomeLetterDraft:canEdit
welcomeLetter.sendWelcomeLetter:canEdit
`
  .trim()
  .split("\n")

/**
 * Pinned ALLOWED roles per helper used by a guarded action. The refused set is
 * every other role, so widening or narrowing a helper in roleGuard.ts fails here
 * instead of silently regenerating the matrix expectation.
 */
const EDITORS: Role[] = ["ADMIN", "PASTOR", "OFFICE_ADMIN"] as Role[]
const PASTORAL: Role[] = ["ADMIN", "PASTOR"] as Role[]
const PINNED_ALLOWED: Record<string, Role[]> = {
  isAdmin: ["ADMIN"] as Role[],
  canEdit: EDITORS,
  canEditAttendance: EDITORS,
  canManageClearances: EDITORS,
  canManageRoster: EDITORS,
  canManageFundraiser: EDITORS,
  canViewSharedPrayerRequests: EDITORS,
  canViewSacraments: EDITORS,
  canAccessAccounting: PASTORAL,
  canManageFollowUps: PASTORAL,
  canManagePrayerRequests: PASTORAL,
  canEditSacraments: PASTORAL,
  canViewAccounting: ["ADMIN", "PASTOR", "AUDITOR", "OFFICE_ADMIN"] as Role[],
  canEditOrOrganise: ["ADMIN", "PASTOR", "OFFICE_ADMIN", "EVENT_ORGANISER"] as Role[],
  canViewPeople: ["ADMIN", "PASTOR", "VIEWER", "OFFICE_ADMIN"] as Role[],
  canManageUsers: ["ADMIN", "OFFICE_ADMIN"] as Role[],
}

describe("role matrix: generated from src/lib/actions", () => {
  it("discovers exactly the pinned guarded-export set (a removed/rewritten guard fails here)", () => {
    // Sorted-set comparison: independent of directory/declaration order, and the diff names the delta.
    const found = ENTRIES.map((e) => `${e.file}.${e.fn}:${e.guards.join(",")}`).sort()
    expect(found).toEqual([...EXPECTED_GUARDED].sort())
  })

  it("every helper used by a guarded action has a pinned refused-role set that matches roleGuard", () => {
    const used = new Set(ENTRIES.flatMap((e) => e.guards))
    for (const h of used) {
      expect(Object.keys(PINNED_ALLOWED)).toContain(h)
    }
    const fns = roleGuard as unknown as Record<string, (r: Role) => boolean>
    for (const [h, allowed] of Object.entries(PINNED_ALLOWED)) {
      expect(ALL_ROLES.filter((r) => fns[h](r))).toEqual(ALL_ROLES.filter((r) => allowed.includes(r)))
    }
  })

  it("leadingGuards ignores comments/strings, rejects !!canX, and accepts canX(...) === false", () => {
    expect(leadingGuards('// if (!isAdmin(r)) return\nconst s = "!isAdmin("\nawait prisma.x.create()')).toEqual([])
    expect(leadingGuards("const ok = !!isAdmin(r)\nawait prisma.x.create()")).toEqual([])
    expect(leadingGuards("if (isAdmin(session?.user?.role) === false) return\nawait prisma.x.create()")).toEqual(["isAdmin"])
    expect(leadingGuards("if (!isAdmin(r)) return\nawait prisma.x.create()")).toEqual(["isAdmin"])
  })

  it("rawQueryWrites treats SELECT as a read and writes, locks and unknown shapes as writes", () => {
    expect(rawQueryWrites([["SELECT id FROM t WHERE a = ", ""]])).toBe(false)
    expect(rawQueryWrites(["INSERT INTO t VALUES (1)"])).toBe(true)
    expect(rawQueryWrites([["SELECT 1 FROM t FOR SHARE"]])).toBe(true)
    expect(rawQueryWrites([{ sql: "UPDATE t" }])).toBe(true)
  })

  it("isRefusalShape rejects a success flag even when an error marker is present", () => {
    expect(isRefusalShape({ error: "Unauthorized" })).toBe(true)
    expect(isRefusalShape({ success: true, error: "Unauthorized" })).toBe(false)
    expect(isRefusalShape({ ok: true, status: "not-editor" })).toBe(false)
  })

  it("every read fixture targets a discovered guarded export", () => {
    const found = new Set(ENTRIES.map((e) => `${e.file}.${e.fn}`))
    for (const k of Object.keys(READ_FIXTURES)) expect(found).toContain(k)
  })

  it("audit roles are all real UserRole values", () => {
    for (const r of AUDIT_ROLES) expect(ALL_ROLES).toContain(r)
  })

  it("OFFICE_ADMIN is refused by canAccessAccounting but allowed by canEdit (nearest-miss role)", () => {
    expect(roleGuard.canAccessAccounting("OFFICE_ADMIN" as Role)).toBe(false)
    expect(roleGuard.canEdit("OFFICE_ADMIN" as Role)).toBe(true)
  })

  const cases = ENTRIES.flatMap((e) =>
    ALL_ROLES.filter((role) => e.guards.some((g) => !(roleGuard as unknown as Record<string, (r: Role) => boolean>)[g](role))).map(
      (role) => [`${e.file}.${e.fn} [${e.guards.join(",")}]`, e, role] as const,
    ),
  )

  it("generates refusal cases for every audit role", () => {
    const seen = new Set(cases.map(([, , r]) => r))
    for (const r of AUDIT_ROLES.filter((x) => x !== "ADMIN")) expect(seen).toContain(r)
    expect(cases.some(([, , r]) => r === "OFFICE_ADMIN")).toBe(true)
  })

  beforeEach(() => {
    writes.length = 0
    findManyRows = []
  })

  it.each(cases.map(([label, entry, role]) => [`${label} / ${role}`, entry, role] as const))("%s refuses with no DB write", async (_label, entry, role) => {
    currentRole = role
    const mod = (await import(`@/lib/actions/${entry.file}`)) as Record<string, (...a: unknown[]) => Promise<unknown>>
    let result: unknown
    let thrown: unknown
    try {
      const fixture = READ_FIXTURES[`${entry.file}.${entry.fn}`]
      if (fixture) findManyRows = fixture.rows
      result = await mod[entry.fn](...(fixture ? fixture.args : [anyArg(), formData(), anyArg()]))
    } catch (e) {
      thrown = e
    }
    expect(writes).toEqual([])
    // A refusal is a returned error/empty shape or a thrown redirect/not-found error. Any other
    // throw is a crash, not a refusal, and any other result is a success payload.
    if (thrown === undefined) expect(isRefusalShape(result)).toBe(true)
    else expect(isRefusalThrow(thrown)).toBe(true)
  })
})

describe("role matrix: pinned discovery (a dropped or rewritten guard must fail here)", () => {
  // Discovery only finds exports whose guard it can parse, so removing a guard silently drops the
  // export from the generated cases. Pin the discovered set, and pin which roles each helper
  // refuses, so either change shows up as a reviewed snapshot diff.
  it("pins every guarded export and its guards", () => {
    expect(Object.fromEntries(ENTRIES.map((e) => [`${e.file}.${e.fn}`, e.guards.join(",")]))).toMatchSnapshot()
  })

  it("pins the roles each one-argument roleGuard helper refuses", () => {
    const guard = roleGuard as unknown as Record<string, (r: Role) => boolean>
    const refused = Object.fromEntries(HELPERS.map((h) => [h, ALL_ROLES.filter((r) => !guard[h](r)).sort()]))
    expect(refused).toMatchSnapshot()
  })
})

describe("role matrix: pinned guards (a weakened guard must fail here)", () => {
  // Generated cases above follow whatever helper the source uses, so swapping
  // canAccessAccounting for canEdit would regenerate the expectation. Pin the
  // intended strength for the accounting mutation files.
  const ACCOUNTING = /^(transaction|receipt|reconciliation|budget|pettyCash\w*)$/
  const STRICT = new Set(["canAccessAccounting", "isAdmin"])
  it.each(ENTRIES.filter((e) => ACCOUNTING.test(e.file)).map((e) => [`${e.file}.${e.fn}`, e] as const))(
    "%s keeps an ADMIN|PASTOR guard, so OFFICE_ADMIN is refused",
    (_label, entry) => {
      expect(entry.guards.every((g) => STRICT.has(g))).toBe(true)
    },
  )
})
