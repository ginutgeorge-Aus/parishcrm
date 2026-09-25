import "server-only"
import fs from "node:fs"
import { PrismaClient, Prisma } from "./generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

// Re-exported so callers (e.g. transaction-isolation-level options, tx client
// typing) go through this shared module instead of reaching into the
// generated client directly.
export { Prisma }

function createPrismaClient() {
  // Fail loudly at first use instead of an opaque adapter crash on every DB route.
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required")
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })

  // perf baseline: opt-in JSONL query log. Both env vars must be set, so the
  // prod path (neither set) constructs the identical plain client as before — no
  // behaviour change, no `log` config, no file handle. Local use: run the app with
  // PERF_QUERY_LOG=1 and PERF_QUERY_LOG_FILE=<path>, then scripts/perf/analyze-queries.ts.
  if (process.env.PERF_QUERY_LOG === "1" && process.env.PERF_QUERY_LOG_FILE) {
    const client = new PrismaClient({ adapter, log: [{ emit: "event", level: "query" }] })
    const stream = fs.createWriteStream(process.env.PERF_QUERY_LOG_FILE, { flags: "a" })
    client.$on("query", (e) => {
      stream.write(JSON.stringify({ sql: e.query, durationMs: e.duration }) + "\n")
    })
    return client
  }

  return new PrismaClient({ adapter })
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

// Construct lazily on first property access: `next build` page-data collection
// imports this module inside the Docker build stage, which has no DATABASE_URL,
// so an eager throw breaks the image build (v1.1.4 deploy failure). First real
// use at runtime still fails loudly. The client lives on globalThis so
// every App Router chunk shares ONE client/pg.Pool.
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = (globalForPrisma.prisma ??= createPrismaClient())
    const value = Reflect.get(client, prop, client)
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(client)
      : value
  },
})
