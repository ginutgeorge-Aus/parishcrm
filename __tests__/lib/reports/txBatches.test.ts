import { forEachTransactionBatch, TX_BATCH_SIZE } from "@/lib/reports/txBatches"

type Row = { id: number; v: number }

/**
 * Fake keyset-paginated store. Returns rows ordered by id, honouring
 * take/skip/cursor exactly as Prisma would, so the batching logic is exercised
 * end-to-end without a database.
 */
function makeStore(all: Row[]) {
  const calls: Array<{ take: number; skip?: number; cursor?: { id: number } }> = []
  const fetchBatch = async (page: { take: number; skip?: number; cursor?: { id: number } }) => {
    calls.push(page)
    let start = 0
    if (page.cursor) {
      const idx = all.findIndex((r) => r.id === page.cursor!.id)
      start = idx + (page.skip ?? 0)
    }
    return all.slice(start, start + page.take)
  }
  return { fetchBatch, calls }
}

describe("forEachTransactionBatch", () => {
  it("does not call the fetcher's onBatch for an empty result set", async () => {
    const { fetchBatch, calls } = makeStore([])
    const seen: Row[] = []
    await forEachTransactionBatch<Row>(fetchBatch, (rows) => { seen.push(...rows) }, 10)
    expect(seen).toEqual([])
    expect(calls).toHaveLength(1) // one probe, then stop
    expect(calls[0]).toEqual({ take: 10 }) // no cursor on the first page
  })

  it("processes a single short batch and stops without an extra round trip", async () => {
    const all: Row[] = [{ id: 1, v: 10 }, { id: 2, v: 20 }]
    const { fetchBatch, calls } = makeStore(all)
    const seen: Row[] = []
    await forEachTransactionBatch<Row>(fetchBatch, (rows) => { seen.push(...rows) }, 10)
    expect(seen).toEqual(all)
    expect(calls).toHaveLength(1) // short batch (2 < 10) => no follow-up query
  })

  it("keyset-paginates across multiple full batches, seeing every row exactly once", async () => {
    const all: Row[] = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, v: i + 1 }))
    const { fetchBatch, calls } = makeStore(all)
    const seen: Row[] = []
    await forEachTransactionBatch<Row>(fetchBatch, (rows) => { seen.push(...rows) }, 10)

    // Every row once, in id order, no duplicates or gaps.
    expect(seen.map((r) => r.id)).toEqual(all.map((r) => r.id))
    // 10 + 10 + 5: three fetches, last is short so the loop ends.
    expect(calls).toHaveLength(3)
    expect(calls[0]).toEqual({ take: 10 })
    expect(calls[1]).toEqual({ take: 10, skip: 1, cursor: { id: 10 } })
    expect(calls[2]).toEqual({ take: 10, skip: 1, cursor: { id: 20 } })
  })

  it("makes one extra (empty) round trip when the total is an exact multiple of the batch size", async () => {
    const all: Row[] = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, v: i + 1 }))
    const { fetchBatch, calls } = makeStore(all)
    const seen: Row[] = []
    await forEachTransactionBatch<Row>(fetchBatch, (rows) => { seen.push(...rows) }, 10)
    expect(seen).toHaveLength(20)
    // 10 (full) -> 10 (full) -> 0 (empty, terminates). No row processed twice.
    expect(calls).toHaveLength(3)
    expect(new Set(seen.map((r) => r.id)).size).toBe(20)
  })

  it("defaults to the module batch size when none is supplied", async () => {
    const { fetchBatch, calls } = makeStore([{ id: 1, v: 1 }])
    await forEachTransactionBatch<Row>(fetchBatch, () => {})
    expect(calls[0].take).toBe(TX_BATCH_SIZE)
  })
})
