/**
 * @jest-environment node
 *
 * AUD-7-07 role matrix. GENERATED from source: scans every src/lib/actions/*.ts,
 * finds each exported async function that opens with a negated roleGuard check
 * (`if (!canX(session?.user?.role)) ...` before any DB access), and for every
 * role that the REAL roleGuard helpers refuse, asserts the action performs no
 * Prisma write. Covers OFFICE_ADMIN being refused on admin-only / PASTOR+ADMIN
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
  "$queryRaw",
  "$queryRawUnsafe",
  "$transaction",
])
const writes: string[] = []
let currentRole: Role | undefined

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
            return method.startsWith("find") ? (method === "findMany" ? [] : null) : method === "count" ? 0 : undefined
          }),
      },
    )
  const client: unknown = new Proxy(
    {},
    {
      get: (_t, key: string) => {
        if (key === "$transaction") {
          // Any $transaction is a write attempt. Interactive callbacks are also
          // invoked with this client so writes inside them are recorded too.
          return jest.fn(async (arg: unknown) => {
            writes.push("$transaction")
            if (typeof arg === "function") return (arg as (tx: unknown) => unknown)(client)
            return undefined
          })
        }
        if (key.startsWith("$")) {
          return jest.fn(async () => {
            if (WRITE_METHODS.has(key)) writes.push(key)
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

/** Negated role helpers that appear before the first DB access in the body. */
function leadingGuards(body: string): string[] {
  const firstDb = body.search(/\bprisma\b|\btx\./)
  const head = firstDb === -1 ? body : body.slice(0, firstDb)
  return HELPERS.filter((h) => new RegExp(`!\\s*${h}\\(`).test(head))
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
    expect(ENTRIES.map((e) => `${e.file}.${e.fn}:${e.guards.join(",")}`)).toEqual(EXPECTED_GUARDED)
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

  it("covers the audit's accounting files", () => {
    const files = new Set(ENTRIES.map((e) => e.file))
    for (const f of ["transaction", "receipt", "reconciliation", "budget"]) expect(files).toContain(f)
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
  })

  it.each(cases.map(([label, entry, role]) => [`${label} / ${role}`, entry, role] as const))("%s refuses with no DB write", async (_label, entry, role) => {
    currentRole = role
    const mod = (await import(`@/lib/actions/${entry.file}`)) as Record<string, (...a: unknown[]) => Promise<unknown>>
    let result: unknown
    let thrown: unknown
    try {
      result = await mod[entry.fn](anyArg(), formData(), anyArg())
    } catch (e) {
      thrown = e
    }
    expect(writes).toEqual([])
    // A refusal is a returned error/forbidden shape or a thrown redirect/not-found
    // (the mocks above throw tagged errors). Any other throw (e.g. a TypeError from
    // reaching past the guard into real logic) is NOT a refusal.
    if (thrown !== undefined) {
      expect(thrown).toBeInstanceOf(Error)
      expect((thrown as Error).message).toMatch(REFUSAL_THROW)
    } else if (result && typeof result === "object") {
      const r = result as Record<string, unknown>
      expect(Boolean(r.success) || Boolean(r.ok)).toBe(false)
    }
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
