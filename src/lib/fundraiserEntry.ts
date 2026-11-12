import { randomBytes } from "node:crypto"
import type { Prisma } from "@/lib/generated/prisma/client"
import { makeBankRef } from "@/lib/fundraiserRef"

/** Probes of consecutive sequence numbers before giving up on a free bankRef. */
const MAX_REF_PROBES = 5

/** Thrown by `generateUniqueBankRef` when every probed sequence number is taken. */
export class NoFreeBankRefError extends Error {
  /** Create the error with a fixed message. */
  constructor() {
    super("No free bank reference")
    this.name = "NoFreeBankRefError"
  }
}

/**
 * Mint the opaque public token for a fundraiser entry (CSPRNG, same source as
 * `Registration.publicToken`). 18 random bytes, base64url: unguessable, so a
 * public payment page can be scoped by it instead of the sequential id.
 * @returns a 24-char URL-safe token
 */
export function mintEntryToken(): string {
  return randomBytes(18).toString("base64url")
}

/**
 * Pick the next free bank-transfer reference for a prefix: highest existing
 * 4-digit suffix for that exact prefix + 1 (so "FR" ignores "FR10001" of prefix "FR1"), then probe forward (max 5) past any
 * taken value. Once the 4-digit range is full (9999 issued), `makeBankRef`
 * emits 5+ digit suffixes, so those count too — otherwise the max would stick at
 * 9999 and every add would fail after the probe budget. `bankRef` is globally unique, and fundraisers may share a prefix
 * (the default "FR"), so the scan is across all entries, not one fundraiser.
 * Two concurrent callers can still pick the same value; the caller's create
 * then fails on the unique index (P2002) and must retry the whole transaction.
 * @param tx transaction client (or prisma) to read entries with
 * @param prefix fundraiser `refPrefix`, or null for the default
 * @returns an unused bankRef at the time of the read
 * @throws NoFreeBankRefError when no free ref is found within the probe budget
 */
export async function generateUniqueBankRef(tx: Prisma.TransactionClient, prefix: string | null): Promise<string> {
  // makeBankRef with seq 0 yields "<cleaned prefix>0000"; strip the padding to get the prefix.
  const clean = makeBankRef(prefix, 0).slice(0, -4)
  const existing = await tx.fundraiserEntry.findMany({
    where: { bankRef: { startsWith: clean } },
    select: { bankRef: true },
  })
  // clean is [A-Z0-9] only: no regex metachars. Unpadded 5+ digit seqs never start with 0.
  const fourRe = new RegExp(`^${clean}(\\d{4})$`)
  const longRe = new RegExp(`^${clean}([1-9]\\d{4,})$`)
  let max = 0
  for (const { bankRef } of existing) {
    const m = fourRe.exec(bankRef)
    if (m) max = Math.max(max, Number.parseInt(m[1], 10))
  }
  // A 5+ digit suffix is only this prefix's own once its 4-digit range is used
  // up; before that "FR10001" belongs to prefix "FR1".
  if (max === 9999) {
    for (const { bankRef } of existing) {
      const m = longRe.exec(bankRef)
      if (m) max = Math.max(max, Number.parseInt(m[1], 10))
    }
  }
  for (let seq = max + 1; seq <= max + MAX_REF_PROBES; seq++) {
    const ref = makeBankRef(prefix, seq)
    const taken = await tx.fundraiserEntry.findUnique({ where: { bankRef: ref }, select: { id: true } })
    if (!taken) return ref
  }
  throw new NoFreeBankRefError()
}
