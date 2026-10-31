/** @jest-environment node */
// #459 backfill: rewrite legacy full-number Transaction.bankRef values to the
// hashed at-rest format. Must be dry-run by default, idempotent, never clobber a
// row that changed under it, and survive a unique collision with a hashed twin.

export {} // module scope (keeps KEY1 etc. out of the global script scope)
const KEY1 = Buffer.alloc(32, 7).toString("base64")
const ACCT = "987654321"

type Row = { id: number; bankRef: string | null }
type Write = { where: { id: number; bankRef: string | null }; data: { bankRef: string } }
type Where = { id?: { gt?: number; in?: number[] } | number; bankRef?: { in?: string[] }; description?: { startsWith?: string } }

/**
 * In-memory Transaction table honouring the conditional updateMany and the
 * bankRef unique index; `runWrites` is all-or-nothing like the script's
 * interactive transaction (StaleWriteError when a guarded write matches none).
 * `descriptions` backs the v1 key-check canary query.
 */
function fakeDb(
  initial: Row[],
  hooks: { beforeWrite?: (rows: Map<number, Row>) => void } = {},
  descriptions: () => { id: number; description: string }[] = () => [{ id: 900, description: v1Canary() }],
) {
  const rows = new Map(initial.map((r) => [r.id, { ...r }]))
  const delegate = {
    findMany: jest.fn(async (args: { where?: Where; take?: number }) => {
      if (args.where?.description) return descriptions()
      const w = args.where?.id
      const refIn = args.where?.bankRef?.in
      const all = [...rows.values()].sort((a, b) => a.id - b.id)
      const out = refIn
        ? all.filter((r) => r.bankRef !== null && refIn.includes(r.bankRef))
        : typeof w === "number"
          ? all.filter((r) => r.id === w)
          : w?.in
            ? all.filter((r) => w.in!.includes(r.id))
            : all.filter((r) => w?.gt === undefined || r.id > w.gt)
      return out.slice(0, args.take ?? out.length).map((r) => ({ ...r }))
    }),
  }
  const runWrites = jest.fn(async (writes: Write[]) => {
    hooks.beforeWrite?.(rows)
    hooks.beforeWrite = undefined
    const next = new Map([...rows].map(([k, v]) => [k, { ...v }]))
    for (const w of writes) {
      const r = next.get(w.where.id)
      if (!r || r.bankRef !== w.where.bankRef) throw new mod.StaleWriteError(w.where.id)
      if ([...next.values()].some((o) => o.id !== r.id && o.bankRef === w.data.bankRef)) {
        throw Object.assign(new Error("Unique constraint failed on the fields: (`bankRef`)"), { code: "P2002" })
      }
      r.bankRef = w.data.bankRef
    }
    for (const [k, v] of next) rows.set(k, v)
  })
  return { rows, delegate, runWrites }
}

let mod: typeof import("../../scripts/hash-bankref-account")
let hashStoredBankRef: (ref: string) => string
let encrypt: (plaintext: string) => string
/** A description encrypted under the test's v1 key. */
const v1Canary = () => encrypt("Opening balance")

beforeEach(async () => {
  jest.resetModules()
  process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/db" // never connected — delegate injected
  process.env.ENCRYPTION_KEY_V1 = KEY1
  process.env.ENCRYPTION_KEY_ID = "v1"
  mod = await import("../../scripts/hash-bankref-account")
  hashStoredBankRef = (await import("@/lib/bankRefHash")).hashStoredBankRef
  encrypt = (await import("@/lib/cryptoCore")).encrypt
  jest.spyOn(console, "log").mockImplementation(() => {})
  jest.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
  for (const k of ["DATABASE_URL", "ENCRYPTION_KEY_V1", "ENCRYPTION_KEY_ID"]) delete process.env[k]
})

const legacy = (id: number, ref: string): Row => ({ id, bankRef: ref })
const seed = (): Row[] => [
  legacy(1, `ANZ_${ACCT}_20250623_60.00_PAYMENTFROMJACK_5176894`),
  legacy(2, `ANZ_${ACCT}_20250623_100.00_SPLIT_5186894#2`),
  legacy(3, `XFER_OUT_ANZ_${ACCT}_20250722_1200.00_CASHDEPOSIT_123456`),
  legacy(4, `OFX_000111224821_20260902_200.00_TRANSFER_0001112248210001`),
  legacy(5, "QIF_PA3_20260905_10.00_SHOP_1"),
  legacy(6, "PC_R_12"),
  legacy(7, null as unknown as string),
]

it("dry run (default) counts legacy rows without writing", async () => {
  const db = fakeDb(seed())
  const res = await mod.hashBankRefs({ delegate: db.delegate, runWrites: db.runWrites, apply: false })
  expect(res).toEqual({ changed: 4, conflicts: 0, collisions: 0 })
  expect(db.runWrites).not.toHaveBeenCalled()
  expect(db.rows.get(1)!.bankRef).toContain(ACCT)
})

it("apply rewrites ANZ, split siblings, XFER_OUT pairs and OFX; leaves QIF/manual refs alone", async () => {
  const db = fakeDb(seed())
  const before = seed()
  const res = await mod.hashBankRefs({ delegate: db.delegate, runWrites: db.runWrites, apply: true })
  expect(res).toEqual({ changed: 4, conflicts: 0, collisions: 0 })
  for (const r of before) expect(db.rows.get(r.id)!.bankRef).toBe(r.bankRef === null ? null : hashStoredBankRef(r.bankRef))
  for (const r of db.rows.values()) {
    expect(r.bankRef ?? "").not.toContain(ACCT)
    expect(r.bankRef ?? "").not.toContain("000111224821")
  }
  expect(db.rows.get(2)!.bankRef).toMatch(/#2$/)
  // The XFER_OUT leg = XFER_OUT_ + the hashed deposit ref, so xferOutRef() pairing holds.
  expect(db.rows.get(3)!.bankRef).toBe(`XFER_OUT_${hashStoredBankRef(before[2].bankRef!.slice("XFER_OUT_".length))}`)
  expect(db.rows.get(5)!.bankRef).toBe("QIF_PA3_20260905_10.00_SHOP_1")
  // The XFER_OUT leg still pairs with its (hashed) deposit ref.
  expect(db.rows.get(3)!.bankRef!.startsWith("XFER_OUT_ANZ_h")).toBe(true)
})

it("is idempotent: a second apply run changes nothing", async () => {
  const db = fakeDb(seed())
  await mod.hashBankRefs({ delegate: db.delegate, runWrites: db.runWrites, apply: true })
  const snapshot = [...db.rows.values()].map((r) => ({ ...r }))
  db.runWrites.mockClear()
  const res = await mod.hashBankRefs({ delegate: db.delegate, runWrites: db.runWrites, apply: true })
  expect(res).toEqual({ changed: 0, conflicts: 0, collisions: 0 })
  expect(db.runWrites).not.toHaveBeenCalled()
  expect([...db.rows.values()]).toEqual(snapshot)
})

it("never overwrites a row that changed between read and write (conditional update)", async () => {
  const concurrent = hashStoredBankRef(`ANZ_${ACCT}_20250623_60.00_PAYMENTFROMJACK_5176894`)
  // Another writer (e.g. a newer app instance) rewrites row 1 after the batch read.
  const db = fakeDb([seed()[0]], { beforeWrite: (rows) => (rows.get(1)!.bankRef = concurrent) })
  const res = await mod.hashBankRefs({ delegate: db.delegate, runWrites: db.runWrites, apply: true })
  // Re-read shows it is already hashed → resolved, not a conflict, nothing clobbered.
  expect(res).toEqual({ changed: 0, conflicts: 0, collisions: 0 })
  expect(db.rows.get(1)!.bankRef).toBe(concurrent)
})

it("retries a row that changed to another legacy value and writes the fresh value", async () => {
  const fresh = `ANZ_${ACCT}_20250623_60.00_EDITED_1`
  const db = fakeDb([seed()[0]], { beforeWrite: (rows) => (rows.get(1)!.bankRef = fresh) })
  const res = await mod.hashBankRefs({ delegate: db.delegate, runWrites: db.runWrites, apply: true })
  expect(res).toEqual({ changed: 1, conflicts: 0, collisions: 0 })
  expect(db.rows.get(1)!.bankRef).toBe(hashStoredBankRef(fresh))
})

it("a unique collision with an existing hashed twin is skipped and reported; the rest of the batch commits", async () => {
  const ref = `ANZ_${ACCT}_20250623_60.00_PAYMENTFROMJACK_5176894`
  const db = fakeDb([legacy(1, ref), legacy(2, `ANZ_${ACCT}_20250624_5.00_OTHER_1`), { id: 3, bankRef: hashStoredBankRef(ref) }])
  const res = await mod.hashBankRefs({ delegate: db.delegate, runWrites: db.runWrites, apply: true })
  expect(res).toEqual({ changed: 1, conflicts: 0, collisions: 1 })
  expect(db.rows.get(1)!.bankRef).toBe(ref) // untouched, needs a manual decision
  expect(db.rows.get(2)!.bankRef).not.toContain(ACCT)
  // Logs never print a ref (they hold the account number).
  const logged = [...(console.warn as jest.Mock).mock.calls, ...(console.log as jest.Mock).mock.calls].flat().join("\n")
  expect(logged).not.toContain(ACCT)
})

describe("deposit + XFER_OUT_ leg pairing", () => {
  const deposit = `ANZ_${ACCT}_20250722_1200.00_CASHDEPOSIT_123456`
  const leg = `XFER_OUT_${deposit}`

  it("writes a deposit and its leg in one transaction even when they fall in different batches", async () => {
    const db = fakeDb([legacy(1, deposit), legacy(2, `ANZ_${ACCT}_20250723_5.00_OTHER_1`), legacy(3, leg)])
    const res = await mod.hashBankRefs({ delegate: db.delegate, runWrites: db.runWrites, apply: true, batchSize: 1 })
    expect(res).toEqual({ changed: 3, conflicts: 0, collisions: 0 })
    expect(db.runWrites.mock.calls[0][0].map((w) => w.where.id)).toEqual([1, 3])
    expect(db.rows.get(3)!.bankRef).toBe(`XFER_OUT_${db.rows.get(1)!.bankRef}`)
  })

  it("a collision on the leg leaves the deposit legacy too (pair never split), reported once per row", async () => {
    const db = fakeDb([legacy(1, deposit), legacy(2, leg), { id: 3, bankRef: hashStoredBankRef(leg) }])
    const res = await mod.hashBankRefs({ delegate: db.delegate, runWrites: db.runWrites, apply: true, batchSize: 1 })
    expect(res).toEqual({ changed: 0, conflicts: 0, collisions: 2 })
    expect(db.rows.get(1)!.bankRef).toBe(deposit)
    expect(db.rows.get(2)!.bankRef).toBe(leg)
  })
})

describe("v1 key check (apply only)", () => {
  it("refuses to --apply when the v1 canary does not decrypt with this run's key — nothing written", async () => {
    const foreign = v1Canary()
    jest.resetModules()
    process.env.ENCRYPTION_KEY_V1 = Buffer.alloc(32, 9).toString("base64") // not the DB's key
    mod = await import("../../scripts/hash-bankref-account")
    const db = fakeDb(seed(), {}, () => [{ id: 900, description: foreign }])
    await expect(mod.hashBankRefs({ delegate: db.delegate, runWrites: db.runWrites, apply: true })).rejects.toThrow(
      /Key check failed: Transaction #900 does not decrypt/,
    )
    expect(db.runWrites).not.toHaveBeenCalled()
    expect(db.rows.get(1)!.bankRef).toContain(ACCT)
  })

  it("refuses to --apply when no v1-encrypted description exists to check against", async () => {
    const db = fakeDb(seed(), {}, () => [{ id: 901, description: "plain text" }])
    await expect(mod.hashBankRefs({ delegate: db.delegate, runWrites: db.runWrites, apply: true })).rejects.toThrow(/no v1-encrypted/)
    expect(db.runWrites).not.toHaveBeenCalled()
  })

  it("the dry run does not need the key check", async () => {
    const db = fakeDb(seed(), {}, () => [])
    await expect(mod.hashBankRefs({ delegate: db.delegate, runWrites: db.runWrites, apply: false })).resolves.toEqual({
      changed: 4,
      conflicts: 0,
      collisions: 0,
    })
  })
})

it("dry run reports rows whose hashed twin already exists as collisions", async () => {
  const ref = `ANZ_${ACCT}_20250623_60.00_PAYMENTFROMJACK_5176894`
  const db = fakeDb([legacy(1, ref), legacy(2, `ANZ_${ACCT}_20250624_5.00_OTHER_1`), { id: 3, bankRef: hashStoredBankRef(ref) }])
  const res = await mod.hashBankRefs({ delegate: db.delegate, runWrites: db.runWrites, apply: false })
  expect(res).toEqual({ changed: 1, conflicts: 0, collisions: 1 })
  expect(db.runWrites).not.toHaveBeenCalled()
})

it("a pair whose deposit changed concurrently is retried as a unit, never half-hashed", async () => {
  const deposit = `ANZ_${ACCT}_20250722_1200.00_CASHDEPOSIT_123456`
  const edited = `ANZ_${ACCT}_20250722_1200.00_CASHDEPOSIT_999999`
  // Deposit changes between read and write; its leg does not (so the leg's guarded write alone would succeed).
  let writes = 0
  const db = fakeDb([legacy(1, deposit), legacy(2, `XFER_OUT_${deposit}`)])
  const inner = db.runWrites.getMockImplementation()!
  db.runWrites.mockImplementation(async (w) => {
    if (writes++ === 0) db.rows.get(1)!.bankRef = edited
    return inner(w)
  })
  const res = await mod.hashBankRefs({ delegate: db.delegate, runWrites: db.runWrites, apply: true })
  // The failing attempts wrote nothing; the retry re-read both rows and wrote them together.
  expect(db.rows.get(1)!.bankRef).toBe(hashStoredBankRef(edited))
  expect(db.rows.get(2)!.bankRef).toBe(hashStoredBankRef(`XFER_OUT_${deposit}`))
  expect(res).toEqual({ changed: 2, conflicts: 0, collisions: 0 })
  // Every runWrites call that touched the leg also carried the deposit.
  for (const [ws] of db.runWrites.mock.calls) {
    const ids = ws.map((w: { where: { id: number } }) => w.where.id)
    if (ids.includes(2)) expect(ids).toContain(1)
  }
})

it("safeErrorText scrubs bankRefs (and the account number in them) from logged errors", () => {
  const e = Object.assign(new Error(`Invalid update: where { bankRef: "XFER_OUT_ANZ_${ACCT}_20250722_1.00_X_1" } and 'OFX_${ACCT}_2'`), {
    code: "P2025",
  })
  const text = mod.safeErrorText(e)
  expect(text).not.toContain(ACCT)
  expect(text).toBe(`P2025: Invalid update: where { bankRef: "<bankRef>" } and '<bankRef>'`)
  expect(mod.safeErrorText("boom")).toBe("Error: boom")
})
