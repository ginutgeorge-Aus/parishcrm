/** @jest-environment node */
// Real-Postgres race tests for the Serializable guards between invoice writes and
// account retype/delete (#266, #321). The mocked-Prisma suites prove the code
// paths; only a real database proves Postgres actually aborts one side of each
// read/write cycle. Runs only with INTEGRATION_DB=1 against a migrated, disposable
// database (CI's `migrations` job); skipped in the normal `npm test` run.
//
// Each case fires the two conflicting actions concurrently, many times, and checks
// the invariant afterwards (never "account retyped AND an invoice on it") plus
// that neither action threw — a conflict must surface as a friendly error.

jest.mock("server-only", () => ({}))
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => {
    throw new Error("NEXT_REDIRECT")
  }),
}))

const RUN = process.env.INTEGRATION_DB === "1"
const ROUNDS = 12

type Outcome = { ok: true } | { error: string }

/**
 * Settles a server action into ok/error. A redirect is how the actions report
 * success; any other thrown error fails the test.
 * @param p - the action's promise
 */
async function settle(p: Promise<unknown>): Promise<Outcome> {
  try {
    const r = await p
    return r && typeof r === "object" && "error" in r ? { error: String((r as { error: unknown }).error) } : { ok: true }
  } catch (e) {
    if (e instanceof Error && e.message === "NEXT_REDIRECT") return { ok: true }
    throw e
  }
}

/**
 * Builds a FormData from plain string fields.
 * @param o - field name → value
 */
function fd(o: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(o)) f.set(k, v)
  return f
}

/**
 * A valid one-line draft invoice form posting to `accountId`.
 * @param accountId - income account id
 */
function invoiceForm(accountId: number): FormData {
  return fd({
    recipientKind: "none", recipientId: "", recipientName: "Hall hire client", recipientEmail: "", recipientAddress: "",
    issueDate: "2026-10-01", dueDate: "2026-10-15", accountId: String(accountId), fundId: "", notes: "",
    lines: JSON.stringify([{ description: "Hall hire", qty: "1", unitPrice: "100.00", gst: false }]),
  })
}

;(RUN ? describe : describe.skip)("invoice vs account races (real Postgres)", () => {
  // Loaded lazily so the skipped run never touches Prisma or the env it needs.
  let prisma: typeof import("@/lib/prisma").prisma
  let actions: typeof import("@/lib/actions/invoice") & typeof import("@/lib/actions/account")
  let incomeGroup: number
  let expenseGroup: number
  const tag = Date.now().toString(36)
  let seq = 0

  beforeAll(async () => {
    ;({ prisma } = await import("@/lib/prisma"))
    actions = { ...(await import("@/lib/actions/invoice")), ...(await import("@/lib/actions/account")) }
    const user = await prisma.user.create({
      data: { name: "Race test admin", email: `race-${tag}@example.com`, passwordHash: "x", role: "ADMIN" },
    })
    const { auth } = jest.requireMock("@/auth") as { auth: jest.Mock }
    auth.mockResolvedValue({ user: { id: String(user.id), role: "ADMIN" } })
    incomeGroup = (await prisma.accountGroup.create({ data: { name: `Race income ${tag}`, type: "INCOME" } })).id
    expenseGroup = (await prisma.accountGroup.create({ data: { name: `Race expense ${tag}`, type: "EXPENSE" } })).id
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  /** Creates a fresh active INCOME account in the income group. */
  async function newIncomeAccount(): Promise<{ id: number; code: string }> {
    const code = `R${tag}${seq++}`.slice(0, 20)
    const a = await prisma.account.create({ data: { code, name: `Race ${code}`, type: "INCOME", groupId: incomeGroup } })
    return { id: a.id, code: a.code }
  }

  /**
   * Retypes the account to EXPENSE (moving it to the expense group).
   * @param acc - the account to retype
   */
  function retype(acc: { id: number; code: string }) {
    return actions.updateAccount(acc.id, undefined, fd({
      code: acc.code, name: `Race ${acc.code}`, type: "EXPENSE", groupId: String(expenseGroup), isActive: "true",
    }))
  }

  /**
   * Asserts the invariant: an account that ended up EXPENSE has no invoices.
   * @param accountId - the raced account
   */
  async function expectNoInvoiceOnRetypedAccount(accountId: number) {
    const account = await prisma.account.findUnique({ where: { id: accountId }, select: { type: true } })
    const invoices = await prisma.invoice.count({ where: { accountId } })
    if (account?.type === "EXPENSE") expect(invoices).toBe(0)
  }

  it("retype vs createInvoice: never both commit", async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const acc = await newIncomeAccount()
      const [r, c] = await Promise.all([settle(retype(acc)), settle(actions.createInvoice(undefined, invoiceForm(acc.id)))])
      expect("ok" in r && "ok" in c).toBe(false)
      await expectNoInvoiceOnRetypedAccount(acc.id)
    }
  })

  it("retype vs updateInvoice moving a draft onto the account: never both commit", async () => {
    const home = await newIncomeAccount()
    for (let i = 0; i < ROUNDS; i++) {
      const created = await settle(actions.createInvoice(undefined, invoiceForm(home.id)))
      expect(created).toEqual({ ok: true })
      const draft = await prisma.invoice.findFirstOrThrow({ where: { accountId: home.id }, orderBy: { id: "desc" } })
      const target = await newIncomeAccount()
      const [r, u] = await Promise.all([
        settle(retype(target)),
        settle(actions.updateInvoice(draft.id, undefined, invoiceForm(target.id))),
      ])
      expect("ok" in r && "ok" in u).toBe(false)
      await expectNoInvoiceOnRetypedAccount(target.id)
    }
  })

  it("deleteAccount vs createInvoice: a conflict is a friendly error, never a throw", async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const acc = await newIncomeAccount()
      // settle() rethrows anything but a redirect, so an unmapped P2003/P2034 fails here.
      const [d, c] = await Promise.all([
        settle(actions.deleteAccount(acc.id)),
        settle(actions.createInvoice(undefined, invoiceForm(acc.id))),
      ])
      const exists = await prisma.account.count({ where: { id: acc.id } })
      const invoices = await prisma.invoice.count({ where: { accountId: acc.id } })
      if ("ok" in d) expect(exists).toBe(0)
      if (!exists) expect(invoices).toBe(0)
      if ("ok" in c) expect(exists).toBe(1)
    }
  })
})
