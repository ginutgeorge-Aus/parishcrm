/** @jest-environment node */
// Real-Postgres race test for the persistent rate limiter (StMarkCRM#3331, PR 4).
// The mocked suite (__tests__/lib/dbRateLimit.test.ts) only proves the code asks for an
// atomic `count < limit` increment; this proves Postgres really enforces it under
// parallel load. Opt-in: runs only with INTEGRATION_DB=1 against a migrated, disposable
// database (see docs/integration-tests.md); skipped in the normal `npm test` run.

// Module scope: keeps this file's top-level names out of the shared global script scope.
export {}

jest.mock("server-only", () => ({}))

const RUN = process.env.INTEGRATION_DB === "1"
jest.setTimeout(60_000)

;(RUN ? describe : describe.skip)("dbRateLimit races (real Postgres)", () => {
  let prisma: typeof import("@/lib/prisma").prisma
  let dbRateLimit: typeof import("@/lib/dbRateLimit").dbRateLimit
  const tag = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const keys: string[] = []

  /**
   * Returns a unique limiter key and remembers it for cleanup.
   * @param name - short label for the case
   */
  function newKey(name: string): string {
    const key = `race-${tag}-${name}`
    keys.push(key)
    return key
  }

  beforeAll(async () => {
    ;({ prisma } = await import("@/lib/prisma"))
    ;({ dbRateLimit } = await import("@/lib/dbRateLimit"))
  })

  afterAll(async () => {
    if (!prisma) return
    await prisma.rateLimit.deleteMany({ where: { key: { in: keys } } })
    await prisma.$disconnect()
  })

  it("lets exactly `limit` calls through when limit+15 arrive in parallel on an open window", async () => {
    const key = newKey("open")
    const LIMIT = 5
    // Open the window first: the guard under test is the atomic `count < limit` increment.
    expect(await dbRateLimit(key, LIMIT, 60_000)).toBe(true)
    const results = await Promise.all(Array.from({ length: LIMIT + 15 }, () => dbRateLimit(key, LIMIT, 60_000)))
    // 1 (opener) + exactly LIMIT-1 of the parallel burst.
    expect(results.filter(Boolean)).toHaveLength(LIMIT - 1)
    const row = await prisma.rateLimit.findUnique({ where: { key } })
    expect(row?.count).toBe(LIMIT)
  })

  it("never over-admits when the burst itself opens the window", async () => {
    const key = newKey("fresh")
    const LIMIT = 5
    const results = await Promise.all(Array.from({ length: LIMIT + 15 }, () => dbRateLimit(key, LIMIT, 60_000)))
    const allowed = results.filter(Boolean).length
    // Documented best-effort (dbRateLimit.ts): a simultaneous fresh-window burst may
    // under-count, never over-count.
    expect(allowed).toBeGreaterThanOrEqual(1)
    expect(allowed).toBeLessThanOrEqual(LIMIT)
    const row = await prisma.rateLimit.findUnique({ where: { key } })
    expect(row?.count).toBe(allowed)
  })
})
