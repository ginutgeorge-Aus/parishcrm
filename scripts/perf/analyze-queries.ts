import "dotenv/config"
import fs from "node:fs"
import { PrismaClient } from "../../src/lib/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

// perf baseline — parse the JSONL query log written by src/lib/prisma.ts
// (PERF_QUERY_LOG=1), rank query shapes by total time spent, and dump the
// EXPLAIN plan for the worst 20. Feeds docs/perf-baseline-2026-08.md.
//
//   npx tsx scripts/perf/analyze-queries.ts
//
// Queries are logged with $1 placeholders (no param values), so we use
// EXPLAIN (GENERIC_PLAN …) — Postgres ≥16 plans a parameterised statement
// without concrete values. Local dev + prod are both PG16+.

const LOG_FILE = process.env.PERF_QUERY_LOG_FILE ?? "scratchpad/perf/queries.jsonl"
const OUT = process.env.PERF_ANALYSIS_OUT ?? "scratchpad/perf/query-analysis.md"
const TOP_N = 20

type Row = { sql: string; durationMs: number }
type Stat = { sql: string; count: number; totalMs: number; maxMs: number; avgMs: number }

function loadRows(file: string): Row[] {
  if (!fs.existsSync(file)) throw new Error(`Query log not found: ${file}. Run the app with PERF_QUERY_LOG=1 first.`)
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Row)
}

function rank(rows: Row[]): Stat[] {
  const byShape = new Map<string, { count: number; totalMs: number; maxMs: number }>()
  for (const r of rows) {
    const s = byShape.get(r.sql) ?? { count: 0, totalMs: 0, maxMs: 0 }
    s.count++
    s.totalMs += r.durationMs
    s.maxMs = Math.max(s.maxMs, r.durationMs)
    byShape.set(r.sql, s)
  }
  return [...byShape.entries()]
    .map(([sql, s]) => ({ sql, ...s, avgMs: +(s.totalMs / s.count).toFixed(2) }))
    .sort((a, b) => b.totalMs - a.totalMs)
}

async function main() {
  const rows = loadRows(LOG_FILE)
  const stats = rank(rows)
  console.log(`Parsed ${rows.length} queries · ${stats.length} distinct shapes\n`)
  console.table(stats.slice(0, TOP_N).map((s) => ({ count: s.count, totalMs: +s.totalMs.toFixed(1), avgMs: s.avgMs, maxMs: s.maxMs, sql: s.sql.slice(0, 80) })))

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
  const prisma = new PrismaClient({ adapter })
  const md: string[] = [`# Query analysis`, ``, `Parsed ${rows.length} queries, ${stats.length} distinct shapes. Top ${TOP_N} by total time:`, ``]
  md.push(`| # | count | total ms | avg ms | max ms |`, `|---|-------|----------|--------|--------|`)
  stats.slice(0, TOP_N).forEach((s, i) => md.push(`| ${i + 1} | ${s.count} | ${s.totalMs.toFixed(1)} | ${s.avgMs} | ${s.maxMs} |`))
  md.push(``, `## EXPLAIN (GENERIC_PLAN) — worst ${TOP_N}`, ``)

  for (const [i, s] of stats.slice(0, TOP_N).entries()) {
    md.push(`### ${i + 1}. total ${s.totalMs.toFixed(1)}ms over ${s.count} calls`, "", "```sql", s.sql, "```", "")
    try {
      // EXPLAIN can't route through the typed client; s.sql is our own Prisma-logged query text
      // (never user input), and this is a dev-only offline analysis script that never runs in the
      // app/request path. No injection surface.
      const plan = (await prisma.$queryRawUnsafe(`EXPLAIN (GENERIC_PLAN, FORMAT TEXT) ${s.sql}`)) as Array<Record<string, string>> // nosemgrep: crm-no-raw-sql
      md.push("```", ...plan.map((p) => Object.values(p)[0]), "```", "")
    } catch (e) {
      md.push(`_EXPLAIN failed: ${(e as Error).message}_`, "")
    }
  }

  await prisma.$disconnect()
  fs.writeFileSync(OUT, md.join("\n"))
  console.log(`\nWrote analysis → ${OUT}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
