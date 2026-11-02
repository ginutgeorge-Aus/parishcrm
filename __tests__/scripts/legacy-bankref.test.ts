/** @jest-environment node */
// #459: shared legacy-bankRef detection used by both the hash-bankref-account
// backfill and the audit-data-integrity check, so the two can never disagree on
// what "0 legacy rows remain" means.

export {} // module scope
const ACCT = "987654321"

type Row = { id: number; bankRef: string | null }
type Args = { where: { id: { gt: number } }; take: number }

let mod: typeof import("../../scripts/lib/legacy-bankref")
let hashStoredBankRef: (ref: string) => string

beforeEach(async () => {
  jest.resetModules()
  process.env.ENCRYPTION_KEY_V1 = Buffer.alloc(32, 7).toString("base64")
  process.env.ENCRYPTION_KEY_ID = "v1"
  mod = await import("../../scripts/lib/legacy-bankref")
  hashStoredBankRef = (await import("@/lib/bankRefHash")).hashStoredBankRef
})

afterEach(() => {
  for (const k of ["ENCRYPTION_KEY_V1", "ENCRYPTION_KEY_ID"]) delete process.env[k]
})

/**
 * Transaction delegate honouring the keyset page (`id > gt`, `take`); the
 * prefix filter is left to the detector, which must ignore non-legacy rows.
 *
 * @param rows - the table
 * @returns delegate with a jest findMany
 */
function delegateOf(rows: Row[]) {
  return {
    findMany: jest.fn(async (args: unknown) => {
      const { where, take } = args as Args
      return rows.filter((r) => r.id > where.id.gt).slice(0, take)
    }),
  }
}

const deposit = `ANZ_${ACCT}_20250722_1200.00_CASHDEPOSIT_123456`

it("counts only rows the backfill would rewrite, never returning refs", async () => {
  const rows: Row[] = [
    { id: 1, bankRef: deposit },
    { id: 2, bankRef: `XFER_OUT_${deposit}` },
    { id: 3, bankRef: hashStoredBankRef(`ANZ_${ACCT}_20250723_5.00_OTHER_1`) },
    { id: 4, bankRef: "QIF_PA3_20260905_10.00_SHOP_1" },
    { id: 5, bankRef: null },
    { id: 6, bankRef: `OFX_000111224821_20260902_200.00_TRANSFER_1` },
  ]
  const res = await mod.countLegacyBankRefs(delegateOf(rows), 2)
  expect(res).toEqual({ count: 3, sampleIds: [1, 2, 6] })
  // Exactly the rows the backfill's planBankRefRewrite would rewrite.
  expect(rows.filter((r) => mod.planBankRefRewrite(r.bankRef) !== null).map((r) => r.id)).toEqual([1, 2, 6])
})

it("reports zero once every ref is hashed (the go-ahead to drop legacy matching)", async () => {
  const rows: Row[] = [deposit, `XFER_OUT_${deposit}`].map((ref, i) => ({ id: i + 1, bankRef: hashStoredBankRef(ref) }))
  await expect(mod.countLegacyBankRefs(delegateOf(rows))).resolves.toEqual({ count: 0, sampleIds: [] })
})

it("paginates by keyset and caps the sample at 5 ids", async () => {
  const rows: Row[] = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, bankRef: `ANZ_${ACCT}_20250101_1.00_X_${i}` }))
  const d = delegateOf(rows)
  const res = await mod.countLegacyBankRefs(d, 3)
  expect(res).toEqual({ count: 7, sampleIds: [1, 2, 3, 4, 5] })
  expect(d.findMany.mock.calls.map(([a]) => (a as Args).where.id.gt)).toEqual([0, 3, 6])
})
