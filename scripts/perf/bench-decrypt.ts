import "dotenv/config"
import { PrismaClient } from "../../src/lib/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { hmacSuburb, normaliseSuburb, safeDecrypt } from "../../src/lib/cryptoCore"

// OSS-38 — time the decrypt-in-memory paths against the volume seed.
//
//   SEED_SCALE=large npx tsx scripts/perf/seed-volume.ts
//   npx tsx scripts/perf/bench-decrypt.ts
//
// Mirrors the DB fetch + decrypt/filter work of each route directly (no server, no auth):
// the routes import `server-only` modules that cannot load under tsx. Local DB only.
// The caps below are copies of the app constants (not exported) — keep in sync:
//   LEGACY_SUBURB_SCAN_CAP  src/lib/familySuburbFilter.ts
//   SEARCH_SCAN_CAP         src/lib/reports/transactionsQuery.ts
//   EXPORT_CAP              src/app/api/people/export/route.ts
//   PEOPLE_CAP              src/app/(dashboard)/people/page.tsx
const LEGACY_SUBURB_SCAN_CAP = 2000
const SEARCH_SCAN_CAP = 5000
const EXPORT_CAP = 10_000
const PEOPLE_CAP = 500
const RUNS = Number(process.env.BENCH_RUNS ?? 5)

const host = new URL(process.env.DATABASE_URL ?? "postgres://x@invalid/").hostname
if (host !== "localhost" && host !== "127.0.0.1") {
  throw new Error(`Refusing to benchmark: DATABASE_URL host "${host}" is not local.`)
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })

type Result = { path: string; rows: number; fetchMs: number; decryptMs: number; totalMs: number }

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const round = (n: number) => Math.round(n * 10) / 10

/** Runs one fetch-then-process pass and returns split timings. */
async function timed<T>(path: string, fetch: () => Promise<T[]>, process: (rows: T[]) => void): Promise<Result> {
  const t0 = performance.now()
  const rows = await fetch()
  const t1 = performance.now()
  process(rows)
  const t2 = performance.now()
  return { path, rows: rows.length, fetchMs: t1 - t0, decryptMs: t2 - t1, totalMs: t2 - t0 }
}

const benches: Array<() => Promise<Result>> = [
  // families suburb filter: indexed hash lookup + legacy (suburbHash null) decrypt-scan
  () => {
    const wanted = normaliseSuburb("Parramatta")
    return timed(
      "families suburb (legacy scan)",
      () => prisma.family.findMany({ where: { suburbHash: null, suburb: { not: null } }, orderBy: { name: "asc" }, take: LEGACY_SUBURB_SCAN_CAP + 1, select: { name: true, suburb: true } }),
      (rows) => rows.slice(0, LEGACY_SUBURB_SCAN_CAP).filter((f) => normaliseSuburb(safeDecrypt(f.suburb ?? "")) === wanted),
    )
  },
  () =>
    timed(
      "families suburb (hash lookup)",
      () => prisma.family.findMany({ where: { suburbHash: hmacSuburb("Parramatta") }, orderBy: { name: "asc" }, take: 501, select: { name: true, suburb: true } }),
      (rows) => rows.map((f) => (f.suburb ? safeDecrypt(f.suburb) : null)),
    ),
  // transactions search: newest SEARCH_SCAN_CAP rows, decrypt description, substring filter
  () =>
    timed(
      "transactions search",
      () => prisma.transaction.findMany({ orderBy: { date: "desc" }, take: SEARCH_SCAN_CAP, select: { id: true, description: true } }),
      (rows) => rows.filter((t) => safeDecrypt(t.description).toLowerCase().includes("perf txn 4")),
    ),
  // people export: EXPORT_CAP rows, decrypt email/mobile/DOB
  () =>
    timed(
      "people export",
      () =>
        prisma.person.findMany({
          where: { archivedAt: null },
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
          take: EXPORT_CAP,
          select: { firstName: true, lastName: true, email: true, mobile: true, dateOfBirth: true, family: { select: { name: true } } },
        }),
      (rows) => rows.forEach((p) => [p.email, p.mobile, p.dateOfBirth].map((v) => (v ? safeDecrypt(v) : ""))),
    ),
  // people list page: PEOPLE_CAP rows, decrypt email/mobile for display
  () =>
    timed(
      "people list page",
      () =>
        prisma.person.findMany({
          where: { archivedAt: null },
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
          take: PEOPLE_CAP,
          select: { firstName: true, lastName: true, email: true, mobile: true, family: { select: { id: true, name: true } } },
        }),
      (rows) => rows.forEach((p) => [p.email, p.mobile].map((v) => (v ? safeDecrypt(v) : ""))),
    ),
]

async function main() {
  const [fam, ppl, txn] = await Promise.all([prisma.family.count(), prisma.person.count(), prisma.transaction.count()])
  console.log(`Volume: ${fam} families, ${ppl} people, ${txn} transactions; ${RUNS} runs each (median ms)`)
  const table: Record<string, { rows: number; fetchMs: number; decryptMs: number; totalMs: number }> = {}
  for (const bench of benches) {
    await bench() // warm-up: connection + key derivation
    const runs: Result[] = []
    for (let i = 0; i < RUNS; i++) runs.push(await bench())
    table[runs[0].path] = {
      rows: runs[0].rows,
      fetchMs: round(median(runs.map((r) => r.fetchMs))),
      decryptMs: round(median(runs.map((r) => r.decryptMs))),
      totalMs: round(median(runs.map((r) => r.totalMs))),
    }
  }
  console.table(table)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
