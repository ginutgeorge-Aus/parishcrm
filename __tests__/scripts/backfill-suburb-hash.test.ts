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

type Guard = { where: { id: number; suburb: string; suburbHash: null }; data: { suburbHash: string } }

/**
 * In-memory Family table honouring the backfill's query shape and the guarded
 * updateMany. `afterRead` runs once after the first page is read, to simulate
 * a concurrent edit between read and write.
 */
function fakeDb(initial: Row[], afterRead?: (rows: Map<number, Row>) => void) {
  const rows = new Map(initial.map((r) => [r.id, { ...r }]))
  let hook = afterRead
  const update = jest.fn(async ({ where, data }: Guard) => {
    const r = rows.get(where.id)
    if (!r || r.suburb !== where.suburb || r.suburbHash !== null) return { count: 0 }
    r.suburbHash = data.suburbHash
    return { count: 1 }
  })
  const db = {
    family: {
      findMany: jest.fn(async ({ where, take }: { where: { id: { gt: number } }; take: number }) => {
        const page = [...rows.values()]
          .filter((r) => r.id > where.id.gt && r.suburb !== null && r.suburbHash === null)
          .sort((a, b) => a.id - b.id)
          .slice(0, take)
          .map((r) => ({ id: r.id, suburb: r.suburb }))
        hook?.(rows)
        hook = undefined
        return page
      }),
      updateMany: update,
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

  it("does not overwrite a family edited between read and write", async () => {
    const edited = core.encrypt("Ryde")
    const { db, rows } = fakeDb([{ id: 1, suburb: core.encrypt("Parramatta"), suburbHash: null }], (r) => {
      // Concurrent edit through the app: new suburb with its own hash.
      r.set(1, { id: 1, suburb: edited, suburbHash: core.hmacSuburb("Ryde") })
    })
    expect(await mod.backfillSuburbHash(db as never, true, 10)).toEqual({ changed: 0, scanned: 1 })
    expect(rows.get(1)).toEqual({ id: 1, suburb: edited, suburbHash: core.hmacSuburb("Ryde") })
  })

  it("hashes a legacy plaintext suburb (decrypt passes plaintext through) without rewriting it", async () => {
    const { db, rows } = fakeDb([{ id: 1, suburb: "Blacktown", suburbHash: null }])
    await mod.backfillSuburbHash(db as never, true, 10)
    expect(rows.get(1)).toEqual({ id: 1, suburb: "Blacktown", suburbHash: core.hmacSuburb("blacktown") })
  })
})
