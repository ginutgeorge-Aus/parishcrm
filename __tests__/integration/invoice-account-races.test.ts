/** @jest-environment node */
// Real-Postgres race tests for the Serializable guards between invoice writes and
// account retype/delete (#266, #321). The mocked-Prisma suites prove the code
// paths; only a real database proves Postgres actually aborts one side of each
// read/write cycle. Runs only with INTEGRATION_DB=1 against a migrated, disposable
// database (CI's `migrations` job); skipped in the normal `npm test` run.
//
// Each case fires the two conflicting actions concurrently, many times, and checks
// that exactly one side committed, the database matches the winner, and the loser
// got one of the expected friendly errors — never a throw.
//
// Promise.all alone doesn't make the transactions overlap (one can commit before the
// other starts), so every interactive transaction waits at a two-party barrier after
// its reads/writes and before commit. Both sides are then in flight at once, and each
// case asserts Postgres really raised a conflict at least once.

/**
 * Two-party rendezvous for the first attempt of each raced transaction. Released when
 * both sides arrive, or after a timeout (a side blocked on a row lock can't arrive).
 */
const mockBarrier = {
  armed: false,
  gen: 0,
  waiting: [] as (() => void)[],
  conflicts: 0,
  /** Arms the barrier for one round. */
  arm() {
    this.armed = true
    this.gen++
    this.waiting = []
  },
  /** Waits for the other side (or the timeout) while armed; passes straight through otherwise. */
  async arrive() {
    if (!this.armed) return
    const gen = this.gen
    await new Promise<void>((resolve) => {
      this.waiting.push(resolve)
      if (this.waiting.length >= 2) this.release(gen)
      else setTimeout(() => this.release(gen), 1500)
    })
  },
  /**
   * Lets every waiter of round `gen` commit and disarms, so retries don't wait.
   * @param gen - the round the release belongs to (a stale timer is ignored)
   */
  release(gen: number) {
    if (gen !== this.gen) return
    this.armed = false
    for (const resolve of this.waiting.splice(0)) resolve()
  },
}

// Wraps interactive $transaction so the body waits at the barrier before commit, and
// counts serialization/FK aborts (proof the two sides really overlapped).
jest.mock("@/lib/prisma", () => {
  const actual = jest.requireActual("@/lib/prisma")
  const { isP2003, isP2034 } = jest.requireActual("@/lib/validation")
  type Body = (tx: unknown) => Promise<unknown>
  const run = async (fn: Body, opts: unknown) => {
    try {
      return await actual.prisma.$transaction(async (tx: unknown) => {
        const result = await fn(tx)
        await mockBarrier.arrive()
        return result
      }, opts)
    } catch (err) {
      if (isP2034(err) || isP2003(err)) mockBarrier.conflicts++
      throw err
    }
  }
  const prisma = new Proxy(actual.prisma, {
    get: (target, prop) =>
      prop === "$transaction"
        ? (arg: unknown, opts: unknown) => (typeof arg === "function" ? run(arg as Body, opts) : target.$transaction(arg, opts))
        : Reflect.get(target, prop),
  })
  return { ...actual, prisma }
})

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
   * errors (or both erroring) fails the test instead of passing vacuously, and that
   * the loser failed with one of the guard's friendly errors (not some unrelated one).
   * @param first - one side's outcome
   * @param second - the other side's outcome
   * @param loserErrors - every error message the losing side may legitimately return
   */
  function expectOneWinner(first: Outcome, second: Outcome, loserErrors: string[]) {
    const losers = [first, second].filter((o): o is { error: string } => "error" in o)
    expect(losers).toHaveLength(1)
    expect(loserErrors).toContain(losers[0].error)
  }

  /**
   * Runs both actions with the barrier armed, so their transactions are in flight at once.
   * @param first - one side
   * @param second - the other side
   */
  function race(first: () => Promise<unknown>, second: () => Promise<unknown>): Promise<Outcome[]> {
    mockBarrier.arm()
    return Promise.all([settle(first()), settle(second())])
  }

  const CONFLICT = "This account was changed at the same time by someone else — try again."
  const NOT_INCOME = "Choose an active income account"
  const BUSY = "Couldn't save the invoice. Try again."
  const RETYPE_RACE_LOSERS = [CONFLICT, "Cannot change account type while invoices use it", NOT_INCOME, BUSY]
  const DELETE_RACE_LOSERS = [CONFLICT, "Cannot delete — 1 invoice(s) linked to this account", NOT_INCOME, BUSY]

  beforeEach(() => {
    mockBarrier.conflicts = 0
  })

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
      const [retyped, created] = await race(() => retype(acc), () => actions.createInvoice(undefined, invoiceForm(acc.id)))
      expectOneWinner(retyped, created, RETYPE_RACE_LOSERS)
      await expectRetypeRaceState(acc.id, "ok" in retyped)
    }
    expect(mockBarrier.conflicts).toBeGreaterThan(0)
  })

  it("retype vs updateInvoice moving a draft onto the account: exactly one commits", async () => {
    const home = await newIncomeAccount()
    for (let i = 0; i < ROUNDS; i++) {
      const created = await settle(actions.createInvoice(undefined, invoiceForm(home.id)))
      expect(created).toEqual({ ok: true })
      const draft = await prisma.invoice.findFirstOrThrow({ where: { accountId: home.id }, orderBy: { id: "desc" } })
      const target = await newIncomeAccount()
      const [retyped, moved] = await race(() => retype(target), () => actions.updateInvoice(draft.id, undefined, invoiceForm(target.id)))
      expectOneWinner(retyped, moved, RETYPE_RACE_LOSERS)
      await expectRetypeRaceState(target.id, "ok" in retyped)
    }
    expect(mockBarrier.conflicts).toBeGreaterThan(0)
  })

  it("deleteAccount vs createInvoice: exactly one commits, a conflict is a friendly error", async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const acc = await newIncomeAccount()
      // settle() rethrows anything but a redirect, so an unmapped P2003/P2034 fails here.
      const [deleted, created] = await race(() => actions.deleteAccount(acc.id), () => actions.createInvoice(undefined, invoiceForm(acc.id)))
      expectOneWinner(deleted, created, DELETE_RACE_LOSERS)
      const exists = await prisma.account.count({ where: { id: acc.id } })
      const invoices = await prisma.invoice.count({ where: { accountId: acc.id } })
      expect({ exists, invoices }).toEqual("ok" in deleted ? { exists: 0, invoices: 0 } : { exists: 1, invoices: 1 })
    }
    expect(mockBarrier.conflicts).toBeGreaterThan(0)
  })
})
