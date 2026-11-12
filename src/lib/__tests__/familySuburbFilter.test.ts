/** @jest-environment node */
// OSS-39: the suburb filter now matches through the suburbHash blind index.
// These tests run real crypto (test key) against an in-memory Family table and
// check the results equal the old decrypt-scan for full-suburb queries,
// including case/whitespace variants, and that not-yet-backfilled rows still match.
import type { Prisma } from "@/lib/generated/prisma/client"

type Row = { id: number; name: string; status: string; suburb: string | null; suburbHash: string | null }

let crypto: typeof import("@/lib/crypto")
let filter: typeof import("@/lib/familySuburbFilter")
let fields: typeof import("@/lib/familyFields")

beforeAll(async () => {
  process.env.ENCRYPTION_KEY_V1 = Buffer.alloc(32, 5).toString("base64")
  process.env.ENCRYPTION_KEY_ID = "v1"
  crypto = await import("@/lib/crypto")
  filter = await import("@/lib/familySuburbFilter")
  fields = await import("@/lib/familyFields")
})

afterAll(() => {
  delete process.env.ENCRYPTION_KEY_V1
  delete process.env.ENCRYPTION_KEY_ID
})

/** Build a stored row through the real write helper (encrypts + hashes), or legacy (encrypt only, no hash). */
function row(id: number, name: string, suburb: string | null, legacy = false, status = "ACTIVE"): Row {
  if (legacy) return { id, name, status, suburb: suburb ? crypto.encrypt(suburb) : null, suburbHash: null }
  const data: { suburb?: string | null; suburbHash?: string | null } = { suburb }
  fields.encryptFamilyFields(data)
  return { id, name, status, suburb: data.suburb ?? null, suburbHash: data.suburbHash ?? null }
}

/** In-memory findMany honouring the where shapes the filter emits, ordered by name. */
function fakeFetch(rows: Row[]) {
  const calls: Prisma.FamilyWhereInput[] = []
  const fetch = async (where: Prisma.FamilyWhereInput, take: number) => {
    calls.push(where)
    return rows
      .filter((r) => (where.status === undefined || r.status === where.status))
      .filter((r) => (where.suburbHash === undefined || r.suburbHash === where.suburbHash))
      .filter((r) => (where.suburb === undefined || r.suburb !== null))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, take)
      .map((r) => ({ id: r.id, name: r.name, suburb: r.suburb }))
  }
  return { fetch, calls }
}

/** The pre-OSS-39 page logic: decrypt every row, lower-case substring match. */
function oldScan(rows: Row[], q: string): number[] {
  return rows
    .map((r) => ({ ...r, suburb: r.suburb ? crypto.safeDecrypt(r.suburb) : null }))
    .filter((r) => (r.suburb ?? "").toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((r) => r.id)
}

describe("hmacSuburb / normaliseSuburb", () => {
  it("folds case, outer and inner whitespace", () => {
    expect(crypto.normaliseSuburb("  North \t  SYDNEY ")).toBe("north sydney")
    expect(crypto.hmacSuburb("North Sydney")).toBe(crypto.hmacSuburb("  north   sydney "))
  })

  it("is a 64-hex keyed digest, never the plaintext, separate from the email index", () => {
    const h = crypto.hmacSuburb("Parramatta")
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(h).not.toContain("parramatta")
    expect(h).not.toBe(crypto.hmacEmail("parramatta"))
    expect(crypto.hmacSuburb("Parramatta")).not.toBe(crypto.hmacSuburb("Paramatta"))
  })

  it("changes with the v1 key (per-key HMAC)", () => {
    const before = crypto.hmacSuburb("Parramatta")
    process.env.ENCRYPTION_KEY_V1 = Buffer.alloc(32, 6).toString("base64")
    try {
      expect(crypto.hmacSuburb("Parramatta")).not.toBe(before)
    } finally {
      process.env.ENCRYPTION_KEY_V1 = Buffer.alloc(32, 5).toString("base64")
    }
  })
})

describe("encryptFamilyFields suburbHash", () => {
  it("sets the hash with the suburb, nulls it for a blank suburb, and leaves it alone when suburb is absent", () => {
    const set: { suburb?: string | null; suburbHash?: string | null } = { suburb: "Ryde" }
    fields.encryptFamilyFields(set)
    expect(set.suburbHash).toBe(crypto.hmacSuburb("ryde"))
    expect(set.suburb).toMatch(/^enc:v1:/)

    const cleared: { suburb?: string | null; suburbHash?: string | null } = { suburb: null }
    fields.encryptFamilyFields(cleared)
    expect(cleared.suburbHash).toBeNull()

    const blank: { suburb?: string | null; suburbHash?: string | null } = { suburb: "   " }
    fields.encryptFamilyFields(blank)
    expect(blank).toEqual({ suburb: null, suburbHash: null })

    const untouched:{ address?: string | null; suburbHash?: string | null } = { address: "1 Example St" }
    fields.encryptFamilyFields(untouched)
    expect("suburbHash" in untouched).toBe(false)
  })
})

describe("findFamiliesBySuburb", () => {
  // No suburb here is a substring of another, so the old substring scan and the
  // new exact match must agree on every full-suburb query.
  const rows = (): Row[] => [
    row(1, "Adams", "Parramatta"),
    row(2, "Brown", "  PARRAMATTA "),
    row(3, "Chen", "Ryde"),
    row(4, "Davis", "Blacktown", true), // legacy, not yet backfilled
    row(5, "Evans", "parramatta", true), // legacy
    row(6, "Fox", null),
    row(7, "Gill", "Blacktown"),
  ]

  it.each(["Parramatta", "parramatta", "  PARRAMATTA  ", "Ryde", "blacktown", "Nowhere"])(
    "matches the old decrypt-scan for %p",
    async (q) => {
      const data = rows()
      const { fetch } = fakeFetch(data)
      const res = await filter.findFamiliesBySuburb(fetch, {}, q)
      expect(res.families.map((f) => f.id)).toEqual(oldScan(data, q))
      expect(res.capped).toBe(false)
      expect(res.scanIncomplete).toBe(false)
    },
  )

  it("returns decrypted suburbs", async () => {
    const { fetch } = fakeFetch(rows())
    const res = await filter.findFamiliesBySuburb(fetch, {}, "ryde")
    expect(res.families).toEqual([{ id: 3, name: "Chen", suburb: "Ryde" }])
  })

  it("folds inner whitespace too (stricter than the old scan, which missed it)", async () => {
    const data = [row(1, "Adams", "North  Sydney"), row(2, "Brown", "north sydney", true)]
    const { fetch } = fakeFetch(data)
    const res = await filter.findFamiliesBySuburb(fetch, {}, "North Sydney")
    expect(res.families.map((f) => f.id)).toEqual([1, 2])
  })

  it("is an exact match: a partial suburb no longer matches", async () => {
    const { fetch } = fakeFetch([row(1, "Adams", "North Sydney")])
    const res = await filter.findFamiliesBySuburb(fetch, {}, "Sydney")
    expect(res.families).toEqual([])
  })

  it("queries the hash, never the plaintext, and keeps the base filters", async () => {
    const { fetch, calls } = fakeFetch(rows())
    await filter.findFamiliesBySuburb(fetch, { status: "ACTIVE" as never }, "Ryde")
    expect(calls[0]).toEqual({ status: "ACTIVE", suburbHash: crypto.hmacSuburb("Ryde") })
    expect(calls[1]).toEqual({ status: "ACTIVE", suburbHash: null, suburb: { not: null } })
    expect(JSON.stringify(calls)).not.toMatch(/ryde/i)
  })

  it("caps at FAMILY_CAP and flags a legacy scan past its cap", async () => {
    const many: Row[] = []
    for (let i = 0; i < filter.FAMILY_CAP + 2; i++) many.push({ id: i, name: `F${String(i).padStart(4, "0")}`, status: "ACTIVE", suburb: "x", suburbHash: crypto.hmacSuburb("Ryde") })
    const capped = await filter.findFamiliesBySuburb(fakeFetch(many).fetch, {}, "Ryde")
    expect(capped.families).toHaveLength(filter.FAMILY_CAP)
    expect(capped.capped).toBe(true)

    const legacy: Row[] = []
    for (let i = 0; i < filter.LEGACY_SUBURB_SCAN_CAP + 1; i++) legacy.push({ id: i, name: `L${i}`, status: "ACTIVE", suburb: "plain", suburbHash: null })
    const partial = await filter.findFamiliesBySuburb(fakeFetch(legacy).fetch, {}, "Ryde")
    expect(partial.scanIncomplete).toBe(true)
  })
})
