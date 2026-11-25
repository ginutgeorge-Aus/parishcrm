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
import ts from "typescript"
import { UserRole } from "@/lib/generated/prisma/enums"
import * as roleGuard from "@/lib/roleGuard"

type Role = (typeof UserRole)[keyof typeof UserRole]

const WRITE_METHODS = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
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

/** Words that may precede `(` in a read-only SELECT: keywords and pure aggregate/scalar functions. */
const SAFE_SQL_WORDS = new Set([
  "any", "all", "in", "exists", "and", "or", "not", "on", "as", "from", "where", "select", "join", "using", "by",
  "count", "min", "max", "sum", "coalesce", "lower", "upper", "cast", "distinct", "over", "partition", "having",
  "limit", "offset", "union", "values", "array", "case", "when", "then", "else", "end", "with", "unnest",
])

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
  if (RAW_WRITE_SQL.test(sql)) return true
  // Allowlist, not just a denylist: only a plain SELECT/WITH that calls no unknown function is a read,
  // so `SELECT pg_notify(...)` and other mutating functions count as writes.
  if (!/^\s*(select|with)\b/i.test(sql)) return true
  for (const m of sql.matchAll(/\b([a-z_][a-z0-9_]*)\s*\(/gi)) {
    if (!SAFE_SQL_WORDS.has(m[1].toLowerCase())) return true
  }
  return false
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
  // One-argument helpers only: `canAssignRole` takes two (per-target; covered in user.ts tests), and
  // any future multi-argument helper is excluded by arity rather than by name.
  .filter(([, v]) => typeof v === "function" && (v as (...a: unknown[]) => unknown).length === 1)
  .map(([k]) => k)
const ALL_ROLES = Object.values(UserRole) as Role[]
// The six roles named in the audit; Sunday-school roles are included via ALL_ROLES.
const AUDIT_ROLES: Role[] = ["ADMIN", "PASTOR", "OFFICE_ADMIN", "AUDITOR", "VIEWER", "EVENT_ORGANISER"] as Role[]

type Entry = { file: string; fn: string; guards: string[] }

/**
 * Source of a top-level function: from its start to the end of its body, taken from the parsed
 * declaration so a column-0 literal/comment or a brace in the signature cannot truncate it.
 * @param src full file source
 * @param start index where the function starts
 */
function bodyOf(src: string, start: number): string {
  const rest = src.slice(start)
  const sf = ts.createSourceFile("x.ts", rest, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const first = sf.statements[0]
  if (first && ts.isFunctionDeclaration(first) && first.body) return rest.slice(0, first.body.end)
  return rest
}

/**
 * Blank out comments and string/template/regex literals (keeping length) so a guard-looking token
 * inside them is not mistaken for code. Uses the TypeScript parser, so regex-vs-division is decided
 * by the grammar rather than a heuristic.
 * @param src source text
 */
function stripCommentsAndStrings(src: string): string {
  const out = src.split("")
  const sf = ts.createSourceFile("x.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const LITERALS = new Set<ts.SyntaxKind>([
    ts.SyntaxKind.StringLiteral,
    ts.SyntaxKind.NoSubstitutionTemplateLiteral,
    ts.SyntaxKind.TemplateHead,
    ts.SyntaxKind.TemplateMiddle,
    ts.SyntaxKind.TemplateTail,
    ts.SyntaxKind.RegularExpressionLiteral,
  ])
  /** Blank [from, to) with spaces, keeping newlines so offsets and line shape survive. */
  const blank = (from: number, to: number): void => {
    for (let k = from; k < Math.min(to, out.length); k++) if (out[k] !== "\n") out[k] = " "
  }
  /**
   * Visit every token: blank literal tokens and the comments in the trivia that precedes each token.
   * @param node the AST node to walk
   */
  const walk = (node: ts.Node): void => {
    const kids = node.getChildren(sf)
    if (kids.length === 0) {
      for (const c of ts.getLeadingCommentRanges(src, node.pos) ?? []) blank(c.pos, c.end)
      // Same-line comments after the previous token are its trailing comments, not this token's leading ones.
      for (const c of ts.getTrailingCommentRanges(src, node.end) ?? []) blank(c.pos, c.end)
      if (LITERALS.has(node.kind)) blank(node.getStart(sf), node.end)
      return
    }
    for (const k of kids) walk(k)
  }
  walk(sf)
  return out.join("")
}

/**
 * Role helpers used as a refusal before the first DB access in the body: `!canX(`, `canX(...) === false`
 * and `false === canX(`. Comments and strings are ignored.
 * @param body source of one exported function
 */
function leadingGuards(body: string): string[] {
  const head = headBeforeDb(body)
  return HELPERS.filter((h) => hasRefusal(head, h)).sort()
}

/**
 * Index just after the `)` that closes the call whose `(` is at `open`, or -1 when unbalanced.
 * @param code comment/string-stripped source
 * @param open index of the opening paren
 */
function closeOfCall(code: string, open: number): number {
  let depth = 0
  for (let i = open; i < code.length; i++) {
    if (code[i] === "(") depth++
    else if (code[i] === ")" && --depth === 0) return i + 1
  }
  return -1
}

/**
 * If a roleGuard refusal term starts at `i`, return the index just after it, else -1. A term is
 * `!canX(...)` (not `!!`), `canX(...) === false` or `false === canX(...)`.
 * @param code comment/string-stripped source
 * @param i candidate start index
 */
function guardTermEnd(code: string, i: number): number {
  const names = HELPERS.join("|")
  const rest = code.slice(i)
  let m = new RegExp(`^!\\s*(?:${names})\\(`).exec(rest)
  if (m && code[i - 1] !== "!") return closeOfCall(code, i + m[0].length - 1)
  m = new RegExp(`^(?:${names})\\(`).exec(rest)
  if (m) {
    const end = closeOfCall(code, i + m[0].length - 1)
    const cmp = end === -1 ? null : /^\s*===?\s*false\b/.exec(code.slice(end))
    return cmp ? end + cmp[0].length : -1
  }
  m = new RegExp(`^false\\s*===?\\s*(?:${names})\\(`).exec(rest)
  return m ? closeOfCall(code, i + m[0].length - 1) : -1
}

/**
 * Start index of the refusal term that ends at `end` (whitespace before `end` ignored), or -1.
 * @param code comment/string-stripped source
 * @param end index just after the term
 */
function guardTermStartBefore(code: string, end: number): number {
  const stop = code.slice(0, end).trimEnd().length
  for (let i = stop - 1; i >= 0; i--) if (guardTermEnd(code, i) === stop) return i
  return -1
}

/**
 * True when the refusal term spanning [start, end) is not AND-ed with any operand that is not itself
 * a refusal term (`if (x && !canEdit(r))` lets a refused role through when `x` is false). `||` is
 * fine, since either side alone refuses.
 * @param head code before the first DB access
 * @param start start of the term
 * @param end index just after the term
 */
function andChainAllGuards(head: string, start: number, end: number): boolean {
  let e = end
  for (;;) {
    const after = head.slice(e).replace(/^[\s)]+/, "")
    if (!after.startsWith("&&")) break
    let k = head.length - after.length + 2
    while (k < head.length && /[\s(]/.test(head[k])) k++
    const next = guardTermEnd(head, k)
    if (next === -1) return false
    e = next
  }
  let s = start
  for (;;) {
    const before = head.slice(0, s).replace(/[\s(]+$/, "")
    if (!before.endsWith("&&")) break
    const prev = guardTermStartBefore(head, before.length - 2)
    if (prev === -1) return false
    s = prev
  }
  return true
}

/**
 * True when `head` has a refusal term for `helper` that is not AND-ed with a non-guard operand.
 * @param head code before the first DB access
 * @param helper the roleGuard helper name
 */
function hasRefusal(head: string, helper: string): boolean {
  for (const m of head.matchAll(new RegExp(`!\\s*${helper}\\(|\\b${helper}\\(|\\bfalse\\s*===?\\s*${helper}\\(`, "g"))) {
    const end = guardTermEnd(head, m.index!)
    if (end !== -1 && andChainAllGuards(head, m.index!, end)) return true
  }
  return false
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

/**
 * Readers whose documented refusal is a built-in default (never the configured value) rather than an
 * empty/error shape (AUD-1-11). The matrix accepts a non-empty object from these as a refusal, provided
 * the guard made no Prisma call (so the configured row was never read).
 */
const DEFAULT_RETURN_READERS = new Set([
  "settings.getBirthdayTemplate",
  "settings.getAnniversaryTemplate",
  "settings.getAutoEmailFlags",
])

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
settings.getBirthdayTemplate:canEdit
settings.getAnniversaryTemplate:canEdit
settings.getAutoEmailFlags:canEdit
settings.getPettyCashDefaultCustodianId:canViewAccounting
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

  it("leadingGuards ignores a negated guard AND-ed with a non-guard operand, but keeps || and guard-only &&", () => {
    expect(leadingGuards("if (x && !isAdmin(r)) return\nawait prisma.x.create()")).toEqual([])
    expect(leadingGuards("if (!isAdmin(r) && x) return\nawait prisma.x.create()")).toEqual([])
    expect(leadingGuards("if (Number.isNaN(id) || !isAdmin(r)) return\nawait prisma.x.create()")).toEqual(["isAdmin"])
    expect(leadingGuards("if (!canEdit(r) && !isAdmin(r)) return\nawait prisma.x.create()").sort()).toEqual(["canEdit", "isAdmin"])
  })

  it("leadingGuards handles same-line comments, longer && chains and === false operands", () => {
    expect(leadingGuards("const s = await auth() // TODO prisma lookup\nif (!isAdmin(r)) return\nawait prisma.x.create()")).toEqual(["isAdmin"])
    expect(leadingGuards("const s = await auth() // if (!isAdmin(r)) return\nawait prisma.x.create()")).toEqual([])
    expect(leadingGuards("if (!canEdit(r) && !isAdmin(r) && opts.strict) return\nawait prisma.x.create()")).toEqual([])
    expect(leadingGuards("if (x && (!isAdmin(r))) return\nawait prisma.x.create()")).toEqual([])
    expect(leadingGuards("if (flag && isAdmin(r) === false) return\nawait prisma.x.create()")).toEqual([])
    expect(leadingGuards("if (isAdmin(r) === false || flag) return\nawait prisma.x.create()")).toEqual(["isAdmin"])
  })

  it("bodyOf is not truncated by a column-0 brace inside a literal or comment", () => {
    const src = 'export async function f() {\n  const s = `\n}\n`\n  /*\n}\n*/\n  if (!isAdmin(r)) return\n  await prisma.x.create()\n}\nexport async function g() {}\n'
    expect(bodyOf(src, 0)).toContain("prisma.x.create()")
    expect(bodyOf(src, 0)).not.toContain("function g")
  })

  it("stripCommentsAndStrings reads a regex literal after `)` or `}` as a regex", () => {
    expect(leadingGuards("if (x) /`/.test(y)\nif (!isAdmin(r)) return\nawait prisma.x.create()")).toEqual(["isAdmin"])
    expect(leadingGuards("{ }\n/`/.test(y)\nif (!isAdmin(r)) return\nawait prisma.x.create()")).toEqual(["isAdmin"])
  })

  it("HELPERS keeps only one-argument roleGuard helpers", () => {
    expect(HELPERS).not.toContain("canAssignRole")
    expect(HELPERS).toContain("isAdmin")
  })

  it("rawQueryWrites treats a SELECT calling a mutating function as a write", () => {
    expect(rawQueryWrites([["SELECT pg_notify('c', 'p')"]])).toBe(true)
    expect(rawQueryWrites([["SELECT id FROM t WHERE id = ANY(", "::int[])"]])).toBe(false)
    expect(rawQueryWrites([["SELECT count(*) FROM t"]])).toBe(false)
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
    if (thrown !== undefined) expect(isRefusalThrow(thrown)).toBe(true)
    else if (DEFAULT_RETURN_READERS.has(`${entry.file}.${entry.fn}`)) {
      expect(result).toEqual(expect.any(Object))
    } else expect(isRefusalShape(result)).toBe(true)
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
