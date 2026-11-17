/** @jest-environment node */
/**
 * Role matrix (AUD-7-07, StMarkCRM#3331 PR 2): every accounting mutation must
 * refuse OFFICE_ADMIN / AUDITOR / VIEWER / EVENT_ORGANISER, and every event /
 * person / family mutation must refuse VIEWER / EVENT_ORGANISER, before ANY
 * Prisma access. The real roleGuard is used; only the session and Prisma are
 * mocked. Read-only exports (get*, list*, preview*, fetch*) are out of scope.
 */
import { UserRole } from "@/lib/generated/prisma/enums"

const mockAuth = jest.fn()
const prismaCalls: string[] = []

jest.mock("@/auth", () => ({ auth: (...a: unknown[]) => mockAuth(...a) }))
// Any property-access chain that is then CALLED counts as a Prisma call (reads
// included: the guard must refuse before touching the DB at all).
jest.mock("@/lib/prisma", () => {
  /** Recursive proxy that records the dotted path of every call. */
  const make = (path: string): unknown =>
    new Proxy(function () {}, {
      get: (_t, prop) => (prop === "then" ? undefined : make(`${path}.${String(prop)}`)),
      apply: () => {
        prismaCalls.push(path)
        return Promise.resolve(null)
      },
    })
  return { prisma: make("prisma") }
})
jest.mock("next/cache", () => ({ revalidatePath: jest.fn(), revalidateTag: jest.fn(), unstable_cache: (fn: unknown) => fn }))
jest.mock("next/navigation", () => ({ redirect: jest.fn() }))
jest.mock("@/lib/featureFlags")

import * as transaction from "@/lib/actions/transaction"
import * as receipt from "@/lib/actions/receipt"
import * as reconciliation from "@/lib/actions/reconciliation"
import * as pettyCashExpense from "@/lib/actions/pettyCashExpense"
import * as pettyCashImport from "@/lib/actions/pettyCashImport"
import * as pettyCashReceipt from "@/lib/actions/pettyCashReceipt"
import * as pettyCashSession from "@/lib/actions/pettyCashSession"
import * as pettyCashTransfer from "@/lib/actions/pettyCashTransfer"
import * as invoice from "@/lib/actions/invoice"
import * as invoicePayment from "@/lib/actions/invoicePayment"
import * as invoiceSend from "@/lib/actions/invoiceSend"
import * as invoiceSettings from "@/lib/actions/invoiceSettings"
import * as invoiceVoid from "@/lib/actions/invoiceVoid"
import * as budget from "@/lib/actions/budget"
import * as event from "@/lib/actions/event"
import * as person from "@/lib/actions/person"
import * as family from "@/lib/actions/family"

type Action = (...args: unknown[]) => Promise<unknown>
type Row = readonly [name: string, fn: Action, args: unknown[]]

const fd = () => new FormData()
/**
 * Builds a table row. The guard refuses before args are read, so dummy args
 * only need to be present.
 * @param name label shown in the test title
 * @param fn the server action
 * @param args dummy arguments
 */
const row = (name: string, fn: unknown, args: unknown[] = []): Row => [name, fn as Action, args]

const ACCOUNTING_ROLES = [UserRole.OFFICE_ADMIN, UserRole.AUDITOR, UserRole.VIEWER, UserRole.EVENT_ORGANISER]
const PEOPLE_ROLES = [UserRole.VIEWER, UserRole.EVENT_ORGANISER]

const accountingRows: Row[] = [
  row("transaction.createTransaction", transaction.createTransaction, [{}, fd()]),
  row("transaction.updateTransaction", transaction.updateTransaction, [1, {}, fd()]),
  row("transaction.deleteTransaction", transaction.deleteTransaction, [1]),
  row("receipt.sendSingleReceipt", receipt.sendSingleReceipt, [1, "a@example.com"]),
  row("receipt.sendBatchReceipts", receipt.sendBatchReceipts, [[]]),
  row("reconciliation.saveStatementBalance", reconciliation.saveStatementBalance, [1, "2026-01-31", "0.00"]),
  row("pettyCashExpense.createExpense", pettyCashExpense.createExpense, [{}, fd()]),
  row("pettyCashExpense.updateExpense", pettyCashExpense.updateExpense, [1, {}, fd()]),
  row("pettyCashExpense.deleteExpense", pettyCashExpense.deleteExpense, [1]),
  row("pettyCashImport.previewImport", pettyCashImport.previewImport, [fd()]),
  row("pettyCashImport.commitImport", pettyCashImport.commitImport, [fd()]),
  row("pettyCashReceipt.createReceipt", pettyCashReceipt.createReceipt, [{}, fd()]),
  row("pettyCashReceipt.updateReceipt", pettyCashReceipt.updateReceipt, [1, {}, fd()]),
  row("pettyCashReceipt.deleteReceipt", pettyCashReceipt.deleteReceipt, [1]),
  row("pettyCashSession.createSession", pettyCashSession.createSession, [{}, fd()]),
  row("pettyCashSession.updateSessionCustodian", pettyCashSession.updateSessionCustodian, [1, {}, fd()]),
  row("pettyCashSession.closeSession", pettyCashSession.closeSession, [1, {}, fd()]),
  row("pettyCashSession.deleteSession", pettyCashSession.deleteSession, [1]),
  row("pettyCashTransfer.createTransfer", pettyCashTransfer.createTransfer, [{}, fd()]),
  row("pettyCashTransfer.deleteTransfer", pettyCashTransfer.deleteTransfer, [1]),
  row("invoice.createInvoice", invoice.createInvoice, [{}, fd()]),
  row("invoice.updateInvoice", invoice.updateInvoice, [1, {}, fd()]),
  row("invoice.deleteDraftInvoice", invoice.deleteDraftInvoice, [1]),
  row("invoicePayment.markInvoicePaid", invoicePayment.markInvoicePaid, [1, {}]),
  row("invoicePayment.unmarkInvoicePaid", invoicePayment.unmarkInvoicePaid, [1]),
  row("invoiceSend.sendInvoice", invoiceSend.sendInvoice, [1]),
  row("invoiceSend.markInvoiceSent", invoiceSend.markInvoiceSent, [1]),
  row("invoiceSend.resendInvoice", invoiceSend.resendInvoice, [1]),
  row("invoiceSettings.updateInvoiceSettings", invoiceSettings.updateInvoiceSettings, [{ gstRegistered: false, paymentDetails: "" }]),
  row("invoiceVoid.voidInvoice", invoiceVoid.voidInvoice, [1, "reason"]),
  row("budget.upsertBudgets", budget.upsertBudgets, [2026, []]),
  row("budget.saveBudgetVarianceNote", budget.saveBudgetVarianceNote, [2026, 1, "note"]),
]

// pettyCashSession.ensureWeeklySession is a mutation too but reports refusal as
// { status: "not-editor" } instead of { error }, so it is asserted separately.

const peopleRows: Row[] = [
  row("event.createEvent", event.createEvent, [{}, fd()]),
  row("event.updateEvent", event.updateEvent, [1, {}, fd()]),
  row("event.deleteEvent", event.deleteEvent, [1]),
  row("event.publishEvent", event.publishEvent, [1, true]),
  row("event.setRegistrationClosed", event.setRegistrationClosed, [1, true]),
  row("event.resyncEventsToWebsite", event.resyncEventsToWebsite, []),
  row("person.createPerson", person.createPerson, [1, {}, fd()]),
  row("person.updatePerson", person.updatePerson, [1, 1, {}, fd()]),
  row("person.deletePerson", person.deletePerson, [1, 1]),
  row("family.createFamily", family.createFamily, [{}, fd()]),
  row("family.updateFamily", family.updateFamily, [1, {}, fd()]),
  row("family.deleteFamily", family.deleteFamily, [1]),
  row("family.archiveFamily", family.archiveFamily, [1]),
  row("family.unarchiveFamily", family.unarchiveFamily, [1]),
  row("family.mergeFamilies", family.mergeFamilies, [1, 2, {}]),
]

/**
 * Runs one action as `role` and asserts it was refused with no Prisma access.
 * @param fn the server action
 * @param args dummy arguments (the guard runs before they are read)
 * @param role the caller's role
 */
async function expectRefused(fn: Action, args: unknown[], role: UserRole): Promise<void> {
  mockAuth.mockResolvedValue({ user: { id: "1", role } })
  const res = await fn(...args)
  expect(res).toMatchObject({ error: "Unauthorized" })
  expect(res).not.toHaveProperty("success")
  expect(prismaCalls).toEqual([])
}

beforeEach(() => {
  prismaCalls.length = 0
  mockAuth.mockReset()
})

describe("accounting mutations refuse non-accounting roles", () => {
  const cases = accountingRows.flatMap(([name, fn, args]) => ACCOUNTING_ROLES.map((role) => [name, role, fn, args] as const))
  it.each(cases)("%s as %s", async (_name, role, fn, args) => {
    await expectRefused(fn, args, role)
  })

  it.each(ACCOUNTING_ROLES)("pettyCashSession.ensureWeeklySession as %s", async (role) => {
    mockAuth.mockResolvedValue({ user: { id: "1", role } })
    await expect(pettyCashSession.ensureWeeklySession()).resolves.toEqual({ status: "not-editor" })
    expect(prismaCalls).toEqual([])
  })

  it("refuses an unauthenticated caller", async () => {
    mockAuth.mockResolvedValue(null)
    for (const [, fn, args] of accountingRows) {
      await expect(fn(...args)).resolves.toMatchObject({ error: "Unauthorized" })
    }
    expect(prismaCalls).toEqual([])
  })
})

describe("event / person / family mutations refuse VIEWER and EVENT_ORGANISER", () => {
  const cases = peopleRows.flatMap(([name, fn, args]) => PEOPLE_ROLES.map((role) => [name, role, fn, args] as const))
  it.each(cases)("%s as %s", async (_name, role, fn, args) => {
    await expectRefused(fn, args, role)
  })
})
