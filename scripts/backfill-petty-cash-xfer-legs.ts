import * as dotenv from "dotenv"
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: ".env.local" })
  dotenv.config()
}

import { PrismaClient } from "../src/lib/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { XFER_OUT_PREFIX } from "../src/lib/xferRefs"
import { dbHost, parseScriptArgs, requireConfirmation } from "./lib/script-helpers"

// Backfill for #487 item 4: legacy petty-cash `XFER_OUT_<bankRef>` paired legs
// written by bank import before the cash account was resolved carry
// `paymentAccountId = null`. They bypass the transfer guard and cannot be
// adopted into a petty-cash session (adoptionProblem needs the cash account id).
// This sets paymentAccountId to the cash account on those rows.
//
//   npx tsx scripts/backfill-petty-cash-xfer-legs.ts                # dry run (default)
//   npx tsx scripts/backfill-petty-cash-xfer-legs.ts --apply --yes  # write
//
// Idempotent: only rows still null are touched (and the write re-checks null).
// Writes ONLY when exactly one active CASH PaymentAccount exists; with zero or
// several it reports and changes nothing (ambiguous target).

/** Minimal Prisma surface the backfill needs (injectable for tests). */
export interface XferLegDb {
  transaction: {
    count(args: { where: { bankRef: { startsWith: string }; paymentAccountId: null } }): Promise<number>
    updateMany(args: {
      where: { bankRef: { startsWith: string }; paymentAccountId: null }
      data: { paymentAccountId: number }
    }): Promise<{ count: number }>
  }
  paymentAccount: {
    findMany(args: { where: { kind: "CASH"; isActive: true }; select: { id: true } }): Promise<{ id: number }[]>
  }
}

export interface XferLegResult {
  /** Legs with a null paymentAccountId found at the start of the run. */
  found: number
  /** Rows written (always 0 on a dry run or when the cash account is ambiguous). */
  updated: number
  /** Why nothing was written despite `apply`, if so. */
  skipped?: "no-cash-account" | "multiple-cash-accounts"
}

/**
 * Count (and with `apply`, fix) `XFER_OUT_` legs whose paymentAccountId is null.
 *
 * @param db - Prisma client or a compatible fake
 * @param apply - write changes when true; dry run otherwise
 * @returns counts and the reason a requested write was skipped
 */
export async function backfillXferLegs(db: XferLegDb, apply: boolean): Promise<XferLegResult> {
  const where = { bankRef: { startsWith: XFER_OUT_PREFIX }, paymentAccountId: null } as const
  const found = await db.transaction.count({ where })
  console.log(`XFER_OUT_ legs with null paymentAccountId: ${found}`)
  if (found === 0 || !apply) return { found, updated: 0 }

  const cash = await db.paymentAccount.findMany({ where: { kind: "CASH", isActive: true }, select: { id: true } })
  if (cash.length !== 1) {
    const skipped = cash.length === 0 ? "no-cash-account" : "multiple-cash-accounts"
    console.log(`Found ${cash.length} active CASH account(s); need exactly one. Nothing written.`)
    return { found, updated: 0, skipped }
  }
  const { count } = await db.transaction.updateMany({ where, data: { paymentAccountId: cash[0].id } })
  console.log(`Set paymentAccountId=${cash[0].id} on ${count} row(s).`)
  return { found, updated: count }
}

/** CLI entry: dry run unless `--apply --yes`; non-zero exit when a requested write was skipped. */
async function main() {
  const { apply, confirmed } = parseScriptArgs()
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
  console.log(`Backfill null paymentAccountId on XFER_OUT_ legs — ${apply ? "APPLY" : "DRY RUN"}`)
  console.log(`Target DB host: ${dbHost(process.env.DATABASE_URL)}`)
  await requireConfirmation(apply, confirmed, () => prisma.$disconnect())
  const res = await backfillXferLegs(prisma as unknown as XferLegDb, apply)
  if (!apply) console.log("Dry run complete. Re-run with --apply --yes to write.")
  await prisma.$disconnect()
  if (res.skipped) process.exit(1)
}

// Jest sets NODE_ENV=test; skip the auto-run so the module can be imported.
if (process.env.NODE_ENV !== "test") {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
