/**
 * @jest-environment node
 *
 * AUD-7-07 role matrix. GENERATED from source: scans every src/lib/actions/*.ts,
 * finds each exported async function that opens with a negated roleGuard check
 * (`if (!canX(session?.user?.role)) ...` or `canX(...) === false` before any DB
 * access; comments and strings ignored), and for every role that the REAL
 * roleGuard helpers refuse, asserts the action performs no Prisma write. Writes
 * are model write methods, `$executeRaw*`, and `$queryRaw*` whose SQL writes or locks;
 * `$transaction` itself is not a write, only what runs inside it (the callback gets a distinct `tx`
 * object without `$transaction`, like Prisma's). A guard refusal must also make no Prisma call at
 * all, read or write, so a refusal cannot be a downstream failure on a mocked read. Covers OFFICE_ADMIN being refused on admin-only / PASTOR+ADMIN
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
/**
 * Raw SQL that mutates state (INSERT/UPDATE/DELETE, advisory locks); a plain SELECT is a read.
 * `FOR UPDATE` / `FOR NO KEY UPDATE` are already caught by the `update` word; only the share locks
 * need their own alternative.
 */
const RAW_WRITE_SQL =
  /\b(insert|update|delete|truncate|alter|drop|create|merge|copy|lock|set_config|nextval|setval)\b|\bfor\s+(key\s+share|share)\b|\binto\b|pg_(try_)?advisory/i

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
/** Every Prisma call (read or write): a guard refusal happens before any of them. */
const dbCalls: string[] = []
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
        get: (_t, method: string | symbol) => {
          // Symbol keys (iterator, toPrimitive, inspect...) are not Prisma methods: no call, no record.
          if (typeof method === "symbol" || method === "then") return undefined
          return jest.fn(async () => {
            dbCalls.push(`${name}.${method}`)
            if (WRITE_METHODS.has(method)) writes.push(`${name}.${method}`)
            if (method === "findMany") return findManyRows
            if (method.startsWith("find")) return null
            return method === "count" ? 0 : undefined
          })
        },
      },
    )
  /**
   * Build a mocked Prisma client. The root client supports `$transaction`; an interactive
   * transaction's `tx` is a separate object WITHOUT `$transaction` (like Prisma's real
   * `TransactionClient`), so a nested `$transaction` or a use of the root client in place of `tx`
   * is visible. Writes made through either are recorded; the $transaction call itself is not a write.
   * Array-form transactions already recorded their writes when the items were built.
   * @param isTx true for the object handed to an interactive transaction callback
   */
  const makeClient = (isTx: boolean): unknown =>
    new Proxy(
      {},
      {
        get: (_t, key: string | symbol) => {
          if (typeof key !== "string") return undefined
          // Like Prisma's TransactionClient, `tx` has no `$transaction`: calling it throws.
          if (key === "$transaction" && isTx) return undefined
          if (key === "$transaction") {
            return jest.fn(async (arg: unknown) => {
              dbCalls.push("$transaction")
              return typeof arg === "function" ? (arg as (tx: unknown) => unknown)(makeClient(true)) : Array.isArray(arg) ? Promise.all(arg) : undefined
            })
          }
          if (key.startsWith("$")) {
            return jest.fn(async (...args: unknown[]) => {
              dbCalls.push(key)
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
  return { prisma: makeClient(false), __esModule: true }
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
  const out = src.split("")
  const n = src.length
  /** Blank [from, to) with spaces, keeping newlines so offsets and line shape survive. */
  const blank = (from: number, to: number): void => {
    for (let k = from; k < Math.min(to, n); k++) if (out[k] !== "\n") out[k] = " "
  }
  const ident = /[A-Za-z0-9_$]/
  // Keywords after which a `/` starts a regex literal rather than a division.
  const REGEX_AFTER = new Set(["return", "typeof", "case", "in", "of", "delete", "void", "throw", "new", "else", "do", "yield", "await"])

  /**
   * Scan template text from just after the opening backtick, blanking it. `${ ... }` holes are scanned
   * as code (recursively, so nested templates work). Returns the index after the closing backtick.
   * @param start index just after the opening backtick
   */
  const scanTemplate = (start: number): number => {
    let i = start
    while (i < n) {
      const c = src[i]
      if (c === "\\") {
        blank(i, i + 2)
        i += 2
      } else if (c === "`") {
        blank(i, i + 1)
        return i + 1
      } else if (c === "$" && src[i + 1] === "{") {
        blank(i, i + 2)
        const close = scanCode(i + 2, true)
        blank(close, close + 1)
        i = close + 1
      } else {
        blank(i, i + 1)
        i++
      }
    }
    return n
  }

  /**
   * Scan code from `start`, blanking comments, strings, templates and regex literals. When `inHole`
   * is true, stops at the `}` that closes the enclosing template hole and returns its index.
   * @param start first index to scan
   * @param inHole true when scanning a `${ }` template hole
   */
  const scanCode = (start: number, inHole: boolean): number => {
    let i = start
    let depth = 0
    let prev = ""
    let before = "" // the non-space char before `prev`, to spot postfix ++/--
    let prevPos = -1 // index of `prev`, so ++/-- needs two adjacent operator chars
    let word = ""
    while (i < n) {
      const c = src[i]
      const next = src[i + 1]
      if (c === "/" && next === "/") {
        const e = src.indexOf("\n", i)
        const end = e === -1 ? n : e
        blank(i, end)
        i = end
      } else if (c === "/" && next === "*") {
        const e = src.indexOf("*/", i + 2)
        const end = e === -1 ? n : e + 2
        blank(i, end)
        i = end
      } else if (c === '"' || c === "'") {
        let j = i + 1
        while (j < n && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1
        blank(i, j + 1)
        i = j + 1
        prev = '"'
        word = ""
      } else if (c === "`") {
        blank(i, i + 1)
        i = scanTemplate(i + 1)
        prev = '"'
        word = ""
      } else if (c === "/" && (prev === "" || !(ident.test(prev) || prev === ")" || prev === "]" || prev === '"' || prev === "}") || REGEX_AFTER.has(word))) {
        let j = i + 1
        let inClass = false
        while (j < n && src[j] !== "\n" && (inClass || src[j] !== "/")) {
          if (src[j] === "\\") j++
          else if (src[j] === "[") inClass = true
          else if (src[j] === "]") inClass = false
          j++
        }
        blank(i, j + 1)
        i = j + 1
        prev = '"'
        word = ""
      } else {
        if (c === "{") depth++
        else if (c === "}") {
          if (inHole && depth === 0) return i
          depth--
        }
        if (!/\s/.test(c)) {
          word = ident.test(c) ? (ident.test(prev) ? word + c : c) : ""
          // `x++ / 2`: a postfix ++/-- ends an operand, so a following `/` is division.
          const postfix = (c === "+" || c === "-") && prev === c && prevPos === i - 1 && (ident.test(before) || before === ")" || before === "]")
          before = prev
          prev = postfix ? ")" : c
          prevPos = i
        }
        i++
      }
    }
    return n
  }

  scanCode(0, false)
  return out.join("")
}

/**
 * True when `code` contains a call `helper(...)` whose balanced closing paren is followed by
 * `=== false` / `== false`, at any paren nesting depth.
 * @param code comment/string-stripped source
 * @param helper the roleGuard helper name
 */
function hasCallComparedToFalse(code: string, helper: string): boolean {
  for (const m of code.matchAll(new RegExp(`\\b${helper}\\(`, "g"))) {
    let depth = 1
    let i = m.index! + m[0].length
    while (i < code.length && depth > 0) {
      if (code[i] === "(") depth++
      else if (code[i] === ")") depth--
      i++
    }
    if (depth === 0 && /^\s*===?\s*false\b/.test(code.slice(i))) return true
  }
  return false
}

/**
 * Role helpers used as a refusal before the first DB access in the body: `!canX(`, `canX(...) === false`
 * and `false === canX(`. Comments and strings are ignored.
 * @param body source of one exported function
 */
function leadingGuards(body: string): string[] {
  const head = headBeforeDb(body)
  return HELPERS.filter((h) => new RegExp(`(?<!!)!\\s*${h}\\(|\\bfalse\\s*===?\\s*${h}\\(`).test(head) || hasCallComparedToFalse(head, h))
}

/**
 * Matches `export const f = async (...) =>`, `= async x =>`, `= async function` and generic arrows
 * (`= async <T>(x: T) =>`), with or without a type annotation (including function types such as
 * `: () => Promise<unknown>`, whose `=>` the lazy annotation match skips past) and with any number of
 * wrapper calls around the function (`= withAudit(async (x) =>`, `= wrap(wrap2(async function`).
 */
const CONST_FN_EXPORT = /^export const (\w+)\s*(?::[^\n]*?)?=\s*(?:\w+\s*\(\s*)*(?:async\b\s*)?(?:function\b|<|\(|\w+\s*=>)/gm

/**
 * Scan every `src/lib/actions/*.ts` that mentions roleGuard and return each exported async function
 * whose body opens with a negated roleGuard check, plus the exports discovery cannot see: arrow
 * exports (`export const f = async (...) =>`) and function exports that call a roleGuard helper
 * before any DB access without matching the guard shape (a rewritten guard).
 */
function discover(): { entries: Entry[]; undiscovered: string[] } {
  const out: Entry[] = []
  const undiscovered: string[] = []
  for (const file of fs.readdirSync(ACTIONS_DIR).filter((f) => f.endsWith(".ts")).sort()) {
    const src = fs.readFileSync(path.join(ACTIONS_DIR, file), "utf8")
    if (!src.includes("roleGuard")) continue
    const base = file.replace(/\.ts$/, "")
    for (const m of src.matchAll(/^export async function (\w+)\s*\(/gm)) {
      const body = bodyOf(src, m.index!)
      const guards = leadingGuards(body)
      if (guards.length) out.push({ file: base, fn: m[1], guards })
      else if (callsHelperBeforeDb(body)) undiscovered.push(`${base}.${m[1]}`)
    }
    for (const m of src.matchAll(CONST_FN_EXPORT)) {
      undiscovered.push(`${base}.${m[1]}`)
    }
  }
  return { entries: out, undiscovered: undiscovered.sort() }
}

/**
 * True when the body calls any roleGuard helper before its first DB access (comments and strings
 * ignored), i.e. it looks guarded even though `leadingGuards` did not recognise the shape.
 * @param body source of one exported function
 */
function callsHelperBeforeDb(body: string): boolean {
  const head = headBeforeDb(body)
  return HELPERS.some((h) => new RegExp(`\\b${h}\\(`).test(head)) || ASYNC_ACCESS_CHECK.test(head)
}

/** First DB access: a literal `prisma` / `tx.` use or an explicit `$transaction`. */
const FIRST_DB = /\bprisma\b|\btx\.|\$transaction\b/

/**
 * An awaited non-roleGuard access check (`await canManageEvent(`, `await assertX(`, `await requireX(`).
 * These are async and live outside roleGuard, so HELPERS never sees them. `ensure*` is left out on
 * purpose: those are get-or-create DB helpers (`ensureSession`), not checks.
 */
const ASYNC_ACCESS_CHECK = /\bawait\s+(?:can|is|assert|require)[A-Z]\w*\(/

/**
 * Comment/string-stripped source of the body up to its first DB access. When no DB access appears
 * literally, the whole body counts as pre-DB (a delegating action is still reported, never ignored).
 * @param body source of one exported function
 */
function headBeforeDb(body: string): string {
  const code = stripCommentsAndStrings(body)
  const firstDb = code.search(FIRST_DB)
  return firstDb === -1 ? code : code.slice(0, firstDb)
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
  return e instanceof Error && REFUSAL_THROW.test(e.message)
}

/** Error messages thrown by the redirect/notFound mocks: the only throws that count as a refusal. */
const REFUSAL_THROW = /^(REDIRECT:\/(login|unauthorized|forbidden)(?:[?#].*)?$|NOT_FOUND$)/

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

const { entries: ENTRIES, undiscovered: UNDISCOVERED } = discover()

/**
 * Exports whose several guards are ANY-of (`if (!a(r) && !b(r)) refuse`): a role is refused only when
 * every guard refuses it. Every other multi-guard export is treated as ALL-of (some guard refusing is
 * enough). Pinned so a new multi-guard export forces a decision.
 */
const ANY_OF = new Set(["registration.getRegistrationDetail"])

/** Multi-guard exports pinned as ALL-of (several sequential refusal guards). Disjoint from `ANY_OF`. */
const ALL_OF = new Set<string>()

/**
 * Exports that look guarded (or are arrow exports) but that discovery cannot parse, pinned so a
 * newly unparsed export fails loudly. Empty when every guard is discoverable.
 */
const EXPECTED_UNDISCOVERED: string[] = []

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

  it("stripCommentsAndStrings handles regex literals, nested templates and deep call nesting", () => {
    // A backtick inside a regex literal must not open a template that swallows the guard.
    expect(leadingGuards("const r = /`/\nif (!isAdmin(x)) return\nawait prisma.x.create(`a`)")).toEqual(["isAdmin"])
    // A quote inside a regex character class, then a real guard.
    expect(leadingGuards("const r = /[\"']/g\nif (!isAdmin(x)) return\nawait prisma.x.create()")).toEqual(["isAdmin"])
    // A guard-looking token inside a nested template hole's string is ignored.
    expect(leadingGuards("const s = `a ${`b ${1} !isAdmin(`} c`\nawait prisma.x.create()")).toEqual([])
    // Code inside a template hole is still code.
    expect(leadingGuards("const s = `a ${!isAdmin(r)}`\nawait prisma.x.create()")).toEqual(["isAdmin"])
    // Division is not a regex.
    expect(leadingGuards("const h = a / b\nif (!isAdmin(r)) return // x'\nawait prisma.x.create()")).toEqual(["isAdmin"])
    // Division after a postfix ++/-- is not a regex opener.
    expect(leadingGuards("let n = 4; n++ / 2; if (!isAdmin(r)) return\nawait prisma.x.create()")).toEqual(["isAdmin"])
    expect(leadingGuards("let n = 4; n-- / 2; if (!isAdmin(r)) return\nawait prisma.x.create()")).toEqual(["isAdmin"])
    // `n + +/re/` is binary plus then unary plus (not postfix ++): the slash opens a regex.
    expect(leadingGuards("const s = n + +/prisma/.test(t); if (!isAdmin(r)) return\nawait prisma.x.create()")).toEqual(["isAdmin"])
    expect(leadingGuards("const s = n - -/prisma/.test(t); if (!isAdmin(r)) return\nawait prisma.x.create()")).toEqual(["isAdmin"])
    // canX(...) === false with three or more paren levels.
    expect(leadingGuards("if (isAdmin(f(g(h(1)), (2))) === false) return\nawait prisma.x.create()")).toEqual(["isAdmin"])
    expect(leadingGuards("if (isAdmin(f(g(1))) === true) return\nawait prisma.x.create()")).toEqual([])
  })

  it("rawQueryWrites treats SELECT as a read and writes, locks and unknown shapes as writes", () => {
    expect(rawQueryWrites([["SELECT id FROM t WHERE a = ", ""]])).toBe(false)
    expect(rawQueryWrites(["INSERT INTO t VALUES (1)"])).toBe(true)
    expect(rawQueryWrites([["SELECT 1 FROM t FOR SHARE"]])).toBe(true)
    expect(rawQueryWrites([["SELECT 1 FROM t FOR KEY SHARE"]])).toBe(true)
    expect(rawQueryWrites([["SELECT 1 FROM t FOR UPDATE"]])).toBe(true)
    expect(rawQueryWrites([["SELECT 1 FROM t FOR NO KEY UPDATE"]])).toBe(true)
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

  it("finds no guarded-looking export that discovery cannot parse (arrow exports, rewritten guards)", () => {
    expect(UNDISCOVERED).toEqual(EXPECTED_UNDISCOVERED)
  })

  it("classifies every multi-guard export as ANY-of or ALL-of, with no overlap and no stale pin", () => {
    const multi = ENTRIES.filter((e) => e.guards.length > 1).map((e) => `${e.file}.${e.fn}`)
    expect([...ANY_OF].filter((k) => ALL_OF.has(k))).toEqual([])
    expect([...ANY_OF, ...ALL_OF].sort()).toEqual(multi.sort())
  })

  it("export discovery sees arrow, typed-arrow and function-expression exports", () => {
    const hit = (line: string) => [...line.matchAll(CONST_FN_EXPORT)].length === 1
    expect(hit("export const a = async (x) => {")).toBe(true)
    expect(hit("export const a = async x => {")).toBe(true)
    expect(hit("export const a: () => Promise<unknown> = async () => {")).toBe(true)
    expect(hit("export const a = async function (x) {")).toBe(true)
    expect(hit("export const A = 5")).toBe(false)
    // Generics, wrapper calls and typed consts.
    expect(hit("export const a = async <T,>(x: T) => {")).toBe(true)
    expect(hit("export const a = withAudit(async (x) => {")).toBe(true)
    expect(hit("export const a = wrap(inner(async function (x) {")).toBe(true)
    expect(hit("export const a: Handler<string> = wrap(async (x) => {")).toBe(true)
    expect(hit("export const a = compute(5)")).toBe(false)
  })

  it("callsHelperBeforeDb flags awaited non-roleGuard checks and ignores ones after the first DB access", () => {
    expect(callsHelperBeforeDb("const ok = await canManageEvent(u, 1, r)\nawait prisma.x.update()")).toBe(true)
    expect(callsHelperBeforeDb("await assertOwner(u)\nreturn 1")).toBe(true)
    expect(callsHelperBeforeDb("await prisma.x.findMany()\nconst ok = await canManageEvent(u, 1, r)")).toBe(false)
    expect(callsHelperBeforeDb("await prisma.$transaction(async () => {})\nawait canX(r)")).toBe(false)
    expect(callsHelperBeforeDb("const x = await computeTotals()")).toBe(false)
  })

  it("the Prisma model mock ignores symbol keys and records string-keyed calls", async () => {
    const { prisma } = await import("@/lib/prisma")
    const model = (prisma as unknown as Record<string, Record<string | symbol, unknown>>).person
    expect(model[Symbol.iterator]).toBeUndefined()
    expect(model[Symbol.toPrimitive]).toBeUndefined()
    expect(dbCalls).toEqual([])
    await (model.findMany as () => Promise<unknown>)()
    expect(dbCalls).toEqual(["person.findMany"])
  })

  it("getRegistrationDetail: partially allowed roles reach the second stage, make no write and get a refusal", async () => {
    const mod = (await import("@/lib/actions/registration")) as Record<string, (...a: unknown[]) => Promise<unknown>>
    for (const role of ["VIEWER", "EVENT_ORGANISER"] as Role[]) {
      currentRole = role
      writes.length = 0
      dbCalls.length = 0
      // Allowed through the first gate by one guard, so a Prisma read happens; the probe finds no row.
      const result = await mod.getRegistrationDetail(1)
      expect(dbCalls).toContain("registration.findUnique")
      expect(writes).toEqual([])
      expect(isRefusalShape(result)).toBe(true)
      expect(result).toEqual({ error: "Registration not found" })
    }
  })

  it("isRefusalThrow accepts only login/unauthorized/forbidden redirects and not-found", () => {
    expect(isRefusalThrow(new Error("REDIRECT:/login"))).toBe(true)
    expect(isRefusalThrow(new Error("NOT_FOUND"))).toBe(true)
    expect(isRefusalThrow(new Error("REDIRECT:/login?next=/x"))).toBe(true)
    expect(isRefusalThrow(new Error("REDIRECT:/anywhere"))).toBe(false)
    expect(isRefusalThrow(new Error("REDIRECT:/login-x"))).toBe(false)
    expect(isRefusalThrow(new Error("REDIRECT:/forbidden/other"))).toBe(false)
    expect(isRefusalThrow(new Error("NOT_FOUND_EXTRA"))).toBe(false)
  })

  /**
   * True when the export refuses `role`. ANY_OF: every guard must refuse; ALL_OF and single-guard
   * exports: one refusing guard is enough.
   * @param e the guarded export
   * @param role the role under test
   */
  const refusesRole = (e: Entry, role: Role): boolean => {
    const key = `${e.file}.${e.fn}`
    const refuses = (g: string) => !(roleGuard as unknown as Record<string, (r: Role) => boolean>)[g](role)
    if (ANY_OF.has(key)) return e.guards.every(refuses)
    // An unclassified multi-guard export is reported by the dedicated classification test; treat it
    // as ALL-of here so collection does not fail with an opaque suite-level error.
    return e.guards.some(refuses)
  }

  const cases = ENTRIES.flatMap((e) =>
    ALL_ROLES.filter((role) => refusesRole(e, role)).map(
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
    dbCalls.length = 0
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
    // The guard is the first thing the action does, so a real guard refusal makes no Prisma call at
    // all, read or write. A read that ran means the refusal came from somewhere downstream.
    expect(dbCalls).toEqual([])
    // A refusal is a returned error/empty shape or a thrown redirect/not-found error. Any other
    // throw is a crash, not a refusal, and any other result is a success payload.
    if (thrown === undefined) expect(isRefusalShape(result)).toBe(true)
    else expect(isRefusalThrow(thrown)).toBe(true)
  })
})

describe("role matrix: pinned helper strength", () => {
  // The guarded-export set is pinned inline (EXPECTED_GUARDED) only. Pin which roles each helper
  // refuses so a widened or narrowed helper shows up as a reviewed snapshot diff.
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
