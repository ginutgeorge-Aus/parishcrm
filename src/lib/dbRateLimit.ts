import "server-only"
import { prisma } from "@/lib/prisma"

// Postgres-backed fixed-window rate limiter, keyed by an arbitrary string.
// Correct across replicas (unlike the in-memory limiters), so it is safe even
// if --max-replicas is raised above 1. Returns true if the request is
// allowed, false if the key has already hit `limit` within the current window.
//
// Best-effort: no row lock, so two truly simultaneous requests opening a fresh
// window may result in the second being incorrectly denied (one-request
// under-count, due to unique-constraint serialisation). Acceptable for
// low-volume paths like password reset; do not use for high-contention
// counters that need exactness.
//
// Fixed window, no boundary carry-over (accepted): `limit` requests at
// the tail of one window plus `limit` at the head of the next allows ~2x burst.
// Accepted — the login/reset consumers carry per-account lockout backstops; a
// sliding-window rewrite isn't warranted at this scale.
export async function dbRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): Promise<boolean> {
  const nowDate = new Date(now)

  // Always clear THIS key's own expired row (single-row, hits the unique-key
  // index) so the create below starts a fresh window without colliding.
  // `lte`, not `lt`: a window is active only while `resetAt > now` (the
  // updateMany + create both use `> now`). A row whose `resetAt` equals `now`
  // is already expired — with `lt` it survives the prune yet fails the active
  // check, so the key wedges (updateMany misses, create collides → deny).
  await prisma.rateLimit.deleteMany({ where: { key, resetAt: { lte: nowDate } } })

  // Opportunistically prune all other expired rows to bound table growth, but
  // only on a small fraction of calls — otherwise a password-reset flood would
  // fire a full-table DELETE on every request, a DB-side DoS amplifier.
  if (Math.random() < 0.02) {
    await prisma.rateLimit.deleteMany({ where: { resetAt: { lte: nowDate } } })
  }

  // Active window still under the limit → count this request.
  const incremented = await prisma.rateLimit.updateMany({
    where: { key, resetAt: { gt: nowDate }, count: { lt: limit } },
    data: { count: { increment: 1 } },
  })
  if (incremented.count > 0) return true

  // No matching active-under-limit row. Either the key has no row (expired and
  // pruned, or never seen) → create a fresh window, or an active row is already
  // at the limit → the unique key collides on create → deny.
  try {
    await prisma.rateLimit.create({
      data: { key, count: 1, resetAt: new Date(now + windowMs) },
    })
    return true
  } catch {
    return false
  }
}
