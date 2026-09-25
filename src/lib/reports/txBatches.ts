/**
 * Keyset-paginated batching for FY-scoped transaction scans.
 *
 * Report pages (P&L monthly) that need to fold every transaction in a fiscal
 * year into an in-memory aggregate used to load the whole FY with a single
 * unbounded `findMany`. That is fine at parish scale but has no ceiling — a FY
 * with a very large transaction count would materialise every row at once.
 *
 * This helper walks the same rows in fixed-size batches ordered by primary key
 * (stable keyset pagination via `cursor` + `skip: 1`), invoking `onBatch` for
 * each chunk. Peak memory is bounded to `batchSize` rows regardless of how many
 * transactions the FY holds, and the accumulated result is identical to loading
 * everything at once — the caller's fold sees every row exactly once.
 */

/** Rows per batch. Large enough that parish-scale FYs finish in one round trip. */
export const TX_BATCH_SIZE = 5000

/** Keyset page params handed to the caller's fetcher each round. */
export type BatchPage = { take: number; skip?: number; cursor?: { id: number } }

/**
 * Repeatedly calls `fetchBatch` with keyset-pagination params and feeds each
 * non-empty batch to `onBatch`, until a short (or empty) batch signals the end.
 *
 * `fetchBatch` must apply a stable `orderBy: { id: "asc" }` and select `id`
 * (used as the cursor) alongside whatever columns the fold needs. The caller
 * bakes its own `where`/`select` into the closure.
 */
export async function forEachTransactionBatch<T extends { id: number }>(
  fetchBatch: (page: BatchPage) => Promise<T[]>,
  onBatch: (rows: T[]) => void | Promise<void>,
  batchSize: number = TX_BATCH_SIZE,
): Promise<void> {
  let cursorId: number | undefined
  for (;;) {
    const rows = await fetchBatch(
      cursorId === undefined
        ? { take: batchSize }
        : { take: batchSize, skip: 1, cursor: { id: cursorId } },
    )
    if (rows.length === 0) break
    // Await so an async fold runs to completion before the next batch is fetched —
    // keeps peak memory bounded to batchSize and prevents overlapping batches
    // (harmless no-op for the current synchronous callers).
    await onBatch(rows)
    // A short batch means we've reached the last page — stop before an extra
    // (guaranteed-empty) round trip.
    if (rows.length < batchSize) break
    cursorId = rows[rows.length - 1].id
  }
}
