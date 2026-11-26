/** @jest-environment node */
// Real-Postgres race test for bank-statement confirm (StMarkCRM#3331 PR 4). Two people
// (or a double-click, or a retry) confirming the same statement at the same instant must
// not double-post: dedup reads a snapshot, so the unique bankRef column (plain rows,
// via createMany skipDuplicates) and the per-row transaction (split rows) are what really
// stop the second copy. Fires the real confirmBankImport concurrently and counts rows.
// Opt-in: runs only with INTEGRATION_DB=1 against a migrated, disposable database
// (see docs/integration-tests.md); skipped in the normal `npm test` run.

// Module scope: keeps this file's top-level names out of the shared global script scope.
export {}

jest.mock("server-only", () => ({}))

const RUN = process.env.INTEGRATION_DB === "1"
jest.setTimeout(60_000)

;(RUN ? describe : describe.skip)("bank import confirm races (real Postgres)", () => {
  let prisma: typeof import("@/lib/prisma").prisma
  let confirmBankImport: typeof import("@/lib/bankImportConfirm").confirmBankImport
  const tag = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  let groupId: number
  let paymentAccountId: number
  const accountIds: number[] = []
  let seq = 0

  /** Creates a fresh INCOME account, so each case counts only its own transactions. */
  async function newIncomeAccount(): Promise<number> {
    const code = `B${tag}${seq++}`.slice(0, 20)
    const account = await prisma.account.create({ data: { code, name: `Bank race ${code}`, type: "INCOME", groupId } })
    accountIds.push(account.id)
    return account.id
  }

  /**
   * One statement line body for confirmBankImport.
   * @param accountId - INCOME category for the line
   * @param n - makes the bankRef unique per case
   * @param splits - optional split allocations (must total 25.00)
   */
  function body(accountId: number, n: number, splits?: { accountId: number; amount: string }[]) {
    return {
      rows: [
        {
          date: "2026-10-04",
          description: "Race offering",
          amount: "25.00",
          type: "INCOME" as const,
          // ANZ_<account>_<yyyymmdd>_<amount>_<desc>_<balance>: the shape the parsers emit.
          bankRef: `ANZ_${n}123456_20261004_25.00_RACEOFFERING_${n}00000`,
          accountId: splits ? null : accountId,
          skip: false,
          paymentAccountId,
          splits,
        },
      ],
    }
  }

  beforeAll(async () => {
    ;({ prisma } = await import("@/lib/prisma"))
    ;({ confirmBankImport } = await import("@/lib/bankImportConfirm"))
    groupId = (await prisma.accountGroup.create({ data: { name: `Bank race ${tag}`, type: "INCOME" } })).id
    paymentAccountId = (await prisma.paymentAccount.create({ data: { name: `Bank race ${tag}`, kind: "BANK" } })).id
  })

  afterAll(async () => {
    if (!prisma) return
    try {
      await prisma.transaction.deleteMany({ where: { accountId: { in: accountIds } } })
      await prisma.account.deleteMany({ where: { id: { in: accountIds } } })
      if (groupId) await prisma.accountGroup.deleteMany({ where: { id: groupId } })
      if (paymentAccountId) await prisma.paymentAccount.deleteMany({ where: { id: paymentAccountId } })
    } finally {
      await prisma.$disconnect()
    }
  })

  it("same plain statement line confirmed 6x in parallel: one transaction", async () => {
    const accountId = await newIncomeAccount()
    const results = await Promise.all(Array.from({ length: 6 }, () => confirmBankImport(body(accountId, 1))))
    for (const r of results) expect(r.ok).toBe(true)
    const ok = results as { ok: true; imported: number; duplicates: number }[]
    expect(ok.reduce((t, r) => t + r.imported, 0)).toBe(1)
    expect(ok.reduce((t, r) => t + r.duplicates, 0)).toBe(5)
    expect(await prisma.transaction.count({ where: { accountId } })).toBe(1)
  })

  it("same split statement line confirmed 6x in parallel: one set of allocations", async () => {
    const a = await newIncomeAccount()
    const b = await newIncomeAccount()
    const splits = [
      { accountId: a, amount: "10.00" },
      { accountId: b, amount: "15.00" },
    ]
    const results = await Promise.all(Array.from({ length: 6 }, () => confirmBankImport(body(a, 2, splits))))
    // A loser may be refused with a DB_ERROR instead of counted as a duplicate; never a throw.
    // Every result is a success or exactly that refusal, and losers import nothing.
    for (const r of results) {
      if (!r.ok) expect(r.code).toBe("DB_ERROR")
    }
    const imported = results.reduce((t, r) => t + (r.ok ? r.imported : 0), 0)
    expect(imported).toBe(1)
    expect(await prisma.transaction.count({ where: { accountId: { in: [a, b] } } })).toBe(2)
  })

  it("re-confirming a finished import afterwards is skipped as a duplicate", async () => {
    const accountId = await newIncomeAccount()
    const first = await confirmBankImport(body(accountId, 3))
    const second = await confirmBankImport(body(accountId, 3))
    expect(first).toMatchObject({ ok: true, imported: 1 })
    expect(second).toMatchObject({ ok: true, imported: 0, duplicates: 1 })
    expect(await prisma.transaction.count({ where: { accountId } })).toBe(1)
  })
})
