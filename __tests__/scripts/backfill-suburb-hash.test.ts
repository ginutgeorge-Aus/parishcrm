/** @jest-environment node */
// OSS-39 backfill: fills Family.suburbHash for rows written before the column.
// Dry run writes nothing; apply sets the same hash the write path would; a
// second run is a no-op; undecryptable / blank suburbs are skipped.

export {} // module scope

type Row = { id: number; suburb: string | null; suburbHash: string | null }

let mod: typeof import("../../scripts/backfill-suburb-hash")
let core: typeof import("@/lib/cryptoCore")

beforeAll(async () => {
  process.env.ENCRYPTION_KEY_V1 = Buffer.alloc(32, 3).toString("base64")
  process.env.ENCRYPTION_KEY_ID = "v1"
  process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/db" // never connected — fake db injected
  mod = await import("../../scripts/backfill-suburb-hash")
  core = await import("@/lib/cryptoCore")
})

afterAll(() => {
  for (const k of ["ENCRYPTION_KEY_V1", "ENCRYPTION_KEY_ID", "DATABASE_URL"]) delete process.env[k]
})

/** In-memory Family table honouring the backfill's query shape. */
function fakeDb(initial: Row[]) {
  const rows = new Map(initial.map((r) => [r.id, { ...r }]))
  const update = jest.fn(async ({ where, data }: { where: { id: number }; data: { suburbHash: string } }) => {
    rows.get(where.id)!.suburbHash = data.suburbHash
  })
  const db = {
    family: {
      findMany: jest.fn(async ({ where, take }: { where: { id: { gt: number } }; take: number }) =>
        [...rows.values()]
          .filter((r) => r.id > where.id.gt && r.suburb !== null && r.suburbHash === null)
          .sort((a, b) => a.id - b.id)
          .slice(0, take)
          .map((r) => ({ id: r.id, suburb: r.suburb })),
      ),
      update,
    },
  }
  return { db, rows, update }
}

describe("backfillSuburbHash", () => {
  const seed = (): Row[] => [
    { id: 1, suburb: core.encrypt("  Parramatta "), suburbHash: null },
    { id: 2, suburb: core.encrypt("Ryde"), suburbHash: null },
    { id: 3, suburb: "enc:v1:AAAA:AAAA:AAAA", suburbHash: null }, // corrupt
    { id: 4, suburb: core.encrypt("   "), suburbHash: null }, // blank
    { id: 5, suburb: null, suburbHash: null },
    { id: 6, suburb: core.encrypt("Blacktown"), suburbHash: "already" },
  ]

  beforeEach(() => jest.spyOn(console, "warn").mockImplementation(() => {}))
  afterEach(() => jest.restoreAllMocks())

  it("dry run counts but writes nothing", async () => {
    const { db, update } = fakeDb(seed())
    expect(await mod.backfillSuburbHash(db as never, false, 2)).toEqual({ changed: 2, scanned: 4 })
    expect(update).not.toHaveBeenCalled()
  })

  it("apply sets the write-path hash, skips corrupt/blank rows, and is idempotent", async () => {
    const { db, rows } = fakeDb(seed())
    await mod.backfillSuburbHash(db as never, true, 2)
    expect(rows.get(1)!.suburbHash).toBe(core.hmacSuburb("parramatta"))
    expect(rows.get(2)!.suburbHash).toBe(core.hmacSuburb("Ryde"))
    expect(rows.get(3)!.suburbHash).toBeNull()
    expect(rows.get(4)!.suburbHash).toBeNull()
    expect(rows.get(6)!.suburbHash).toBe("already")
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Family #3"))
    expect(await mod.backfillSuburbHash(db as never, true, 2)).toEqual({ changed: 0, scanned: 2 })
  })
})
