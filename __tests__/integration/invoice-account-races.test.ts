/** @jest-environment node */
// Real-Postgres race tests for the Serializable guards between invoice writes and
// account retype/delete (#266, #321). The mocked-Prisma suites prove the code
// paths; only a real database proves Postgres actually aborts one side of each
// read/write cycle. Runs only with INTEGRATION_DB=1 against a migrated, disposable
// database (CI's `migrations` job); skipped in the normal `npm test` run.
//
// Each case fires the two conflicting actions concurrently, many times, and checks
// that exactly one side committed and the database matches the winner — a
// conflict must surface as a friendly error, never a throw.

jest.mock("server-only", () => ({}))
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => {
    throw new MockRedirect()
  }),
}))

/** Thrown by the mocked `redirect`, which is how the actions report success. */
class MockRedirect extends Error {}

const RUN = process.env.INTEGRATION_DB === "1"
const ROUNDS = 12
// Real round-trips under contention: give CI headroom over Jest's 5s default.
jest.setTimeout(60_000)

type Outcome = { ok: true } | { error: string }

;(RUN ? describe : describe.skip)("invoice vs account races (real Postgres)", () => {
  // Loaded lazily so the skipped run never touches Prisma or the env it needs.
  let prisma: typeof import("@/lib/prisma").prisma
  let actions: typeof import("@/lib/actions/invoice") & typeof import("@/lib/actions/account")
  let incomeGroup: number
  let expenseGroup: number
  // Random suffix: parallel CI workers can share a millisecond.
  const tag = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  let seq = 0

  /**
   * Maps an action's return value to ok/error.
   * @param result - what the action resolved to
   */
  function toOutcome(result: unknown): Outcome {
    if (result && typeof result === "object" && "error" in result) return { error: String(result.error) }
    return { ok: true }
  }

  /**
   * Settles a server action into ok/error. A redirect is how the actions report
   * success; any other thrown error fails the test.
   * @param action - the action's promise
   */
  async function settle(action: Promise<unknown>): Promise<Outcome> {
    try {
      return toOutcome(await action)
    } catch (err) {
      if (err instanceof MockRedirect) return { ok: true }
      throw err
    }
  }

  /**
   * Builds a FormData from plain string fields.
   * @param fields - field name → value
   */
  function fd(fields: Record<string, string>): FormData {
    const form = new FormData()
    for (const [key, value] of Object.entries(fields)) form.set(key, value)
    return form
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

  /**
   * Asserts exactly one of two raced actions committed, so a path that always
   * errors (or both erroring) fails the test instead of passing vacuously.
   * @param first - one side's outcome
   * @param second - the other side's outcome
   */
  function expectExactlyOneOk(first: Outcome, second: Outcome) {
    expect([first, second].filter((o) => "ok" in o)).toHaveLength(1)
  }

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
    if (!prisma) return
    // Best-effort cleanup so a reused local database stays tidy. The admin user stays: audit rows reference it.
    const groupId = { in: [incomeGroup, expenseGroup].filter(Boolean) }
    await prisma.invoice.deleteMany({ where: { account: { groupId } } })
    await prisma.account.deleteMany({ where: { groupId } })
    await prisma.accountGroup.deleteMany({ where: { id: groupId } })
    await prisma.$disconnect()
  })

  /** Creates a fresh active INCOME account in the income group. */
  async function newIncomeAccount(): Promise<{ id: number; code: string }> {
    const code = `R${tag}${seq++}`.slice(0, 20)
    const account = await prisma.account.create({ data: { code, name: `Race ${code}`, type: "INCOME", groupId: incomeGroup } })
    return { id: account.id, code: account.code }
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
   * Asserts the database matches whichever side won a retype race: retype won →
   * EXPENSE with no invoices; invoice write won → still INCOME with one invoice.
   * @param accountId - the raced account
   * @param retypeWon - whether the retype committed
   */
  async function expectRetypeRaceState(accountId: number, retypeWon: boolean) {
    const account = await prisma.account.findUnique({ where: { id: accountId }, select: { type: true } })
    const invoices = await prisma.invoice.count({ where: { accountId } })
    expect({ type: account?.type, invoices }).toEqual(retypeWon ? { type: "EXPENSE", invoices: 0 } : { type: "INCOME", invoices: 1 })
  }

  it("retype vs createInvoice: exactly one commits", async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const acc = await newIncomeAccount()
      const [retyped, created] = await Promise.all([
        settle(retype(acc)),
        settle(actions.createInvoice(undefined, invoiceForm(acc.id))),
      ])
      expectExactlyOneOk(retyped, created)
      await expectRetypeRaceState(acc.id, "ok" in retyped)
    }
  })

  it("retype vs updateInvoice moving a draft onto the account: exactly one commits", async () => {
    const home = await newIncomeAccount()
    for (let i = 0; i < ROUNDS; i++) {
      const created = await settle(actions.createInvoice(undefined, invoiceForm(home.id)))
      expect(created).toEqual({ ok: true })
      const draft = await prisma.invoice.findFirstOrThrow({ where: { accountId: home.id }, orderBy: { id: "desc" } })
      const target = await newIncomeAccount()
      const [retyped, moved] = await Promise.all([
        settle(retype(target)),
        settle(actions.updateInvoice(draft.id, undefined, invoiceForm(target.id))),
      ])
      expectExactlyOneOk(retyped, moved)
      await expectRetypeRaceState(target.id, "ok" in retyped)
    }
  })

  it("deleteAccount vs createInvoice: exactly one commits, a conflict is a friendly error", async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const acc = await newIncomeAccount()
      // settle() rethrows anything but a redirect, so an unmapped P2003/P2034 fails here.
      const [deleted, created] = await Promise.all([
        settle(actions.deleteAccount(acc.id)),
        settle(actions.createInvoice(undefined, invoiceForm(acc.id))),
      ])
      expectExactlyOneOk(deleted, created)
      const exists = await prisma.account.count({ where: { id: acc.id } })
      const invoices = await prisma.invoice.count({ where: { accountId: acc.id } })
      expect({ exists, invoices }).toEqual("ok" in deleted ? { exists: 0, invoices: 0 } : { exists: 1, invoices: 1 })
    }
  })
})
